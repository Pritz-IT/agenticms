import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let adminToken: string;
let defaultSiteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.locale.deleteMany();
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

  const { user: admin } = await createTestUser(app, { role: "admin" });
  adminToken = getAccessToken(admin);
});

// ---------------------------------------------------------------------------
// POST /api/locales
// ---------------------------------------------------------------------------
describe("POST /api/locales", () => {
  it("creates a locale (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/locales",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "en", label: "English", isDefault: true, sortOrder: 0 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      code: "en",
      label: "English",
      isDefault: true,
      sortOrder: 0,
    });
    expect(body).toHaveProperty("id");
  });

  it("ensures only one default locale when creating a new default", async () => {
    // Create first default locale
    await app.inject({
      method: "POST",
      url: "/api/locales",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "en", label: "English", isDefault: true, sortOrder: 0 },
    });

    // Create second locale also as default
    const res = await app.inject({
      method: "POST",
      url: "/api/locales",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "de", label: "German", isDefault: true, sortOrder: 1 },
    });

    expect(res.statusCode).toBe(201);

    // Check that only the new locale is default
    const allLocales = await app.prisma.locale.findMany();
    const defaults = allLocales.filter((l) => l.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.code).toBe("de");

    await expect(app.prisma.site.findUniqueOrThrow({ where: { id: defaultSiteId } })).resolves.toMatchObject({
      defaultLocale: "de",
    });
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/locales",
      payload: { code: "fr", label: "French" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/locales
// ---------------------------------------------------------------------------
describe("GET /api/locales", () => {
  it("returns all locales sorted by sortOrder", async () => {
    // Seed locales out of order
    await app.prisma.locale.createMany({
      data: [
        { siteId: defaultSiteId, code: "de", label: "German", sortOrder: 2 },
        { siteId: defaultSiteId, code: "fr", label: "French", sortOrder: 3 },
        { siteId: defaultSiteId, code: "en", label: "English", isDefault: true, sortOrder: 1 },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/locales",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);
    expect(body[0].code).toBe("en");
    expect(body[1].code).toBe("de");
    expect(body[2].code).toBe("fr");
  });

  it("returns empty array when no locales exist", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/locales",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/locales/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/locales/:id", () => {
  it("removes a locale", async () => {
    const locale = await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "en", label: "English", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/locales/${locale.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.locale.findUnique({ where: { id: locale.id } });
    expect(remaining).toBeNull();
  });

  it("returns 404 for unknown locale id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/locales/nonexistent-id",
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const locale = await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "en", label: "English", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/locales/${locale.id}`,
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/sites/:siteKey/locales/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/sites/:siteKey/locales/:id", () => {
  it("sets a site default locale and keeps locale flags in sync", async () => {
    const en = await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "en", label: "English", isDefault: true, sortOrder: 0 },
    });
    const de = await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "de", label: "Deutsch", isDefault: false, sortOrder: 1 },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sites/demo/locales/${de.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { isDefault: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: de.id, code: "de", isDefault: true });

    await expect(app.prisma.site.findUniqueOrThrow({ where: { id: defaultSiteId } })).resolves.toMatchObject({
      defaultLocale: "de",
    });

    const locales = await app.prisma.locale.findMany({ where: { siteId: defaultSiteId }, orderBy: { code: "asc" } });
    expect(locales.map((locale) => ({ id: locale.id, isDefault: locale.isDefault }))).toEqual([
      { id: de.id, isDefault: true },
      { id: en.id, isDefault: false },
    ]);
  });

  it("renames a locale code and moves site content and navigation for that code", async () => {
    const locale = await app.prisma.locale.create({
      data: { siteId: defaultSiteId, code: "en", label: "English", isDefault: true, sortOrder: 0 },
    });
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "Home", filePath: "Home.tsx", detectedKeys: {} },
    });
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/", layoutId: layout.id },
    });
    await app.prisma.content.create({
      data: { pageId: page.id, key: "hero.title", locale: "en", value: "Hello", type: "text" },
    });
    await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Home", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/sites/demo/locales/${locale.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { code: "de", label: "Deutsch" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: locale.id, code: "de", label: "Deutsch", isDefault: true });

    await expect(app.prisma.site.findUniqueOrThrow({ where: { id: defaultSiteId } })).resolves.toMatchObject({
      defaultLocale: "de",
    });
    await expect(app.prisma.content.findMany({ where: { pageId: page.id } })).resolves.toMatchObject([
      { locale: "de", value: "Hello" },
    ]);
    await expect(app.prisma.navigation.findMany({ where: { siteId: defaultSiteId } })).resolves.toMatchObject([
      { locale: "de", label: "Home" },
    ]);
  });
});
