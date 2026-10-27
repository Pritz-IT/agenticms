import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let site: Site;
let auth: string;
const records: { op?: string; level: number; msg: string }[] = [];
const translation = (slug = "routing") => ({ slug, title: "Routing", excerpt: "", body: "<p>Text</p>", coverImage: "", metaTitle: "", metaDescription: "" });
const input = (key = "routing") => ({ key, category: "news", tags: ["transport"], layout: null, translations: { de: translation(), en: translation() } });

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (line: string) => records.push(JSON.parse(line)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await app.prisma.blogPost.deleteMany();
  await app.prisma.blogCategory.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.user.deleteMany();
  site = await app.prisma.site.create({ data: {
    key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de",
    locales: { create: [{ code: "de", label: "Deutsch" }, { code: "en", label: "English" }] },
  } });
  const layout = await app.prisma.layout.create({ data: { siteId: site.id, name: "Post", filePath: "Post.tsx", kind: "post" } });
  for (const key of ["news", "insights"]) {
    const page = await app.prisma.page.create({ data: { siteId: site.id, path: `/${key}` } });
    await app.prisma.blogCategory.create({ data: { siteId: site.id, key, pageId: page.id, defaultLayoutId: layout.id } });
  }
  await app.prisma.blogTag.create({ data: { siteId: site.id, key: "transport" } });
  const { user } = await createTestUser(app, { role: "editor" });
  auth = `Bearer ${getAccessToken(user)}`;
  records.length = 0;
});
function request(method: "GET" | "POST" | "PUT" | "DELETE", resource = "", payload?: object) {
  return app.inject({ method, url: `/api/sites/demo/blog/posts${resource}`, headers: { authorization: auth }, ...(payload && { payload }) });
}

