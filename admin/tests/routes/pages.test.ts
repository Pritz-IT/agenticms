import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { canonicalizePagePath } from "../../src/routes/pages.js";

describe("canonicalizePagePath", () => {
  it("normalizes leading/trailing/duplicate slashes and maps blank input to root", () => {
    expect(canonicalizePagePath("/")).toBe("/");
    expect(canonicalizePagePath("")).toBe("/");
    expect(canonicalizePagePath("   ")).toBe("/");
    expect(canonicalizePagePath("///")).toBe("/");
    expect(canonicalizePagePath("about")).toBe("/about");
    expect(canonicalizePagePath("/about")).toBe("/about");
    expect(canonicalizePagePath("/about/")).toBe("/about");
    expect(canonicalizePagePath("//about//")).toBe("/about");
    expect(canonicalizePagePath("/a//b/")).toBe("/a/b");
    expect(canonicalizePagePath("  /a/b/  ")).toBe("/a/b");
  });
});

let app: FastifyInstance;
let editorToken: string;
let defaultSiteId: string;

const sampleKeys = {
  "hero.title": { type: "text", initial: "Hello World" },
  "hero.subtitle": { type: "text", initial: "Welcome" },
};

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Clean up in dependency order
  await app.prisma.content.deleteMany();
  await app.prisma.navigation.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
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

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);
});

// ---------------------------------------------------------------------------
// POST /api/pages
// ---------------------------------------------------------------------------
describe("POST /api/pages", () => {
  it("creates a page (201) and pre-fills content from layout keys for all locales", async () => {
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "home", filePath: "/layouts/home.tsx", detectedKeys: sampleKeys },
    });

    await app.prisma.locale.createMany({
      data: [
        { siteId: defaultSiteId, code: "en", label: "English", sortOrder: 1 },
        { siteId: defaultSiteId, code: "de", label: "German", sortOrder: 2 },
      ],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/home", layoutId: layout.id, sortOrder: 0, isPublished: false },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ path: "/home", sortOrder: 0, isPublished: false });
    expect(body).toHaveProperty("id");

    // Verify content pre-fill: 2 keys × 2 locales = 4 entries
    const contents = await app.prisma.content.findMany({
      where: { pageId: body.id },
      orderBy: [{ key: "asc" }, { locale: "asc" }],
    });

    expect(contents).toHaveLength(4);

    const enTitle = contents.find((c) => c.key === "hero.title" && c.locale === "en");
    expect(enTitle).toBeDefined();
    expect(enTitle!.value).toBe("Hello World");
    expect(enTitle!.type).toBe("text");

    const deSubtitle = contents.find((c) => c.key === "hero.subtitle" && c.locale === "de");
    expect(deSubtitle).toBeDefined();
    expect(deSubtitle!.value).toBe("Welcome");
  });

  it("skips detected layout keys that are not persisted content types", async () => {
    const layout = await app.prisma.layout.create({
      data: {
        siteId: defaultSiteId,
        name: "withNavigation",
        filePath: "/layouts/with-navigation.tsx",
        detectedKeys: {
          "header.navigation": { type: "navigation", initial: "" },
          "hero.title": { type: "text", initial: "Hello World" },
        },
      },
    });

    await app.prisma.locale.create({ data: { siteId: defaultSiteId, code: "en", label: "English", sortOrder: 1 } });

    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/solutions", layoutId: layout.id },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const contents = await app.prisma.content.findMany({
      where: { pageId: body.id },
      orderBy: { key: "asc" },
    });

    expect(contents).toHaveLength(1);
    expect(contents[0]).toMatchObject({
      key: "hero.title",
      value: "Hello World",
      type: "text",
    });
  });

  it("creates a page without layoutId — no content entries", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/about" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const contents = await app.prisma.content.findMany({ where: { pageId: body.id } });
    expect(contents).toHaveLength(0);
  });

  it("returns 400 when path is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 409 when creating a page with a duplicate path", async () => {
    await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/duplicate" } });

    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/duplicate" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "A page with this path already exists" });
  });

  it("canonicalizes the path and rejects an equivalent duplicate", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "about/" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: "/about" });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/about" },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pages",
      payload: { path: "/test" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pages
// ---------------------------------------------------------------------------
describe("GET /api/pages", () => {
  it("returns all pages with layout info ordered by sortOrder asc", async () => {
    const layout = await app.prisma.layout.create({
      data: { siteId: defaultSiteId, name: "base", filePath: "/layouts/base.tsx", detectedKeys: {} },
    });

    await app.prisma.page.createMany({
      data: [
        { siteId: defaultSiteId, path: "/contact", sortOrder: 3 },
        { siteId: defaultSiteId, path: "/home", layoutId: layout.id, sortOrder: 1 },
        { siteId: defaultSiteId, path: "/about", sortOrder: 2 },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/pages",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(3);
    expect(body[0].path).toBe("/home");
    expect(body[1].path).toBe("/about");
    expect(body[2].path).toBe("/contact");

    // Layout relation should be included
    expect(body[0].layout).toBeDefined();
    expect(body[0].layout.name).toBe("base");
    expect(body[1].layout).toBeNull();
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/pages" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/pages/:id
// ---------------------------------------------------------------------------
describe("GET /api/pages/:id", () => {
  it("returns a single page with layout and content", async () => {
    const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/single", sortOrder: 0 } });
    await app.prisma.content.create({
      data: { pageId: page.id, key: "title", locale: "en", value: "Hello", type: "text" },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/pages/${page.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(page.id);
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].key).toBe("title");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/pages/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "Page not found" });
  });
});

// ---------------------------------------------------------------------------
// PUT /api/pages/:id
// ---------------------------------------------------------------------------
describe("PUT /api/pages/:id", () => {
  it("updates a page", async () => {
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/old-path", sortOrder: 0, isPublished: false },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/pages/${page.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/new-path", isPublished: true, sortOrder: 5 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe("/new-path");
    expect(body.isPublished).toBe(true);
    expect(body.sortOrder).toBe(5);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/pages/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { path: "/x" },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/pages/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/pages/:id", () => {
  it("updates publication status for the admin frontend page editor", async () => {
    const page = await app.prisma.page.create({
      data: { siteId: defaultSiteId, path: "/draft-page", sortOrder: 0, isPublished: false },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/pages/${page.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { isPublished: true },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().isPublished).toBe(true);

    const updated = await app.prisma.page.findUnique({ where: { id: page.id } });
    expect(updated?.isPublished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/pages/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/pages/:id", () => {
  it("removes page and cascades content deletion", async () => {
    const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/to-delete", sortOrder: 0 } });
    await app.prisma.content.create({
      data: { pageId: page.id, key: "title", locale: "en", value: "Bye", type: "text" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/pages/${page.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.page.findUnique({ where: { id: page.id } });
    expect(remaining).toBeNull();

    const content = await app.prisma.content.findMany({ where: { pageId: page.id } });
    expect(content).toHaveLength(0);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/pages/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
