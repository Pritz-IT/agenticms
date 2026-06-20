import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";

let app: FastifyInstance;
const originalAdminPublicUrl = config.ADMIN_PUBLIC_URL;

function setAdminPublicUrl(value: string): void {
  (config as unknown as { ADMIN_PUBLIC_URL: string }).ADMIN_PUBLIC_URL = value;
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

beforeEach(() => {
  setAdminPublicUrl(originalAdminPublicUrl);
});

afterAll(async () => {
  setAdminPublicUrl(originalAdminPublicUrl);
  await app?.close();
});

describe("CLI installer downloads", () => {
  it("serves an install script that downloads the CLI from the current admin origin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "cms.example.test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/x-shellscript");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(res.headers["etag"]).toMatch(/^"agenticms-cli-install:/);
    expect(res.body).toContain("DEFAULT_AGENTICMS_ADMIN_URL='https://cms.example.test'");
    expect(res.body).toContain('AGENTICMS_ADMIN_URL="${AGENTICMS_ADMIN_URL:-$DEFAULT_AGENTICMS_ADMIN_URL}"');
    expect(res.body).toContain("/api/cli/agenticms-cli.tar.gz");
    expect(res.body).toContain("\"$BIN_DIR/agenticms\" login \"$AGENTICMS_ADMIN_URL\"");
    expect(res.body).not.toContain("JWT_SECRET");
    expect(res.body).not.toContain("INTERNAL_API_KEY");
  });

  it("keeps local development installer origins on http", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "localhost:3000" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("DEFAULT_AGENTICMS_ADMIN_URL='http://localhost:3000'");
  });

  it("uses configured public admin origin after stripping path, query, and fragment", async () => {
    setAdminPublicUrl("https://cms.example.test/path?q=1#x");

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "evil.test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("DEFAULT_AGENTICMS_ADMIN_URL='https://cms.example.test'");
    expect(res.body).not.toContain("evil.test");
    expect(res.body).not.toContain("/path?q=1#x");
  });

  it("rejects configured non-local http admin origins", async () => {
    setAdminPublicUrl("http://cms.example.test");

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "cms.example.test" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });

  it("rejects host-derived installer origins with shell metacharacters", async () => {
    setAdminPublicUrl("");

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "cms.example.test$(touch /tmp/pwn)" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });

  it.each([
    "cms.example.test/path",
    "cms.example.test?x=1",
    "cms.example.test#x",
    "cms.example.test\\path",
  ])("rejects host-derived installer origins with URL delimiters before URL canonicalization: %s", async (host) => {
    setAdminPublicUrl("");

    const res = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty("error");
  });

  it("returns 304 for a matching install script validator", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: { host: "cms.example.test" },
    });

    const second = await app.inject({
      method: "GET",
      url: "/api/cli/install.sh",
      headers: {
        host: "cms.example.test",
        "if-none-match": String(first.headers["etag"]),
      },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("serves a gzipped CLI tarball without requiring authentication", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cli/agenticms-cli.tar.gz",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/gzip");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="agenticms-cli.tar.gz"');
    expect(res.headers["cache-control"]).toBe("public, max-age=3600, must-revalidate");
    expect(res.headers["etag"]).toMatch(/^"agenticms-cli-archive:/);

    const body = res.rawPayload;
    expect(body[0]).toBe(0x1f);
    expect(body[1]).toBe(0x8b);
    expect(body.length).toBeGreaterThan(1000);
  });

  it("reuses the tarball validator for unchanged CLI package files", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/cli/agenticms-cli.tar.gz",
    });

    const second = await app.inject({
      method: "GET",
      url: "/api/cli/agenticms-cli.tar.gz",
      headers: { "if-none-match": String(first.headers["etag"]) },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("serves byte-stable tarballs across unchanged non-conditional requests", async () => {
    const first = await app.inject({
      method: "GET",
      url: "/api/cli/agenticms-cli.tar.gz",
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/cli/agenticms-cli.tar.gz",
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.headers["etag"]).toBe(first.headers["etag"]);
    expect(Buffer.compare(first.rawPayload, second.rawPayload)).toBe(0);
  });
});
