import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser } from "../helpers/auth.js";

const records: any[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => { records.length = 0; await app.prisma.refreshToken.deleteMany(); await app.prisma.user.deleteMany(); });

describe("auth mutation logging", () => {
  it("logs INFO entry+outcome with userId (never email) on successful login", async () => {
    const { user, password } = await createTestUser(app, { role: "admin" });
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: user.email, password } });
    const recs = records.filter((r) => r.op === "auth.login");
    expect(recs.some((r) => r.level === 30 && /requested/.test(r.msg))).toBe(true);
    const done = recs.find((r) => r.level === 30 && /done/.test(r.msg));
    expect(done.userId).toBe(user.id);
    expect(JSON.stringify(records)).not.toContain(user.email);
  });

  it("logs INFO outcome on logout even with no cookie (NO-OP)", async () => {
    await app.inject({ method: "POST", url: "/api/auth/logout" });
    expect(records.some((r) => r.op === "auth.logout" && r.level === 30)).toBe(true);
  });
});
