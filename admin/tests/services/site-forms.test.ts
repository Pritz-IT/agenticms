import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import {
  normalizeSlug, addAllowedForm, removeAllowedForm, listAllowedForms, MAX_ALLOWED_FORMS,
} from "../../src/services/site-forms.js";

let app: FastifyInstance;
let siteId: string;

beforeAll(async () => { app = await buildApp({ logger: false }); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await app.prisma.site.deleteMany();
  const s = await app.prisma.site.create({
    data: { key: "demo", name: "S", domain: "example.com", stagingDomain: "s.example.com", defaultLocale: "de", allowedForms: [] },
  });
  siteId = s.id;
});

describe("normalizeSlug", () => {
  it("lowercases and accepts a valid slug", () => expect(normalizeSlug("Quiz-Form")).toBe("quiz-form"));
  it("rejects spaces/symbols", () => expect(normalizeSlug("bad form!")).toBeNull());
  it("rejects over-length", () => expect(normalizeSlug("a".repeat(65))).toBeNull());
  it("rejects empty / non-string", () => { expect(normalizeSlug("")).toBeNull(); expect(normalizeSlug(42)).toBeNull(); });
});

describe("add/remove", () => {
  it("adds a slug and returns the array", async () => {
    const r = await addAllowedForm(app, siteId, "contact");
    expect(r.outcome).toBe("added"); expect(r.forms).toEqual(["contact"]);
  });
  it("add is idempotent (noop, no duplicate)", async () => {
    await addAllowedForm(app, siteId, "contact");
    const r = await addAllowedForm(app, siteId, "contact");
    expect(r.outcome).toBe("noop"); expect(r.forms).toEqual(["contact"]);
  });
  it("remove is idempotent", async () => {
    const r = await removeAllowedForm(app, siteId, "nope");
    expect(r.outcome).toBe("noop"); expect(r.forms).toEqual([]);
  });
  it("removes an existing slug", async () => {
    await addAllowedForm(app, siteId, "contact");
    const r = await removeAllowedForm(app, siteId, "contact");
    expect(r.outcome).toBe("removed"); expect(r.forms).toEqual([]);
  });
  it("enforces the cap atomically under a real boundary race", async () => {
    // Fill to MAX-1, then race two adds of DISTINCT new slugs. Atomicity means
    // exactly one wins ("added") and one is rejected ("limit"); a read-then-check
    // (TOCTOU) impl would let BOTH in and overshoot to MAX+1.
    for (let i = 0; i < MAX_ALLOWED_FORMS - 1; i++) await addAllowedForm(app, siteId, `form-${i}`);
    const results = await Promise.all([
      addAllowedForm(app, siteId, "race-a"),
      addAllowedForm(app, siteId, "race-b"),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["added", "limit"]);
    expect(await listAllowedForms(app, siteId)).toHaveLength(MAX_ALLOWED_FORMS);
  });
  it("concurrent add + remove of the same slug converge without corruption", async () => {
    // Final presence is order-dependent, but the array must never end duplicated
    // or corrupted regardless of interleaving.
    await Promise.all([addAllowedForm(app, siteId, "contact"), removeAllowedForm(app, siteId, "contact")]);
    const forms = await listAllowedForms(app, siteId);
    expect(forms.filter((f) => f === "contact").length).toBeLessThanOrEqual(1);
    await addAllowedForm(app, siteId, "contact"); // still operable afterwards
    expect(await listAllowedForms(app, siteId)).toContain("contact");
  });
});
