import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

import { createBlogFixture } from "../helpers/blog.js";
import * as routeLock from "../../src/services/blog/route-lock.js";

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


describe.each(["/api/locales", "/api/sites/demo/locales"])("blog locale lifecycle via %s", (url) => {
  beforeEach(async () => {
    await app.prisma.site.update({ where: { id: defaultSiteId }, data: { defaultLocale: "de" } });
    await app.prisma.locale.createMany({ data: [
      { siteId: defaultSiteId, code: "de", label: "Deutsch", isDefault: true },
      { siteId: defaultSiteId, code: "en", label: "English" },
    ] });
  });

  async function englishLocale() {
    return app.prisma.locale.findUniqueOrThrow({ where: { siteId_code: { siteId: defaultSiteId, code: "en" } } });
  }

  async function seedBlogNames(siteId = defaultSiteId) {
    const fixture = await createBlogFixture(app, siteId);
    await app.prisma.blogCategoryName.create({ data: { categoryId: fixture.category.id, locale: "en", name: "News" } });
    const tag = await app.prisma.blogTag.create({ data: {
      siteId, key: "transport", names: { create: { locale: "en", name: "Transport" } },
    } });
    return { ...fixture, tag };
  }

  it.each(["rename", "delete", "switch"])("keeps another site's blog data unchanged on %s", async (operation) => {
    const other = await app.prisma.site.create({ data: {
      key: "other", name: "Other", domain: "other.test", stagingDomain: "staging.other.test", defaultLocale: "de",
    } });
    const { post, category, tag, page } = await seedBlogNames(other.id);
    await app.prisma.content.create({ data: { pageId: page.id, key: "posts", locale: "de", type: "bloglist", value: '{"pageSize":5}' } });
    const en = await englishLocale();
    const res = await app.inject({ method: operation === "delete" ? "DELETE" : "PATCH", url: `${url}/${en.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      ...(operation !== "delete" && { payload: operation === "rename" ? { code: "fr" } : { isDefault: true } }),
    });
    expect(res.statusCode).toBe(200);
    expect(await app.prisma.blogPostTranslation.findMany({ where: { postId: post.id }, orderBy: { locale: "asc" } }))
      .toMatchObject([{ locale: "de" }, { locale: "en" }]);
    expect(await app.prisma.blogCategoryName.findMany({ where: { categoryId: category.id } })).toMatchObject([{ locale: "en" }]);
    expect(await app.prisma.blogTagName.findMany({ where: { tagId: tag.id } })).toMatchObject([{ locale: "en" }]);
    expect(await app.prisma.content.findMany({ where: { pageId: page.id } })).toMatchObject([{ locale: "de", value: '{"pageSize":5}' }]);
  });

  it("renames post translations and category/tag names", async () => {
    const { post, category, tag } = await seedBlogNames();
    const en = await englishLocale();
    const res = await app.inject({ method: "PATCH", url: `${url}/${en.id}`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { code: "fr" } });
    expect(res.statusCode).toBe(200);
    expect(await app.prisma.blogPostTranslation.findMany({ where: { postId: post.id }, orderBy: { locale: "asc" } }))
      .toMatchObject([{ locale: "de" }, { locale: "fr" }]);
    expect(await app.prisma.blogCategoryName.findMany({ where: { categoryId: category.id } })).toMatchObject([{ locale: "fr" }]);
    expect(await app.prisma.blogTagName.findMany({ where: { tagId: tag.id } })).toMatchObject([{ locale: "fr" }]);
  });

  it("refuses rename that collides post urls", async () => {
    const { post, category, tag, page } = await seedBlogNames();
    const en = await englishLocale();
    await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/fr/news/x" } });
    await app.prisma.content.create({ data: { pageId: page.id, key: "title", locale: "en", type: "text", value: "News" } });
    await app.prisma.navigation.create({ data: { siteId: defaultSiteId, locale: "en", label: "News" } });
    const res = await app.inject({ method: "PATCH", url: `${url}/${en.id}`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { code: "fr" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().conflicts).toContainEqual({ url: "/fr/news/x/", owners: ["page /fr/news/x (de)", "post school-bus-routing (fr)"] });
    expect(await englishLocale()).toMatchObject({ id: en.id });
    expect(await app.prisma.blogPostTranslation.findMany({ where: { postId: post.id, locale: "en" } })).toHaveLength(1);
    expect(await app.prisma.blogCategoryName.findMany({ where: { categoryId: category.id } })).toMatchObject([{ locale: "en" }]);
    expect(await app.prisma.blogTagName.findMany({ where: { tagId: tag.id } })).toMatchObject([{ locale: "en" }]);
    expect(await app.prisma.content.findMany({ where: { pageId: page.id } })).toMatchObject([{ locale: "en" }]);
    expect(await app.prisma.navigation.findMany({ where: { siteId: defaultSiteId } })).toMatchObject([{ locale: "en" }]);
  });

  it("refuses deleting a locale with translations", async () => {
    const { post, category, tag } = await seedBlogNames();
    const en = await englishLocale();
    const res = await app.inject({ method: "DELETE", url: `${url}/${en.id}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain(post.key);
    expect(res.body).not.toContain(post.id);
    expect(await englishLocale()).toMatchObject({ id: en.id });
    expect(await app.prisma.blogCategoryName.count({ where: { categoryId: category.id } })).toBe(1);
    expect(await app.prisma.blogTagName.count({ where: { tagId: tag.id } })).toBe(1);
  });

  it("deletes category/tag names with the locale", async () => {
    const { post, category, tag } = await seedBlogNames();
    await app.prisma.blogPostTranslation.deleteMany({ where: { postId: post.id, locale: "en" } });
    await app.prisma.blogCategoryName.create({ data: { categoryId: category.id, locale: "de", name: "Nachrichten" } });
    await app.prisma.blogTagName.create({ data: { tagId: tag.id, locale: "de", name: "Transport" } });
    const en = await englishLocale();
    const res = await app.inject({ method: "DELETE", url: `${url}/${en.id}`, headers: { authorization: `Bearer ${adminToken}` } });
    expect(res.statusCode).toBe(200);
    expect(await app.prisma.locale.findUnique({ where: { id: en.id } })).toBeNull();
    expect(await app.prisma.blogCategoryName.findMany({ where: { categoryId: category.id } })).toMatchObject([{ locale: "de" }]);
    expect(await app.prisma.blogTagName.findMany({ where: { tagId: tag.id } })).toMatchObject([{ locale: "de" }]);
  });

  it.each(["switch", "create", "rename and switch"])("moves bloglist rows on default switch (%s)", async (mode) => {
    const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/news" } });
    await app.prisma.content.createMany({ data: [
      { pageId: page.id, key: "posts", locale: "de", type: "bloglist", value: '{"pageSize":5}' },
      { pageId: page.id, key: "title", locale: "de", type: "text", value: "Nachrichten" },
    ] });
    const en = await englishLocale();
    if (mode === "create") await app.prisma.locale.delete({ where: { id: en.id } });
    else await app.prisma.content.create({ data: { pageId: page.id, key: "posts", locale: "en", type: "bloglist", value: "{}" } });
    const code = mode === "rename and switch" ? "fr" : "en";
    const res = await app.inject({ method: mode === "create" ? "POST" : "PATCH", url: mode === "create" ? url : `${url}/${en.id}`,
      headers: { authorization: `Bearer ${adminToken}` }, payload: { code, label: "English", isDefault: true } });
    expect(res.statusCode).toBe(mode === "create" ? 201 : 200);
    expect(await app.prisma.content.findMany({ where: { pageId: page.id, type: "bloglist" } }))
      .toMatchObject([{ locale: code, value: '{"pageSize":5}' }]);
    expect(await app.prisma.content.findMany({ where: { pageId: page.id, type: "text" } })).toMatchObject([{ locale: "de" }]);
  });

  it("locale create takes the lock and checks routes", async () => {
    await app.prisma.page.createMany({ data: [{ siteId: defaultSiteId, path: "/it/x" }, { siteId: defaultSiteId, path: "/x" }] });
    const lock = vi.spyOn(routeLock, "lockSiteRoutes");
    try {
      const res = await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${adminToken}` }, payload: { code: "it", label: "Italiano" } });
      expect(res.statusCode).toBe(409);
      expect(res.json().conflicts).toContainEqual({ url: "/it/x/", owners: ["page /it/x (de)", "page /x (it)"] });
      expect(lock).toHaveBeenCalledWith(expect.anything(), defaultSiteId);
      expect(await app.prisma.locale.count({ where: { siteId: defaultSiteId, code: "it" } })).toBe(0);
    } finally {
      lock.mockRestore();
    }
  });

  it("rolls back the default switch and bloglist move when routes collide", async () => {
    const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/x" } });
    await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/de/x" } });
    await app.prisma.content.create({ data: { pageId: page.id, key: "posts", locale: "de", type: "bloglist", value: '{"pageSize":5}' } });
    const en = await englishLocale();
    const res = await app.inject({ method: "PATCH", url: `${url}/${en.id}`, headers: { authorization: `Bearer ${adminToken}` }, payload: { isDefault: true } });
    expect(res.statusCode).toBe(409);
    expect(await app.prisma.site.findUniqueOrThrow({ where: { id: defaultSiteId } })).toMatchObject({ defaultLocale: "de" });
    expect(await englishLocale()).toMatchObject({ isDefault: false });
    expect(await app.prisma.content.findMany({ where: { pageId: page.id } })).toMatchObject([{ locale: "de", value: '{"pageSize":5}' }]);
  });
});

it("prefills a new page's bloglist only for the default locale and other keys for every locale", async () => {
  await app.prisma.locale.createMany({ data: [
    { siteId: defaultSiteId, code: "en", label: "English", isDefault: true },
    { siteId: defaultSiteId, code: "de", label: "Deutsch" },
  ] });
  const layout = await app.prisma.layout.create({ data: { siteId: defaultSiteId, name: "News", filePath: "News.tsx", detectedKeys: {
    posts: { type: "bloglist", initial: '{"pageSize":5}' }, title: { type: "text", initial: "News" },
  } } });
  const res = await app.inject({ method: "POST", url: "/api/sites/demo/pages", headers: { authorization: `Bearer ${adminToken}` }, payload: { path: "/news", layoutId: layout.id } });
  expect(res.statusCode).toBe(201);
  expect(await app.prisma.content.findMany({ where: { pageId: res.json().id }, orderBy: [{ key: "asc" }, { locale: "asc" }] }))
    .toMatchObject([{ key: "posts", locale: "en", value: '{"pageSize":5}' }, { key: "title", locale: "de" }, { key: "title", locale: "en" }]);
});
