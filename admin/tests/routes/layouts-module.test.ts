import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let token: string;
let tempDir: string;
let layoutsDir: string;
let compiledLayoutsDir: string;
let defaultSiteId: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-layouts-route-"));
  layoutsDir = join(tempDir, "layouts");
  compiledLayoutsDir = join(tempDir, "layout-modules");
  (config as { LAYOUTS_DIR: string; COMPILED_LAYOUTS_DIR: string }).LAYOUTS_DIR = layoutsDir;
  (config as { LAYOUTS_DIR: string; COMPILED_LAYOUTS_DIR: string }).COMPILED_LAYOUTS_DIR = compiledLayoutsDir;
  await mkdir(layoutsDir, { recursive: true });
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  const site = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "en",
    },
  });
  defaultSiteId = site.id;
  const { user } = await createTestUser(app, { role: "editor" });
  token = getAccessToken(user);
});

describe("GET /api/layouts/:id/module.js", () => {
  it("serves a compiled layout module", async () => {
    const file = join(layoutsDir, "Home.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Hello" } };
      export default function Home() { return <main>Hello</main>; }
    `);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Home", filePath: file, detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toContain("export");
  });

  it("serves a module for watcher-style paths relative to the project root", async () => {
    const relativePath = join(config.LAYOUTS_DIR, "Relative.tsx");
    const file = resolve(relativePath);
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Relative" } };
      export default function Relative() { return <main>Relative</main>; }
    `);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Relative", filePath: relativePath, detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Relative");
  });

  it("serves a module for legacy /layouts-prefixed paths", async () => {
    const file = join(layoutsDir, "LegacyHome.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Legacy" } };
      export default function LegacyHome() { return <main>Legacy</main>; }
    `);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Legacy Home", filePath: "/layouts/LegacyHome.tsx", detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Legacy");
  });

  it("rejects layout files that symlink outside the layouts directory", async () => {
    const outsideFile = join(tempDir, "Outside.tsx");
    const symlinkPath = join(layoutsDir, "Outside.tsx");
    await writeFile(outsideFile, `
      export default function Outside() { return <main>Outside</main>; }
    `);
    await symlink(outsideFile, symlinkPath);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Outside", filePath: symlinkPath, detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Layout path is outside layouts directory" });
  });

  it("returns 404 for an unknown layout id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/layouts/unknown/module.js",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Layout not found" });
  });

  it("returns 422 for compile errors when there is no last-good module", async () => {
    const file = join(layoutsDir, "Broken.tsx");
    await writeFile(file, `export default function Broken() { return <main>; }`);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Broken", filePath: file, detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it("serves last-good with X-SF-Stale when the current layout is broken", async () => {
    const file = join(layoutsDir, "Stale.tsx");
    await writeFile(file, `export default function Stale() { return <main>Good</main>; }`);
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Stale", filePath: file, detectedKeys: {} },
    });

    const first = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);

    await writeFile(file, `export default function Stale() { return <main>; }`);

    const second = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(second.statusCode).toBe(200);
    expect(second.headers["x-sf-stale"]).toBe("1");
    expect(second.body).toContain("Good");
  });

  it("does not fall back to the global layouts root for non-default site preview modules", async () => {
    const agenticms = await app.prisma.site.create({
      data: {
        key: "agenticms",
        name: "AgentiCMS",
        domain: "agenticms.local",
        stagingDomain: "staging.agenticms.local",
        defaultLocale: "en",
      },
    });
    const file = join(layoutsDir, "Home.tsx");
    await writeFile(file, `
      export const keys = { "hero.title": { type: "text", initial: "Wrong root" } };
      export default function Home() { return <main>Wrong root</main>; }
    `);
    const layout = await app.prisma.layout.create({
      data: { siteId: agenticms.id, name: "Home", filePath: "Home.tsx", detectedKeys: {} },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/sites/agenticms/layouts/${layout.id}/module.js`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect([403, 422]).toContain(res.statusCode);
    expect(res.body).not.toContain("Wrong root");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/layouts/anything/module.js" });
    expect(res.statusCode).toBe(401);
  });
});
