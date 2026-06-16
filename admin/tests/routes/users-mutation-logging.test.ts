import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

const records: any[] = [];
let app: FastifyInstance;
let adminAuth: string;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  records.length = 0;
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  const { user } = await createTestUser(app, { role: "admin", email: "a@example.com" });
  adminAuth = `Bearer ${getAccessToken(user)}`;
});

describe("users mutation logging", () => {
  it("logs INFO entry+outcome with the new id on create (no password/email in logs)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/users", headers: { authorization: adminAuth }, payload: { email: "new@example.com", password: "supersecret1", role: "editor" } });
    const id = res.json().id;
    const recs = records.filter((r) => r.op === "user.create");
    expect(recs.some((r) => /requested/.test(r.msg))).toBe(true);
    expect(recs.find((r) => /done/.test(r.msg)).userId).toBe(id);
    expect(JSON.stringify(records)).not.toContain("supersecret1");
  });

  it("logs INFO NO-OP when updating a missing user", async () => {
    await app.inject({ method: "PUT", url: "/api/users/does-not-exist", headers: { authorization: adminAuth }, payload: { role: "editor" } });
    expect(records.some((r) => r.op === "user.update" && /NO-OP/.test(r.msg))).toBe(true);
  });
});
