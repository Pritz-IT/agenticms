import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let editorToken: string;
let pageId: string;
let defaultSiteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
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

  const page = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/test-page", sortOrder: 0 } });
  pageId = page.id;
});

// ---------------------------------------------------------------------------
// GET /api/content
// ---------------------------------------------------------------------------
describe("GET /api/content", () => {
  it("returns content filtered by pageId and locale", async () => {
    const otherPage = await app.prisma.page.create({ data: { siteId: defaultSiteId, path: "/other", sortOrder: 1 } });

    await app.prisma.content.createMany({
      data: [
        { pageId, key: "title", locale: "en", value: "English Title", type: "text" },
        { pageId, key: "title", locale: "de", value: "Deutscher Titel", type: "text" },
        { pageId: otherPage.id, key: "title", locale: "en", value: "Other Page", type: "text" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/content?pageId=${pageId}&locale=en`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].value).toBe("English Title");
    expect(body[0].locale).toBe("en");
    expect(body[0].pageId).toBe(pageId);
  });

  it("returns all content when no filters provided", async () => {
    await app.prisma.content.createMany({
      data: [
        { pageId, key: "a", locale: "en", value: "A", type: "text" },
        { pageId, key: "b", locale: "de", value: "B", type: "text" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/content",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(2);
  });

  it("returns content ordered by key asc", async () => {
    await app.prisma.content.createMany({
      data: [
        { pageId, key: "z-key", locale: "en", value: "Z", type: "text" },
        { pageId, key: "a-key", locale: "en", value: "A", type: "text" },
        { pageId, key: "m-key", locale: "en", value: "M", type: "text" },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/content?pageId=${pageId}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].key).toBe("a-key");
    expect(body[1].key).toBe("m-key");
    expect(body[2].key).toBe("z-key");
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/content" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/content
// ---------------------------------------------------------------------------
describe("POST /api/content", () => {
  it("creates a new content entry (201)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/content",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { pageId, key: "hero.title", locale: "en", value: "Hello", type: "text" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      pageId,
      key: "hero.title",
      locale: "en",
      value: "Hello",
      type: "text",
    });
    expect(body).toHaveProperty("id");
  });

  it("rejects duplicate (pageId, key, locale) with 409", async () => {
    await app.prisma.content.create({
      data: { pageId, key: "hero.title", locale: "en", value: "Existing", type: "text" },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/content",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { pageId, key: "hero.title", locale: "en", value: "Duplicate", type: "text" },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toHaveProperty("error");
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/content",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { pageId, key: "title" },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/content",
      payload: { pageId, key: "title", locale: "en", value: "Hi", type: "text" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/content/:id
// ---------------------------------------------------------------------------
describe("PUT /api/content/:id", () => {
  it("updates content value", async () => {
    const content = await app.prisma.content.create({
      data: { pageId, key: "title", locale: "en", value: "Original", type: "text" },
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/content/${content.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { value: "Updated" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.value).toBe("Updated");
    expect(body.key).toBe("title");
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/content/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { value: "New value" },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/content/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/content/:id", () => {
  it("removes a content entry", async () => {
    const content = await app.prisma.content.create({
      data: { pageId, key: "body", locale: "en", value: "Delete me", type: "text" },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/content/${content.id}`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const remaining = await app.prisma.content.findUnique({ where: { id: content.id } });
    expect(remaining).toBeNull();
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/content/nonexistent-id",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
