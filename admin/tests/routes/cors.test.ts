import {
  describe, it, expect, beforeAll, afterAll, vi,
} from "vitest";
import type { FastifyInstance } from "fastify";

const savedWebsiteUrl = process.env["WEBSITE_URL"];

afterAll(() => {
  if (savedWebsiteUrl === undefined) delete process.env["WEBSITE_URL"];
  else process.env["WEBSITE_URL"] = savedWebsiteUrl;
  vi.resetModules();
});

describe("CORS — no allowed origin configured", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env["WEBSITE_URL"];
    vi.resetModules();
    const mod = await import("../../src/app.js");
    app = await mod.buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("does not reflect an arbitrary Origin with credentials", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/refresh",
      headers: { origin: "https://evil.example" },
    });

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    // A reflected origin together with credentials is the dangerous combo.
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});

describe("CORS — explicit allowlist", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env["WEBSITE_URL"] = "https://example.com,https://staging.example.com";
    vi.resetModules();
    const mod = await import("../../src/app.js");
    app = await mod.buildApp({ logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("allows a configured origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/refresh",
      headers: { origin: "https://staging.example.com" },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://staging.example.com"
    );
  });

  it("does not reflect a foreign origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/refresh",
      headers: { origin: "https://evil.example" },
    });
    expect(res.headers["access-control-allow-origin"]).not.toBe(
      "https://evil.example"
    );
  });
});
