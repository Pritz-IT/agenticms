import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let app: FastifyInstance;
let editorToken: string;
let defaultSiteId: string;

const sampleKeys = {
  "hero.title": { type: "text", initial: "Welcome" },
  "body.text": { type: "richtext", initial: "Lorem ipsum" },
};

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

describe("GET /api/sites/:siteKey/layouts/:id/module.js", () => {
  it("serves a legacy root-level layout through the site-scoped module route", async () => {
    const originalLayoutsDir = config.LAYOUTS_DIR;
    const dir = await mkdtemp(join(tmpdir(), "sf-site-layout-module-"));
    try {
      (config as { LAYOUTS_DIR: string }).LAYOUTS_DIR = dir;
      await writeFile(join(dir, "LegacyHome.tsx"), `
        export const keys = { "hero.title": { type: "text", initial: "Hello" } };
        export default function LegacyHome() { return <main>Hello</main>; }
      `);
      const layout = await app.prisma.layout.create({
        data: {
          siteId: defaultSiteId,
          name: "LegacyHome",
          filePath: "/layouts/LegacyHome.tsx",
          detectedKeys: {},
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/sites/demo/layouts/${layout.id}/module.js`,
        headers: { authorization: `Bearer ${editorToken}` },
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.headers["content-type"]).toContain("text/javascript");
      expect(res.body).toContain("LegacyHome");
    } finally {
      (config as { LAYOUTS_DIR: string }).LAYOUTS_DIR = originalLayoutsDir;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
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

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);
});

// ---------------------------------------------------------------------------
// GET /api/layouts
// ---------------------------------------------------------------------------
describe("GET /api/layouts", () => {
  it("returns all layouts with their keys", async () => {
    await app.prisma.layout.createMany({
      data: [
        {
          siteId: defaultSiteId,
          name: "home",
          filePath: "/layouts/home.tsx",
          detectedKeys: sampleKeys,
        },
        {
          siteId: defaultSiteId,
          name: "about",
          filePath: "/layouts/about.tsx",
          detectedKeys: {},
        },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    // Ordered by updatedAt desc — both just created, order may vary, just check presence
    const names = body.map((l: { name: string }) => l.name);
    expect(names).toContain("home");
    expect(names).toContain("about");
    // Verify detectedKeys is returned
    const home = body.find((l: { name: string }) => l.name === "home");
    expect(home.detectedKeys).toEqual(sampleKeys);
  });

  it("returns empty array when no layouts exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/layouts",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/layouts",
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/layouts/:id
// ---------------------------------------------------------------------------
describe("GET /api/layouts/:id", () => {
  it("returns a single layout by id", async () => {
    const layout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "hero",
        filePath: "/layouts/hero.tsx",
        detectedKeys: sampleKeys,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(layout.id);
    expect(body.name).toBe("hero");
    expect(body.filePath).toBe("/layouts/hero.tsx");
    expect(body.detectedKeys).toEqual(sampleKeys);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/layouts/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Layout not found" });
  });

  it("returns 401 without auth", async () => {
    const layout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "hero",
        filePath: "/layouts/hero2.tsx",
        detectedKeys: {},
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/layouts/${layout.id}`,
    });

    expect(res.statusCode).toBe(401);
  });
});
