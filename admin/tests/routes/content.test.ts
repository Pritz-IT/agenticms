import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import * as routeLocks from "../../src/services/blog/route-lock.js";
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
  await app.prisma.blogPost.deleteMany();
  await app.prisma.blogCategory.deleteMany();
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

function saveList(key: string, value = "", locale = "de") {
  return app.inject({ method: "PUT", url: `/api/sites/demo/content/${pageId}`, headers: { authorization: `Bearer ${editorToken}` }, payload: { key, locale, value, type: "bloglist" } });
}

describe("bloglist content saves", () => {
  it("writes only the default-locale row, upserts it, and permits an unpaginated sidebar", async () => {
    expect((await saveList("main")).json()).toMatchObject({ locale: "en", value: "", type: "bloglist" });
    expect((await saveList("main", '{"pageSize":5}', "fr")).statusCode).toBe(200);
    expect(await app.prisma.content.count({ where: { pageId, key: "main" } })).toBe(1);
    expect((await saveList("sidebar", '{"pageSize":null,"limit":3}')).statusCode).toBe(200);
    expect((await saveList("second")).statusCode).toBe(400);
  });
  it("serializes concurrent paginated saves", async () => {
    const results = await Promise.all([saveList("one"), saveList("two")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 400]);
    expect(await app.prisma.content.count({ where: { pageId } })).toBe(1);
  });
  it("rejects a second paginated list including an existing empty filter", async () => {
    await app.prisma.content.create({ data: { pageId, key: "main", locale: "en", type: "bloglist", value: "" } });
    expect((await saveList("second", '{"pageSize":12}')).statusCode).toBe(400);
  });
  it.each(["{", '{"pageSize":0}', '{"categories":["missing"]}', '{"tags":["missing"]}'])("rejects invalid filters on site and legacy writes: %s", async (value) => {
    expect((await saveList("main", value)).statusCode).toBe(400);
    const legacy = await app.inject({ method: "POST", url: "/api/content", headers: { authorization: `Bearer ${editorToken}` }, payload: { pageId, key: "main", locale: "de", type: "bloglist", value } });
    expect(legacy.statusCode).toBe(400);
    expect(await app.prisma.content.count()).toBe(0);
  });
  it("counts layout defaults even before a content row exists", async () => {
    const layout = await app.prisma.layout.create({ data: { siteId: defaultSiteId, name: "Lists", filePath: "Lists.tsx", detectedKeys: { main: { type: "bloglist", initial: "" }, second: { type: "bloglist", initial: "" } } } });
    await app.prisma.page.update({ where: { id: pageId }, data: { layoutId: layout.id } });
    expect((await saveList("main")).statusCode).toBe(400);
    expect((await saveList("second", '{"pageSize":null,"limit":3}')).statusCode).toBe(200);
    expect((await saveList("main")).statusCode).toBe(200);
  });
  it("rejects foreign-site keys and accepts this site's keys", async () => {
    const foreign = await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "en" } });
    await app.prisma.blogTag.create({ data: { siteId: foreign.id, key: "foreign" } });
    await app.prisma.blogTag.create({ data: { siteId: defaultSiteId, key: "local" } });
    expect((await saveList("main", '{"tags":["foreign"]}')).statusCode).toBe(400);
    expect((await saveList("main", '{"tags":["local"]}')).statusCode).toBe(200);
  });
  it("takes the site lock before checking keys, so a concurrent deletion cannot leave a dangling filter", async () => {
    const tag = await app.prisma.blogTag.create({ data: { siteId: defaultSiteId, key: "removing" } });
    const lock = routeLocks.lockSiteRoutes;
    let locked!: () => void;
    let unlock!: () => void;
    let saving!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const release = new Promise<void>((resolve) => { unlock = resolve; });
    const entered = new Promise<void>((resolve) => { saving = resolve; });
    const deletion = app.prisma.$transaction(async (tx) => {
      await lock(tx, defaultSiteId);
      await tx.blogTag.delete({ where: { id: tag.id } });
      locked();
      await release;
    }, { timeout: 15000 });
    await ready;
    const spy = vi.spyOn(routeLocks, "lockSiteRoutes").mockImplementation(async (tx, siteId) => {
      saving();
      await lock(tx, siteId);
    });
    try {
      const save = saveList("main", '{"tags":["removing"]}').then((result) => result);
      await entered;
      unlock();
      await deletion;
      expect((await save).statusCode).toBe(400);
      expect(await app.prisma.content.count({ where: { pageId } })).toBe(0);
    } finally {
      unlock();
      spy.mockRestore();
    }
  });
  it("legacy create upserts the default row even when a non-default row exists", async () => {
    await app.prisma.content.create({ data: { pageId, key: "main", locale: "de", type: "bloglist", value: "" } });
    for (const value of ["", '{"pageSize":3}']) {
      const result = await app.inject({ method: "POST", url: "/api/content", headers: { authorization: `Bearer ${editorToken}` }, payload: { pageId, key: "main", locale: "de", type: "bloglist", value } });
      expect(result.statusCode).toBe(201);
      expect(result.json()).toMatchObject({ locale: "en", value });
    }
  });
  it.each(["legacy", "site"])("entry update through %s creates the default row and validates pagination", async (route) => {
    const entry = await app.prisma.content.create({ data: { pageId, key: "main", locale: "de", type: "bloglist", value: "" } });
    const url = route === "legacy" ? `/api/content/${entry.id}` : `/api/sites/demo/content/entries/${entry.id}`;
    const update = (value: string) => app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${editorToken}` }, payload: { value } });
    expect((await update('{"pageSize":null,"limit":3}')).json()).toMatchObject({ locale: "en" });
    await saveList("other");
    expect((await update("")).statusCode).toBe(400);
    expect((await update('{"tags":["missing"]}')).statusCode).toBe(400);
  });
});

describe("bloglist preview and views", () => {
  beforeEach(async () => {
    await app.prisma.locale.createMany({ data: ["en", "de", "fr"].map((code) => ({ siteId: defaultSiteId, code, label: code })) });
    const layout = await app.prisma.layout.create({ data: { siteId: defaultSiteId, name: "Overview", filePath: "Overview.tsx", detectedKeys: { main: { type: "bloglist", initial: "" }, sidebar: { type: "bloglist", initial: '{"pageSize":null,"limit":1}' }, title: { type: "text", initial: "News" } } } });
    await app.prisma.page.update({ where: { id: pageId }, data: { isPublished: true, layoutId: layout.id } });
    const postLayout = await app.prisma.layout.create({ data: { siteId: defaultSiteId, name: "Post", filePath: "Post.tsx", kind: "post" } });
    const category = await app.prisma.blogCategory.create({ data: { siteId: defaultSiteId, key: "news", pageId, defaultLayoutId: postLayout.id, names: { create: [{ locale: "en", name: "News" }, { locale: "de", name: "Nachrichten" }] } } });
    const tag = await app.prisma.blogTag.create({ data: { siteId: defaultSiteId, key: "topic", names: { create: [{ locale: "en", name: "Topic" }] } } });
    const unnamedTag = await app.prisma.blogTag.create({ data: { siteId: defaultSiteId, key: "unnamed" } });
    await app.prisma.blogPost.create({ data: { siteId: defaultSiteId, key: "draft", categoryId: category.id, publishedAt: new Date("2026-01-02"), tags: { create: [{ tagId: tag.id }, { tagId: unnamedTag.id }] }, translations: { create: [
      { categoryId: category.id, locale: "de", slug: "entwurf", title: "Entwurf", status: "draft", body: "<p>Body</p>", coverImage: "/media/cover.webp" },
      { categoryId: category.id, locale: "en", slug: "published", title: "Published", status: "published" },
      { categoryId: category.id, locale: "fr", slug: "brouillon", title: "Brouillon", status: "draft" },
    ] } } });
  });
  const preview = (query = "locale=de", id = pageId, site = "demo") => app.inject({ method: "GET", url: `/api/sites/${site}/pages/${id}/blog-lists?${query}`, headers: { authorization: `Bearer ${editorToken}` } });

  it("includes drafts, uses layout initials, and returns every bloglist only", async () => {
    const result = await preview();
    expect(result.statusCode).toBe(200);
    expect(Object.keys(result.json()).sort()).toEqual(["main", "sidebar"]);
    expect(result.json().main).toMatchObject({ posts: [{ key: "draft", locale: "de", title: "Entwurf", url: "/de/test-page/entwurf/" }], pagination: { pages: [{ number: 1, url: "/de/test-page/" }] } });
    expect(result.json().sidebar.pagination).toBeNull();
    expect(result.json().main.posts[0]).not.toHaveProperty("body");
  });
  it("reads the default-locale filter and ignores the non-default copy", async () => {
    await app.prisma.content.createMany({ data: [{ pageId, key: "main", locale: "en", type: "bloglist", value: '{"dateTo":"2026-01-01"}' }, { pageId, key: "main", locale: "de", type: "bloglist", value: "" }] });
    expect((await preview()).json().main.posts).toEqual([]);
  });
  it("validates locale, page, site ownership and authentication", async () => {
    for (const query of ["locale=xx", "locale=de&page=0", "locale=de&page=1.5", "locale=de&page=abc", "locale=de&page=-1"]) expect((await preview(query)).statusCode).toBe(400);
    expect((await preview("locale=de&page=2")).statusCode).toBe(404);
    expect((await preview("locale=de", "missing")).statusCode).toBe(404);
    await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "en" } });
    expect((await preview("locale=en", pageId, "foreign")).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/sites/demo/pages/${pageId}/blog-lists?locale=de` })).statusCode).toBe(401);
  });
  it("builds target-aware views with names, dates, URLs and visible translation links", async () => {
    const { loadBlogPostViews } = await import("../../src/services/blog/views.js");
    const staging = await loadBlogPostViews(app.prisma, defaultSiteId, "staging");
    expect(staging).toHaveLength(3);
    expect(staging.find((p) => p.locale === "de")).toMatchObject({ publishedAt: "2026-01-02", body: "<p>Body</p>", coverImage: "/media/cover.webp", category: { key: "news", name: "Nachrichten" }, tags: [{ key: "topic", name: "Topic" }, { key: "unnamed", name: "unnamed" }] });
    expect(staging.find((p) => p.locale === "fr")?.category.name).toBe("News");
    expect(staging[0].translations).toHaveLength(3);
    const production = await loadBlogPostViews(app.prisma, defaultSiteId, "production");
    expect(production).toHaveLength(1);
    expect(production[0]).toMatchObject({ locale: "en", url: "/test-page/published/", translations: [{ locale: "en", url: "/test-page/published/" }] });
    expect(JSON.stringify(staging)).not.toMatch(/"(?:id|postId|siteId|categoryId|tagId)":/);
    await app.prisma.blogCategoryName.deleteMany();
    expect((await loadBlogPostViews(app.prisma, defaultSiteId, "staging"))[0].category.name).toBe("news");
    await app.prisma.page.update({ where: { id: pageId }, data: { isPublished: false } });
    for (const target of ["staging", "production"] as const) expect(await loadBlogPostViews(app.prisma, defaultSiteId, target)).toEqual([]);
  });
});
