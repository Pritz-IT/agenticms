import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

const INTERNAL_KEY = "test-internal-api-key";

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Clean in dependency order
  await app.prisma.content.deleteMany();
  await app.prisma.navigation.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.stagingAccess.deleteMany();
  await app.prisma.site.deleteMany();
});

// ---------------------------------------------------------------------------
// GET /api/config
// ---------------------------------------------------------------------------
describe("GET /api/config", () => {
  it("returns full config with all sections when called with internal API key", async () => {
    const site = await app.prisma.site.create({
      data: { key: "demo", name: "My Site", domain: "mysite.com", stagingDomain: "staging.mysite.com", defaultLocale: "en" },
    });

    // Seed locale
    await app.prisma.locale.create({ data: { siteId: site.id, code: "en", label: "English", sortOrder: 1 } });

    // Seed layout
    const layout = await app.prisma.layout.create({
      data: { siteId: site.id, name: "home", filePath: "/layouts/home.tsx", detectedKeys: {} },
    });

    // Seed a published page with content
    const page = await app.prisma.page.create({
      data: { siteId: site.id, path: "/home", layoutId: layout.id, sortOrder: 0, isPublished: true },
    });

    await app.prisma.content.create({
      data: { pageId: page.id, key: "title", locale: "en", value: "Welcome", type: "text" },
    });

    // Seed navigation
    const navParent = await app.prisma.navigation.create({
      data: { siteId: site.id, locale: "en", label: "Home", targetPageId: page.id, sortOrder: 0 },
    });

    await app.prisma.navigation.create({
      data: { siteId: site.id, locale: "en", label: "Sub", parentId: navParent.id, sortOrder: 0 },
    });

    // Seed staging access
    await app.prisma.stagingAccess.create({
      data: { siteId: site.id, username: "preview-user", passwordHash: "some-hash" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": INTERNAL_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // All sections present
    expect(body).toHaveProperty("settings");
    expect(body).toHaveProperty("locales");
    expect(body).toHaveProperty("layouts");
    expect(body).toHaveProperty("pages");
    expect(body).toHaveProperty("navigation");
    expect(body).toHaveProperty("stagingAccess");

    // Verify settings
    expect(body.settings.name).toBe("My Site");
    expect(body.settings.domain).toBe("mysite.com");

    // Verify locales
    expect(body.locales).toHaveLength(1);
    expect(body.locales[0].code).toBe("en");

    // Verify layouts
    expect(body.layouts).toHaveLength(1);
    expect(body.layouts[0].name).toBe("home");

    // Verify pages — only published pages, with layout and contents
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0].path).toBe("/home");
    expect(body.pages[0].layout).toBeDefined();
    expect(body.pages[0].layout.name).toBe("home");
    expect(body.pages[0].contents).toHaveLength(1);
    expect(body.pages[0].contents[0].key).toBe("title");

    // Verify navigation — top-level only with nested children
    expect(body.navigation).toHaveLength(1);
    expect(body.navigation[0].label).toBe("Home");
    expect(body.navigation[0].children).toHaveLength(1);
    expect(body.navigation[0].children[0].label).toBe("Sub");

    // Verify stagingAccess
    expect(body.stagingAccess).toHaveLength(1);
    expect(body.stagingAccess[0].username).toBe("preview-user");
  });

  it("excludes unpublished pages", async () => {
    const site = await app.prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "example.com", stagingDomain: "staging.example.com", defaultLocale: "de" },
    });
    await app.prisma.page.create({ data: { siteId: site.id, path: "/draft", sortOrder: 0, isPublished: false } });
    await app.prisma.page.create({ data: { siteId: site.id, path: "/published", sortOrder: 1, isPublished: true } });

    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": INTERNAL_KEY },
    });

    expect(res.statusCode).toBe(200);
    const { pages } = res.json();
    expect(pages).toHaveLength(1);
    expect(pages[0].path).toBe("/published");
  });

  it("returns only assets for the selected host site", async () => {
    const demo = await app.prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "demo.local", stagingDomain: "staging.demo.local", defaultLocale: "de" },
    });
    const agenticms = await app.prisma.site.create({
      data: { key: "agenticms", name: "AgentiCMS", domain: "agenticms.local", stagingDomain: "staging.agenticms.local", defaultLocale: "en" },
    });
    await app.prisma.asset.createMany({
      data: [
        { siteId: demo.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/demo/logo.png", uploadedBy: "test" },
        { siteId: agenticms.id, filename: "logo.png", mimeType: "image/png", filePath: "/assets/agenticms/logo.png", uploadedBy: "test" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": INTERNAL_KEY, host: "agenticms.local" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().settings.key).toBe("agenticms");
    expect(res.json().assets).toEqual([
      expect.objectContaining({ filePath: "/assets/agenticms/logo.png" }),
    ]);
  });

  it("returns empty sections when no data exists", async () => {
    await app.prisma.site.create({
      data: { key: "demo", name: "Demo Site", domain: "example.com", stagingDomain: "staging.example.com", defaultLocale: "de" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": INTERNAL_KEY },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.settings).toMatchObject({ key: "demo", name: "Demo Site" });
    expect(body.locales).toEqual([]);
    expect(body.layouts).toEqual([]);
    expect(body.pages).toEqual([]);
    expect(body.navigation).toEqual([]);
    expect(body.stagingAccess).toEqual([]);
  });

  it("returns 401 without API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/config",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with wrong API key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": "wrong-key" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with a wrong key of the same length as the real key", async () => {
    // Guards the constant-time comparison path: a same-length but incorrect
    // key must still be rejected (not just length-checked).
    const sameLenWrong = "x".repeat(INTERNAL_KEY.length);
    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": sameLenWrong },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 (not 500) when the API key header is sent more than once", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { "x-api-key": [INTERNAL_KEY, "tampered"] as unknown as string },
    });

    expect(res.statusCode).toBe(401);
  });
});
