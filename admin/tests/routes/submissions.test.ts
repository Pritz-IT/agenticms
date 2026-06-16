import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let editorToken: string;
let adminToken: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await app.prisma.submission.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Site",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "de",
      siteUrl: "https://example.com",
    },
  });
  const { user: editor } = await createTestUser(app, { role: "editor", email: "editor@example.com" });
  const { user: admin } = await createTestUser(app, { role: "admin", email: "admin@example.com" });
  editorToken = getAccessToken(editor);
  adminToken = getAccessToken(admin);
});

function validBody(over: Record<string, unknown> = {}) {
  return {
    form: "sample-template",
    email: "lead@firma.ch",
    score: 12,
    data: { answers: [0, 1, 2], level: "low", pct: 8 },
    hp: "",
    t: 9000,
    ...over,
  };
}

async function createAgenticmsSite() {
  return app.prisma.site.create({
    data: {
      key: "agenticms",
      name: "AgentiCMS",
      domain: "agenticms.local",
      stagingDomain: "staging.agenticms.local",
      defaultLocale: "en",
      siteUrl: "https://agenticms.local",
    },
  });
}

describe("POST /api/submissions", () => {
  it("accepts a valid submission (201) and persists it", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    const row = await app.prisma.submission.findUnique({ where: { id } });
    const site = await app.prisma.site.findUnique({ where: { key: "demo" } });
    expect(row?.siteId).toBe(site?.id);
    expect(row?.form).toBe("sample-template");
    expect(row?.email).toBe("lead@firma.ch");
  });

  it("rejects a disallowed form (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ form: "totally-unknown" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed email (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "not-an-email" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a filled honeypot (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ hp: "i am a bot" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a too-fast submission (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ t: 500 }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects data that violates a cap (400) — under bodyLimit, over maxStrLen", async () => {
    // 3000-char string: total body < 8KB bodyLimit (no 413), but the string
    // exceeds SUBMISSIONS_DATA_MAX_STRLEN (2000) -> checkDataCaps -> 400.
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ data: { blob: "x".repeat(3000) } }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid submission" });
  });

  it("accepts a full readable transcript payload (201)", async () => {
    const responses = Array.from({ length: 8 }, (_, i) => ({
      q: `Frage ${i + 1}: Haben Sie einen aktuellen Überblick über Ihre Daten?`,
      a: "Teilweise — die wichtigsten Systeme sind bekannt, Datenflüsse nur grob",
      points: 3,
      max: 5,
    }));
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({
        score: 22,
        data: {
          score: 22,
          max: 36,
          level: "mid",
          pct: 61,
          categories: [
            { label: "Datenkontrolle", score: 6, max: 10, pct: 60 },
            { label: "DSGVO & Nachweise", score: 7, max: 12, pct: 58 },
            { label: "EU AI Act & Automatisierung", score: 4, max: 6, pct: 67 },
            { label: "Infrastruktur & Exit", score: 5, max: 8, pct: 63 },
          ],
          responses,
        },
      }),
    });
    expect(res.statusCode).toBe(201);
  });

  it("rejects a foreign Origin (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { origin: "https://evil.example" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("allows the configured production Origin (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { origin: "https://example.com" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
  });

  it("stores submissions under the site resolved from Origin", async () => {
    const agenticms = await createAgenticmsSite();
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { origin: "https://agenticms.local" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const row = await app.prisma.submission.findUnique({ where: { id: res.json().id as string } });
    expect(row?.siteId).toBe(agenticms.id);
  });

  it("stores same-origin proxied submissions under the site resolved from Host", async () => {
    const agenticms = await createAgenticmsSite();
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { host: "agenticms.local" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const row = await app.prisma.submission.findUnique({ where: { id: res.json().id as string } });
    expect(row?.siteId).toBe(agenticms.id);
  });

  it("stores same-origin proxied submissions under the site resolved from X-Forwarded-Host", async () => {
    const agenticms = await createAgenticmsSite();
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { host: "admin.internal", "x-forwarded-host": "agenticms.local" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const row = await app.prisma.submission.findUnique({ where: { id: res.json().id as string } });
    expect(row?.siteId).toBe(agenticms.id);
  });

  it("rejects a no-origin submission whose Host does not map to a site", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { host: "unknown.example" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns a generic error body on schema-validation failure (no field/constraint leak)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "not-an-email" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid submission" });
  });

  it("allows a request whose only origin signal is a same-site Referer (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { referer: "https://example.com/demo/sample-template" },
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// ref upsert: anonymous result on completion + later same-ref email attach
// ---------------------------------------------------------------------------
describe("POST /api/submissions — ref upsert", () => {
  const REF = "1a2b3c4d-1111-4111-8111-abcdefabcdef";

  it("ref + no email inserts an anonymous row (clientRef set, wantsContact false)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: undefined, ref: REF }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(false);
    const rows = await app.prisma.submission.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].clientRef).toBe(REF);
    expect(rows[0].email).toBeNull();
    expect(rows[0].wantsContact).toBe(false);
  });

  it("same ref + email within window updates the SAME row (one row, attached:true)", async () => {
    await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: undefined, ref: REF }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "lead@firma.ch", ref: REF }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(true);
    const rows = await app.prisma.submission.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("lead@firma.ch");
    expect(rows[0].wantsContact).toBe(true);
    expect(rows[0].clientRef).toBe(REF);
  });

  it("same ref from another site inserts there instead of attaching across sites", async () => {
    const agenticms = await createAgenticmsSite();
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { origin: "https://example.com" },
      payload: validBody({ email: undefined, ref: REF }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { origin: "https://agenticms.local" },
      payload: validBody({ email: "agenticms@firma.ch", ref: REF }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(false);
    const rows = await app.prisma.submission.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.siteId === demo.id)?.email).toBeNull();
    expect(rows.find((r) => r.siteId === agenticms.id)?.email).toBe("agenticms@firma.ch");
  });

  it("email after the attach window inserts a new row (no clobber)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: undefined, ref: REF }),
    });
    await app.prisma.submission.update({
      where: { id: first.json().id as string },
      data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "lead@firma.ch", ref: REF }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(false);
    const rows = await app.prisma.submission.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0].email).toBeNull();
  });

  it("does not overwrite a row that already has an email (inserts instead)", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "first@firma.ch", ref: REF }),
    });
    const firstId = first.json().id as string;
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ email: "second@firma.ch", ref: REF }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().attached).toBe(false);
    const rows = await app.prisma.submission.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === firstId)?.email).toBe("first@firma.ch");
  });

  it("without ref behaves as before (plain insert, clientRef null)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody(),
    });
    expect(res.statusCode).toBe(201);
    const row = await app.prisma.submission.findUnique({ where: { id: res.json().id } });
    expect(row?.clientRef).toBeNull();
    expect(row?.email).toBe("lead@firma.ch");
    expect(row?.wantsContact).toBe(true);
  });

  it("rejects a ref that fails the pattern (400, no row)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ ref: "bad ref!" }),
    });
    expect(res.statusCode).toBe(400);
    expect(await app.prisma.submission.count()).toBe(0);
  });

  it("guards still apply with a ref present (filled honeypot → 400, no row)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      payload: validBody({ ref: REF, hp: "bot" }),
    });
    expect(res.statusCode).toBe(400);
    expect(await app.prisma.submission.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Authed sub-scope (list / read / delete) — lead PII, admin only
// ---------------------------------------------------------------------------
describe("authed /api/submissions scope is admin-only", () => {
  async function seedOne(origin?: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/submissions",
      ...(origin ? { headers: { origin } } : {}),
      payload: validBody(),
    });
    return res.json().id as string;
  }

  it("rejects an editor listing submissions (403)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/submissions",
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an editor deleting a submission (403)", async () => {
    const id = await seedOne();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/submissions/${id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(403);
    const row = await app.prisma.submission.findUnique({ where: { id } });
    expect(row).not.toBeNull();
  });

  it("allows an admin to list submissions (200)", async () => {
    await seedOne();
    const res = await app.inject({
      method: "GET",
      url: "/api/submissions",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("keeps the legacy admin list scoped to the default site", async () => {
    await createAgenticmsSite();
    await seedOne("https://example.com");
    await seedOne("https://agenticms.local");

    const res = await app.inject({
      method: "GET",
      url: "/api/submissions",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].email).toBe("lead@firma.ch");
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    expect(res.json()[0].siteId).toBe(demo.id);
  });

  it("lists submissions through the selected site route only for that site", async () => {
    const agenticms = await createAgenticmsSite();
    await seedOne("https://example.com");
    await seedOne("https://agenticms.local");

    const res = await app.inject({
      method: "GET",
      url: "/api/sites/agenticms/submissions",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].siteId).toBe(agenticms.id);
  });

  it("does not delete a submission through another site's route", async () => {
    await createAgenticmsSite();
    const id = await seedOne("https://example.com");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/sites/agenticms/submissions/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
    const row = await app.prisma.submission.findUnique({ where: { id } });
    expect(row).not.toBeNull();
  });

  it("rejects an unauthenticated list (401)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/submissions" });
    expect(res.statusCode).toBe(401);
  });
});