describe("blog posts", () => {
  it.each(["included", "omitted"])("restores a cleared date when a published translation is %s", async (variant) => {
    await request("POST", "", input());
    await request("POST", "/routing/translations/de/publish");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-12-31T23:30:00.000Z"));
    try {
      auth = `Bearer ${getAccessToken(await app.prisma.user.findFirstOrThrow())}`;
      const response = await request("PUT", "/routing", { ...input(), publishedAt: null,
        translations: variant === "included" ? input().translations : { en: translation() },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().publishedAt).toBe("2026-12-31");
      expect(response.json().translations.de.status).toBe("published");
      expect(records.some((r) => r.level === 30 && r.msg.includes("publishedAt defaulted"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it("allows an undated post when the final published translation becomes draft", async () => {
    await request("POST", "", input());
    await request("POST", "/routing/translations/de/publish");
    const response = await request("PUT", "/routing", { ...input(), publishedAt: null,
      translations: { de: { ...translation(), status: "draft" } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().publishedAt).toBeNull();
  });

  it("creates de+en as drafts and returns keys/names without database ids", async () => {
    const response = await request("POST", "", { ...input(), layout: "Post" });
    expect(response.statusCode).toBe(201);
    const post = response.json();
    expect(post).toMatchObject({ ...input(), layout: "Post", publishedAt: null, translations: { de: { status: "draft" }, en: { status: "draft" } } });
    expect(post.updatedAt).toEqual(expect.any(String));
    expect(JSON.stringify(post)).not.toMatch(/"(?:id|siteId|categoryId|layoutId|tagId|postId)":/);
    expect((await request("GET", "/routing")).json()).toEqual(post);
  });
  it("returns public URLs on create, read, list, save, publish and unpublish", async () => {
    const assertUrls = (post: { translations: Record<string, { url: string }> }, base: string, deSlug = "routing") => {
      expect(post.translations.de.url).toBe(`${base}/${deSlug}/`);
      expect(post.translations.en.url).toBe(`/en${base}/routing/`);
    };
    const created = await request("POST", "", input());
    expect(created.statusCode).toBe(201);
    assertUrls(created.json(), "/news");
    assertUrls((await request("GET", "/routing")).json(), "/news");
    assertUrls((await request("GET")).json()[0], "/news");
    const saved = await request("PUT", "/routing", { ...input(), category: "insights", translations: { de: translation("changed") } });
    expect(saved.statusCode).toBe(200);
    assertUrls(saved.json(), "/insights", "changed");
    for (const action of ["publish", "unpublish"]) {
      const response = await request("POST", `/routing/translations/de/${action}`);
      expect(response.statusCode).toBe(200);
      assertUrls(response.json(), "/insights", "changed");
    }
  });
  it("sets publishedAt only on first publication, preserves status on save, and unpublishes per locale", async () => {
    await request("POST", "", input());
    const de = await request("POST", "/routing/translations/de/publish");
    expect(de.statusCode).toBe(200);
    expect(de.json().publishedAt).toEqual(expect.any(String));
    expect(de.json().translations.en.status).toBe("draft");
    const en = await request("POST", "/routing/translations/en/publish");
    expect(en.json().publishedAt).toBe(de.json().publishedAt);
    expect((await request("PUT", "/routing", input())).json().translations.de.status).toBe("published");
    const unpublished = await request("POST", "/routing/translations/de/unpublish");
    expect(unpublished.json().translations.de.status).toBe("draft");
    expect(unpublished.json().translations.en.status).toBe("published");
    expect(unpublished.json().publishedAt).toBe(de.json().publishedAt);
  });
  it("rejects duplicate slugs within a category+locale but allows a different locale", async () => {
    expect((await request("POST", "", { ...input(), translations: { de: translation() } })).statusCode).toBe(201);
    expect((await request("POST", "", { ...input("duplicate"), translations: { de: translation() } })).statusCode).toBe(409);
    expect((await request("POST", "", { ...input("english"), translations: { en: translation() } })).statusCode).toBe(201);
    expect(await app.prisma.blogPost.count()).toBe(2);
  });
  it("rewrites categoryId on every translation including omitted locales", async () => {
    await request("POST", "", input());
    const response = await request("PUT", "/routing", { ...input(), category: "insights", translations: { de: translation("new") } });
    expect(response.statusCode).toBe(200);
    expect(response.json().translations.en.slug).toBe("routing");
    const post = await app.prisma.blogPost.findUniqueOrThrow({ where: { siteId_key: { siteId: site.id, key: "routing" } }, include: { translations: true } });
    expect(post.translations).toHaveLength(2);
    expect(post.translations.every((entry) => entry.categoryId === post.categoryId)).toBe(true);
  });
  it("rejects missing image alt naming its src and sanitizes editor HTML without loss rejection", async () => {
    const bad = await request("POST", "", { ...input(), translations: { de: { ...translation(), body: '<img src="/media/x/a.png">' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain("/media/x/a.png");
    const good = await request("POST", "", { ...input(), translations: { de: { ...translation(), body: '<p onclick="evil()">OK</p><script>evil()</script><img src="https://foreign.test/a.png" alt="External"><img src="/assets/a.png" alt="Local">' } } });
    expect(good.statusCode).toBe(201);
    expect(good.json().translations.de.body).toBe('<p>OK</p><img src="/assets/a.png" alt="Local" />');
  });
  it("rejects foreign category/tag keys and ids, foreign layouts, and page layouts", async () => {
    const foreign = await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "de" } });
    const tag = await app.prisma.blogTag.create({ data: { siteId: foreign.id, key: "foreign-tag" } });
    const layout = await app.prisma.layout.create({ data: { siteId: foreign.id, name: "Foreign", filePath: "Post.tsx", kind: "post" } });
    const page = await app.prisma.page.create({ data: { siteId: foreign.id, path: "/foreign" } });
    const category = await app.prisma.blogCategory.create({ data: { siteId: foreign.id, key: "foreign-category", pageId: page.id, defaultLayoutId: layout.id } });
    await app.prisma.layout.create({ data: { siteId: site.id, name: "Page", filePath: "Page.tsx" } });
    for (const override of [{ tags: [tag.key] }, { tags: [tag.id] }, { category: category.key }, { category: category.id }, { layout: layout.name }, { layout: layout.id }, { layout: "Page" }]) {
      expect((await request("POST", "", { ...input(), ...override })).statusCode).toBe(400);
    }
    expect(await app.prisma.blogPost.count()).toBe(0);
  });
  it("filters lists by any translation status, category and tag", async () => {
    await request("POST", "", input());
    await request("POST", "", { ...input("other"), category: "insights", tags: [] });
    await request("POST", "/routing/translations/de/publish");
    expect((await request("GET", "?status=published")).json().map((p: { key: string }) => p.key)).toEqual(["routing"]);
    expect((await request("GET", "?status=draft")).json()).toHaveLength(2);
    expect((await request("GET", "?category=insights")).json().map((p: { key: string }) => p.key)).toEqual(["other"]);
    expect((await request("GET", "?tag=transport&status=published")).json()).toHaveLength(1);
    expect((await request("GET", "?status=invalid")).statusCode).toBe(400);
  });
  it("allows exactly one concurrent savePost for a slug", async () => {
    const { savePost } = await import("../../src/services/blog/posts.js");
    const results = await Promise.allSettled([savePost(app.prisma, site, input("first"), app.log), savePost(app.prisma, site, input("second"), app.log)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await app.prisma.blogPost.count()).toBe(1);
  });
  it("rolls back post saves on page route collisions, including drafts", async () => {
    await app.prisma.page.create({ data: { siteId: site.id, path: "/news/routing" } });
    const response = await request("POST", "", input());
    expect(response.statusCode).toBe(409);
    expect(response.json().conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ url: "/news/routing/" })]));
    expect(await app.prisma.blogPost.count()).toBe(0);
  });
  it("rolls back shared fields, tags and translations when an existing post move collides", async () => {
    const original = (await request("POST", "", input())).json();
    await app.prisma.page.create({ data: { siteId: site.id, path: "/insights/routing" } });
    const response = await request("PUT", "/routing", { ...input(), category: "insights", tags: [], translations: { de: translation("changed") } });
    expect(response.statusCode).toBe(409);
    expect((await request("GET", "/routing")).json()).toEqual(original);
  });
  it("supports caller-owned batch transactions and rolls the entire batch back on collision", async () => {
    const { savePostInTx } = await import("../../src/services/blog/posts.js");
    const { lockSiteRoutes } = await import("../../src/services/blog/route-lock.js");
    await expect(app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, site.id);
      await savePostInTx(tx, site, input("first"), app.log);
      await savePostInTx(tx, site, input("second"), app.log);
    }, { timeout: 15000 })).rejects.toMatchObject({ statusCode: 409 });
    expect(await app.prisma.blogPost.count()).toBe(0);
    await app.prisma.$transaction(async (tx) => {
      await lockSiteRoutes(tx, site.id);
      await savePostInTx(tx, site, input("first"), app.log);
      await savePostInTx(tx, site, { ...input("second"), category: "insights" }, app.log);
    }, { timeout: 15000 });
    expect(await app.prisma.blogPost.count()).toBe(2);
  });
  it("accepts explicit publication on save, editable dates and nullable covers", async () => {
    const response = await request("POST", "", { ...input(), translations: { de: { ...translation(), status: "published", coverImage: null } } });
    expect(response.statusCode).toBe(201);
    expect(response.json().publishedAt).toEqual(expect.any(String));
    expect(response.json().translations.de.coverImage).toBe("");
    const dated = await request("PUT", "/routing", { ...input(), publishedAt: "2024-02-29", translations: { de: translation() } });
    expect(dated.statusCode).toBe(200);
    expect(dated.json().publishedAt).toBe("2024-02-29");
    expect(dated.json().translations.de.status).toBe("published");
    expect((await request("POST", "/routing/translations/de/unpublish")).json().publishedAt).toBe("2024-02-29");
  });
  it("scopes reads, writes, publication and deletion to the requested site", async () => {
    await request("POST", "", input());
    await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "de" } });
    for (const [method, suffix] of [["GET", "/routing"], ["PUT", "/routing"], ["DELETE", "/routing"], ["POST", "/routing/translations/de/publish"]] as const) {
      const response = await app.inject({ method, url: `/api/sites/foreign/blog/posts${suffix}`, headers: { authorization: auth }, ...(method === "PUT" && { payload: input() }) });
      expect(response.statusCode).toBe(404);
    }
    const list = await app.inject({ method: "GET", url: "/api/sites/foreign/blog/posts", headers: { authorization: auth } });
    expect(list.json()).toEqual([]);
    expect((await request("GET", "/routing")).json().translations.de.status).toBe("draft");
  });
  it("enforces immutable keys, create/update semantics, missing resources and authentication", async () => {
    expect((await request("PUT", "/routing", input())).statusCode).toBe(404);
    expect((await request("POST", "", input())).statusCode).toBe(201);
    expect((await request("POST", "", input())).statusCode).toBe(409);
    expect((await request("PUT", "/routing", input("changed"))).statusCode).toBe(400);
    expect((await request("GET", "/missing")).statusCode).toBe(404);
    expect((await request("POST", "/routing/translations/fr/publish")).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/sites/demo/blog/posts" })).statusCode).toBe(401);
    expect((await request("DELETE", "/routing")).statusCode).toBe(200);
    expect(await app.prisma.blogPostTranslation.count()).toBe(0);
    expect(await app.prisma.blogPostTag.count()).toBe(0);
    expect((await request("DELETE", "/routing")).statusCode).toBe(404);
  });
  it("validates shapes, locales, keys, slugs, status, dates and cover sources before writing", async () => {
    for (const override of [{ key: "Bad_Key" }, { tags: "transport" }, { translations: [] }, { translations: { fr: translation() } }, { publishedAt: "invalid" }, { publishedAt: "2026-02-30" }, { layout: 5 }, { unknown: true }]) {
      expect((await request("POST", "", { ...input(), ...override })).statusCode).toBe(400);
    }
    for (const override of [{ slug: "bad--slug" }, { status: "scheduled" }, { title: 2 }, { body: null }, { coverImage: "https://foreign.test/x.png" }]) {
      expect((await request("POST", "", { ...input(), translations: { de: { ...translation(), ...override } } })).statusCode).toBe(400);
    }
    expect(await app.prisma.blogPost.count()).toBe(0);
  });
  it("logs mutation entry/outcome and leaves timestamps unchanged on no-op saves and publication", async () => {
    const created = (await request("POST", "", input())).json();
    const saved = await request("PUT", "/routing", input());
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual(created);
    const published = (await request("POST", "/routing/translations/de/publish")).json();
    expect((await request("POST", "/routing/translations/de/publish")).json()).toEqual(published);
    expect(records.some((r) => r.level === 30 && r.op?.includes("post") && r.msg.includes("requested"))).toBe(true);
    expect(records.some((r) => r.level === 30 && r.msg.includes("NO-OP"))).toBe(true);
  });
});
