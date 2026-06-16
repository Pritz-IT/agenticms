import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let editorToken: string;
let targetPageId: string;
let defaultSiteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.navigation.deleteMany();
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);

  const site = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "de",
    },
  });
  defaultSiteId = site.id;

  const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/nav-target", sortOrder: 0 } });
  targetPageId = page.id;
});

// ---------------------------------------------------------------------------
// POST /api/navigation
// ---------------------------------------------------------------------------
describe("POST /api/navigation", () => {
  it("creates a nav item (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { locale: "en", label: "Home", targetPageId, sortOrder: 0 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ locale: "en", label: "Home", sortOrder: 0 });
    expect(body.targetPageId).toBe(targetPageId);
    expect(body.parentId).toBeNull();
    expect(body).toHaveProperty("id");
  });

  it("creates nested nav items using parentId", async () => {
    const parentRes = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { locale: "en", label: "Products", sortOrder: 0 },
    });
    expect(parentRes.statusCode).toBe(201);
    const parent = parentRes.json();

    const childRes = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { locale: "en", label: "Widgets", parentId: parent.id, targetPageId, sortOrder: 1 },
    });

    expect(childRes.statusCode).toBe(201);
    const child = childRes.json();
    expect(child.parentId).toBe(parent.id);
    expect(child.label).toBe("Widgets");
  });

  it("returns 400 when locale or label is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/navigation",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { label: "Home" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/navigation",
      payload: { locale: "en", label: "Home" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/navigation
// ---------------------------------------------------------------------------
describe("GET /api/navigation", () => {
  it("returns tree structure with children ordered by sortOrder", async () => {
    // Create top-level items
    const nav1 = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Home", sortOrder: 1 },
    });
    const nav2 = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Products", sortOrder: 2 },
    });

    // Create children for nav2
    await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Widget A", parentId: nav2.id, sortOrder: 1 },
    });
    await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Widget B", parentId: nav2.id, sortOrder: 2 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/navigation?locale=en",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Only top-level items returned
    expect(body).toHaveLength(2);
    expect(body[0].id).toBe(nav1.id);
    expect(body[0].label).toBe("Home");
    expect(body[0].children).toHaveLength(0);

    expect(body[1].id).toBe(nav2.id);
    expect(body[1].label).toBe("Products");
    expect(body[1].children).toHaveLength(2);
    expect(body[1].children[0].label).toBe("Widget A");
    expect(body[1].children[1].label).toBe("Widget B");
  });

  it("includes target pages for top-level and child items", async () => {
    const parent = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Home", targetPageId, sortOrder: 0 },
    });
    await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Child", parentId: parent.id, targetPageId, sortOrder: 0 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/navigation?locale=en",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].targetPage.path).toBe("/nav-target");
    expect(body[0].children[0].targetPage.path).toBe("/nav-target");
  });

  it("filters by locale", async () => {
    await app.prisma.navigation.createMany({
      data: [
        { siteId: defaultSiteId, locale: "en", label: "English Home", sortOrder: 0 },
        { siteId: defaultSiteId, locale: "de", label: "Deutsch Startseite", sortOrder: 0 },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/navigation?locale=de",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].label).toBe("Deutsch Startseite");
  });

  it("returns all top-level items when no locale filter provided", async () => {
    await app.prisma.navigation.createMany({
      data: [
        { siteId: defaultSiteId, locale: "en", label: "Home EN", sortOrder: 0 },
        { siteId: defaultSiteId, locale: "de", label: "Home DE", sortOrder: 0 },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/navigation",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/navigation" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/navigation/:id
// ---------------------------------------------------------------------------
describe("PUT /api/navigation/:id", () => {
  it("updates a nav item", async () => {
    const item = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Old Label", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/navigation/${item.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { label: "New Label", sortOrder: 10, targetPageId },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.label).toBe("New Label");
    expect(body.sortOrder).toBe(10);
    expect(body.targetPageId).toBe(targetPageId);
  });

  it("clears targetPageId when set to null", async () => {
    const item = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Linked", targetPageId, sortOrder: 0 },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/navigation/${item.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { targetPageId: null },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targetPageId).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/navigation/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { label: "X" },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/navigation/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/navigation/:id", () => {
  it("updates a nav item with partial data", async () => {
    const item = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Old Label", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/navigation/${item.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { label: "Patched Label" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().label).toBe("Patched Label");
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/navigation/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/navigation/:id", () => {
  it("removes a nav item", async () => {
    const item = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "To Remove", sortOrder: 0 },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/navigation/${item.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.navigation.findUnique({ where: { id: item.id } });
    expect(remaining).toBeNull();
  });

  it("removes child nav items with the parent", async () => {
    const parent = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Parent", sortOrder: 0 },
    });
    const child = await app.prisma.navigation.create({
      data: { siteId: defaultSiteId, locale: "en", label: "Child", parentId: parent.id, sortOrder: 0 },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/navigation/${parent.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    await expect(app.prisma.navigation.findUnique({ where: { id: child.id } })).resolves.toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/navigation/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
