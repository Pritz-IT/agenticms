import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

const records: any[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => { records.length = 0; await app.prisma.user.deleteMany(); });

describe("auth denial logging", () => {
  it("logs DEBUG when the Authorization header is missing", async () => {
    await app.inject({ method: "GET", url: "/api/users" });
    expect(records.some((r) => r.level === 20 && /auth/i.test(r.msg))).toBe(true);
  });

  it("logs DEBUG when the token is invalid", async () => {
    await app.inject({ method: "GET", url: "/api/users", headers: { authorization: "Bearer not.a.jwt" } });
    expect(records.some((r) => r.level === 20 && /auth/i.test(r.msg))).toBe(true);
  });

  it("logs WARN with role context when an editor hits an admin route", async () => {
    const { user } = await createTestUser(app, { role: "editor" });
    await app.inject({ method: "GET", url: "/api/users", headers: { authorization: `Bearer ${getAccessToken(user)}` } });
    const warn = records.find((r) => r.level === 40 && r.requiredRole === "admin");
    expect(warn).toBeTruthy();
    expect(warn.actualRole).toBe("editor");
  });
});
