import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

const records: any[] = [];
let app: FastifyInstance;
let auth: string;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  records.length = 0;
  await app.prisma.navigation.deleteMany();
  await app.prisma.user.deleteMany();
  await app.prisma.site.upsert({
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
  const { user } = await createTestUser(app, { role: "admin" });
  auth = `Bearer ${getAccessToken(user)}`;
});

describe("navigation mutation logging", () => {
  it("logs INFO entry+outcome on create", async () => {
    const res = await app.inject({ method: "POST", url: "/api/navigation", headers: { authorization: auth }, payload: { locale: "de", label: "Home" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    const recs = records.filter((r) => r.op === "nav.create");
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.find((r) => /done/.test(r.msg)).navId).toBe(id);
  });

  it("logs INFO NO-OP on delete of a missing nav item", async () => {
    await app.inject({ method: "DELETE", url: "/api/navigation/nope", headers: { authorization: auth } });
    expect(records.some((r) => r.op === "nav.delete" && /NO-OP/.test(r.msg))).toBe(true);
  });
});
