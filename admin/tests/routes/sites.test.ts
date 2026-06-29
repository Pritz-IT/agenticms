import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { config } from "../../src/config.js";
import { approveDeviceChallenge, consumeApprovedChallenge, createDeviceChallenge } from "../../src/services/cli-auth.js";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let app: FastifyInstance;
let adminToken: string;
let editorToken: string;
let tempDir: string;
let layoutsDir: string;
let assetsDir: string;
let buildsDir: string;
let userCounter = 0;

function uniqueEmail(prefix: string): string {
  userCounter += 1;
  return `${prefix}-${userCounter}@example.com`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function issueCliToken(): Promise<string> {
  const { user: admin } = await createTestUser(app, { role: "admin", email: uniqueEmail("cli-admin") });
  const challenge = await createDeviceChallenge(app.prisma, "Sites test");
  expect(await approveDeviceChallenge(app.prisma, challenge.deviceId, challenge.code, admin)).toBe(true);
  const issued = await consumeApprovedChallenge(app.prisma, challenge.deviceId, challenge.deviceSecret);
  expect(issued).toBeTruthy();
  return issued!.token;
}

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-sites-"));
  layoutsDir = join(tempDir, "layouts");
  assetsDir = join(tempDir, "assets");
  buildsDir = join(tempDir, "builds");
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; BUILDS_DIR: string }).LAYOUTS_DIR = layoutsDir;
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; BUILDS_DIR: string }).ASSETS_DIR = assetsDir;
  (config as { LAYOUTS_DIR: string; ASSETS_DIR: string; BUILDS_DIR: string }).BUILDS_DIR = buildsDir;
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await rm(layoutsDir, { recursive: true, force: true });
  await rm(assetsDir, { recursive: true, force: true });
  await rm(buildsDir, { recursive: true, force: true });
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.cliToken.deleteMany();
  await app.prisma.cliDeviceChallenge.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: admin } = await createTestUser(app, { role: "admin", email: uniqueEmail("admin") });
  const { user: editor } = await createTestUser(app, { role: "editor", email: uniqueEmail("editor") });
  adminToken = getAccessToken(admin);
  editorToken = getAccessToken(editor);
});

describe("GET /api/sites", () => {
  it("returns sites ordered by name for an authenticated user", async () => {
    await app.prisma.site.createMany({
      data: [
        {
          key: "z-site",
          name: "Zeta Site",
          domain: "zeta.example.com",
          stagingDomain: "staging-zeta.example.com",
          defaultLocale: "de",
          siteUrl: "https://zeta.example.com",
        },
        {
          key: "alpha",
          name: "Alpha Site",
          domain: "alpha.example.com",
          stagingDomain: "staging-alpha.example.com",
          defaultLocale: "en",
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/sites",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body.map((site: { name: string }) => site.name)).toEqual(["Alpha Site", "Zeta Site"]);
    expect(body[0]).toMatchObject({
      key: "alpha",
      name: "Alpha Site",
      domain: "alpha.example.com",
      stagingDomain: "staging-alpha.example.com",
      defaultLocale: "en",
      siteUrl: null,
    });
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sites",
    });

    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/sites", () => {
  it("creates a site, default locale, and local site directories for an admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.example.com",
        stagingDomain: "staging-demo.example.com",
        defaultLocale: "de",
        siteUrl: "https://demo.example.com",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      key: "demo",
      name: "Demo Site",
      domain: "demo.example.com",
      stagingDomain: "staging-demo.example.com",
      defaultLocale: "de",
      siteUrl: "https://demo.example.com",
    });

    const locale = await app.prisma.locale.findFirst({ where: { site: { key: "demo" }, code: "de" } });
    expect(locale).toMatchObject({ label: "DE", isDefault: true, sortOrder: 0 });
    await expect(fileExists(join(layoutsDir, "demo"))).resolves.toBe(true);
    await expect(fileExists(join(assetsDir, "demo"))).resolves.toBe(true);
    await expect(fileExists(join(buildsDir, "demo"))).resolves.toBe(true);
  });

  it("requires an admin user", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {
        key: "demo",
        name: "Demo Site",
        domain: "demo.example.com",
        stagingDomain: "staging-demo.example.com",
        defaultLocale: "de",
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it("rejects unsafe host map values before writing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        key: "demo;bad",
        name: "Demo Site",
        domain: "demo.example.com",
        stagingDomain: "staging-demo.example.com",
        defaultLocale: "de",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("key");
  });

  it("does not persist a site when local directory setup fails", async () => {
    const blockedBuildsPath = join(tempDir, "blocked-builds");
    await writeFile(blockedBuildsPath, "not a directory");
    (config as { BUILDS_DIR: string }).BUILDS_DIR = blockedBuildsPath;

    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/sites",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          key: "blocked-demo",
          name: "Blocked Demo",
          domain: "blocked-demo.example.com",
          stagingDomain: "staging-blocked-demo.example.com",
          defaultLocale: "de",
        },
      });

      expect(res.statusCode).toBe(400);
      await expect(app.prisma.site.findUnique({ where: { key: "blocked-demo" } })).resolves.toBeNull();
    } finally {
      (config as { BUILDS_DIR: string }).BUILDS_DIR = buildsDir;
    }
  });
});

describe("POST /api/cli/sites", () => {
  it("creates a site through a scoped CLI token", async () => {
    const token = await issueCliToken();

    const res = await app.inject({
      method: "POST",
      url: "/api/cli/sites",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        key: "cli-demo",
        name: "CLI Demo",
        domain: "cli-demo.example.com",
        stagingDomain: "staging-cli-demo.example.com",
        defaultLocale: "en",
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ key: "cli-demo", name: "CLI Demo" });
    await expect(fileExists(join(layoutsDir, "cli-demo"))).resolves.toBe(true);
  });
});

describe("generated site runtime map", () => {
  it("returns nginx host map entries and site keys for internal callers only", async () => {
    await app.prisma.site.createMany({
      data: [
        {
          key: "demo",
          name: "Demo Site",
          domain: "example.com",
          stagingDomain: "staging.example.com",
          defaultLocale: "de",
          siteUrl: "https://www.example.com",
        },
        {
          key: "agenticms",
          name: "AgentiCMS",
          domain: "agenticms.example.com",
          stagingDomain: "staging-agenticms.example.com",
          defaultLocale: "en",
        },
      ],
    });

    const publicRes = await app.inject({ method: "GET", url: "/api/sites/nginx-map" });
    expect(publicRes.statusCode).toBe(401);

    const mapRes = await app.inject({
      method: "GET",
      url: "/api/sites/nginx-map",
      headers: { "x-api-key": "test-internal-api-key" },
    });
    expect(mapRes.statusCode).toBe(200);
    expect(mapRes.headers["content-type"]).toContain("text/plain");
    expect(mapRes.body).toContain("default demo;");
    expect(mapRes.body).toContain("example.com demo;");
    expect(mapRes.body).toContain("www.example.com demo;");
    expect(mapRes.body).toContain("agenticms.example.com agenticms;");
    // Auto `www.` alias: a host with no explicitly-configured www variant still
    // gets one generated, so www.<domain> reaches the site instead of default.
    expect(mapRes.body).toContain("www.agenticms.example.com agenticms;");

    const keysRes = await app.inject({
      method: "GET",
      url: "/api/sites/keys.txt",
      headers: { "x-api-key": "test-internal-api-key" },
    });
    expect(keysRes.statusCode).toBe(200);
    expect(keysRes.body.trim()).toBe("agenticms demo");
  });
});
