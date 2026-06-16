import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

const records: any[] = [];
let app: FastifyInstance;
let auth: string;
let siteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  records.length = 0;
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.stagingAccess.deleteMany();
  await app.prisma.user.deleteMany();
  const site = await app.prisma.site.upsert({
    where: { key: "demo" },
    update: {},
    create: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });
  siteId = site.id;
  const { user } = await createTestUser(app, { role: "admin" });
  auth = `Bearer ${getAccessToken(user)}`;
});

describe("remaining mutation logging", () => {
  it("staging-access create logs INFO entry+outcome", async () => {
    const res = await app.inject({ method: "POST", url: "/api/staging-access", headers: { authorization: auth }, payload: { username: "preview", password: "pw-12345" } });
    expect([200, 201]).toContain(res.statusCode);
    const recs = records.filter((r) => typeof r.op === "string" && r.op.startsWith("stagingAccess."));
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.some((r) => /done/.test(r.msg))).toBe(true);
    expect(JSON.stringify(records)).not.toContain("pw-12345");
  });

  it("content create logs INFO entry+outcome", async () => {
    const page = await app.prisma.page.create({ data: { siteId, path: "/test-content-log", sortOrder: 0, isPublished: false } });
    const res = await app.inject({
      method: "POST",
      url: "/api/content",
      headers: { authorization: auth },
      payload: { pageId: page.id, key: "hero.title", locale: "de", value: "Test value", type: "text" },
    });
    expect([200, 201]).toContain(res.statusCode);
    const recs = records.filter((r) => typeof r.op === "string" && r.op.startsWith("content."));
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.some((r) => /done/.test(r.msg))).toBe(true);
  });

  it("content update logs INFO entry+outcome", async () => {
    const page = await app.prisma.page.create({ data: { siteId, path: "/test-content-update-log", sortOrder: 0, isPublished: false } });
    const content = await app.prisma.content.create({
      data: { pageId: page.id, key: "hero.title", locale: "de", value: "original", type: "text" },
    });
    const res = await app.inject({
      method: "PUT",
      url: `/api/content/${content.id}`,
      headers: { authorization: auth },
      payload: { value: "updated" },
    });
    expect([200, 201]).toContain(res.statusCode);
    const recs = records.filter((r) => typeof r.op === "string" && r.op.startsWith("content."));
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.some((r) => /done/.test(r.msg))).toBe(true);
  });

  it("content delete logs INFO entry+outcome", async () => {
    const page = await app.prisma.page.create({ data: { siteId, path: "/test-content-delete-log", sortOrder: 0, isPublished: false } });
    const content = await app.prisma.content.create({
      data: { pageId: page.id, key: "hero.title", locale: "de", value: "val", type: "text" },
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/api/content/${content.id}`,
      headers: { authorization: auth },
    });
    expect(res.statusCode).toBe(200);
    const recs = records.filter((r) => typeof r.op === "string" && r.op.startsWith("content."));
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.some((r) => /done/.test(r.msg))).toBe(true);
  });
});
