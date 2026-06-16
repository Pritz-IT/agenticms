import { describe, it, expect, vi } from "vitest";

async function freshLoggerOptions(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  vi.resetModules();
  try {
    const mod = await import("../../src/logging.js");
    return mod.loggerOptions;
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

describe("loggerOptions", () => {
  it("defaults to debug in non-production and info in production", async () => {
    expect((await freshLoggerOptions({ NODE_ENV: "development", LOG_LEVEL: undefined })).level).toBe("debug");
    expect((await freshLoggerOptions({ NODE_ENV: "production", LOG_LEVEL: undefined })).level).toBe("info");
  });

  it("LOG_LEVEL overrides the NODE_ENV default", async () => {
    expect((await freshLoggerOptions({ NODE_ENV: "production", LOG_LEVEL: "trace" })).level).toBe("trace");
  });

  it("omits transport under NODE_ENV=test so a stream can be injected", async () => {
    expect((await freshLoggerOptions({ NODE_ENV: "test", LOG_LEVEL: undefined })).transport).toBeUndefined();
  });

  it("redacts auth/cookie/secret paths", async () => {
    const opts = await freshLoggerOptions({ NODE_ENV: "test" });
    const paths = (opts.redact as { paths: string[] }).paths;
    expect(paths).toContain("req.headers.authorization");
    expect(paths).toContain("req.headers.cookie");
    expect(paths).toContain('req.headers["x-api-key"]');
  });

  it("genReqId honors a sane inbound X-Request-Id and generates otherwise", async () => {
    const opts = await freshLoggerOptions({ NODE_ENV: "test" });
    const gen = opts.genReqId as (req: { headers: Record<string, unknown> }) => string;
    expect(gen({ headers: { "x-request-id": "abc-123_DEF.4" } })).toBe("abc-123_DEF.4");
    const bad = gen({ headers: { "x-request-id": "bad id with spaces" } });
    expect(bad).not.toBe("bad id with spaces");
    expect(bad).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(gen({ headers: {} })).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
