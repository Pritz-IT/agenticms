import {
  describe, it, expect, beforeAll, afterAll, beforeEach, vi,
} from "vitest";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

// Snapshot the env keys this suite mutates so later suites in the same
// worker are not affected.
const ENV_KEYS = [
  "SUBMISSIONS_RATE_MAX",
  "SUBMISSIONS_RATE_WINDOW",
  "TRUST_PROXY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.SUBMISSIONS_RATE_MAX = "2";
  process.env.SUBMISSIONS_RATE_WINDOW = "60000";
  process.env.TRUST_PROXY = "true"; // honor X-Forwarded-For in this test

  // Force a fresh module graph so config.ts re-reads the env above
  // (vitest caches modules across files; a static import would be stale).
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
  vi.resetModules(); // later suites re-import config fresh via setupFiles
});

beforeEach(async () => {
  await app.prisma.submission.deleteMany();
  await app.prisma.site.deleteMany();
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
});

function validBody() {
  return {
    form: "sample-template",
    email: "lead@firma.ch",
    score: 12,
    data: { answers: [0, 1, 2], level: "low", pct: 8 },
    hp: "",
    t: 9000,
  };
}

describe("POST /api/submissions rate limit", () => {
  const fire = (ip: string) =>
    app.inject({
      method: "POST",
      url: "/api/submissions",
      headers: { "x-forwarded-for": ip },
      payload: validBody(),
    });

  it("limits per client IP (X-Forwarded-For), separate buckets per IP", async () => {
    expect((await fire("203.0.113.9")).statusCode).toBe(201);
    expect((await fire("203.0.113.9")).statusCode).toBe(201);
    expect((await fire("203.0.113.9")).statusCode).toBe(429);
    // IP B has its own fresh bucket -> not blocked by IP A's count
    expect((await fire("198.51.100.7")).statusCode).toBe(201);
  });
});
