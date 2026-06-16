import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestUser } from "../helpers/auth.js";

let app: FastifyInstance;

// Snapshot the env keys this suite mutates so later suites in the same
// worker are not affected.
const ENV_KEYS = ["LOGIN_RATE_MAX", "LOGIN_RATE_WINDOW", "TRUST_PROXY"] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.LOGIN_RATE_MAX = "3";
  process.env.LOGIN_RATE_WINDOW = "60000";
  process.env.TRUST_PROXY = "true"; // honor X-Forwarded-For in this test

  // Force a fresh module graph so config.ts re-reads the env above.
  vi.resetModules();
  const mod = await import("../../src/app.js");
  app = await mod.buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.resetModules();
});

beforeEach(async () => {
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
});

describe("POST /api/auth/login rate limit", () => {
  it("throttles repeated login attempts per client IP", async () => {
    const { user, password } = await createTestUser(app, { role: "admin" });

    const attempt = (ip: string, pw: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { "x-forwarded-for": ip },
        payload: { email: user.email, password: pw },
      });

    // 3 allowed (wrong password -> 401), 4th from same IP -> 429
    expect((await attempt("203.0.113.1", "bad")).statusCode).toBe(401);
    expect((await attempt("203.0.113.1", "bad")).statusCode).toBe(401);
    expect((await attempt("203.0.113.1", "bad")).statusCode).toBe(401);
    expect((await attempt("203.0.113.1", "bad")).statusCode).toBe(429);

    // A correct password from the now-blocked IP is still refused (429),
    // i.e. the limiter trips before credential evaluation.
    expect((await attempt("203.0.113.1", password)).statusCode).toBe(429);

    // A different IP has its own fresh bucket.
    expect((await attempt("198.51.100.2", password)).statusCode).toBe(200);
  });
});
