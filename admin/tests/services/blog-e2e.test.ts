import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { parseLayoutKeys, parseLayoutKind } from "../../src/services/layout-parser.js";
import { buildSiteConfig } from "../../src/services/website-build/site-config.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { issueCliToken } from "../helpers/cli.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("blog push → staging → publish → production", () => {
  it("includes a CLI draft in staging only, then includes the published post in both targets and lists", async () => {
    const site = await app.prisma.site.create({ data: {
      key: "blog-e2e", name: "Blog E2E", domain: "blog-e2e.test", stagingDomain: "staging.blog-e2e.test", defaultLocale: "en",
      locales: { create: [{ code: "en", label: "English", isDefault: true }, { code: "de", label: "Deutsch" }] },
    } });
    const layouts = [];
    for (const name of ["ExamplePost", "ExampleBlogOverview"]) {
      const source = await readFile(resolve("../examples/layouts", `${name}.tsx`), "utf-8");
      layouts.push(await app.prisma.layout.create({ data: {
        siteId: site.id, name, filePath: `${name}.tsx`, kind: parseLayoutKind(source), detectedKeys: parseLayoutKeys(source),
      } }));
    }
    const page = await app.prisma.page.create({ data: {
      siteId: site.id, path: "/news", isPublished: true, layoutId: layouts[1].id,
    } });
    await app.prisma.blogCategory.create({ data: {
      siteId: site.id, key: "news", pageId: page.id, defaultLayoutId: layouts[0].id,
      names: { create: { locale: "en", name: "News" } },
    } });
    const token = await issueCliToken(app);
    const pushed = await app.inject({
      method: "POST", url: `/api/sites/${site.key}/cli/posts/push`,
      headers: { authorization: `Bearer ${token}` },
      payload: { draft: true, media: [], files: [{
        source: "hello.en.md", key: "hello", locale: "en", category: "news", tags: [], layout: null,
        title: "Hello from the blog", slug: "hello", excerpt: "Our first post.", cover: null,
        metaTitle: null, metaDescription: null, html: "<p>Ready to share.</p>",
      }] },
    });
    expect(pushed.statusCode, pushed.body).toBe(200);
    expect(pushed.json()).toEqual({ posts: [{ key: "hello", locale: "en", action: "created" }] });
    expect(await app.prisma.blogPostTranslation.findFirstOrThrow({ where: { post: { siteId: site.id, key: "hello" } } }))
      .toMatchObject({ status: "draft" });

    async function expectVisibility(target: "staging" | "production", visible: boolean) {
      const built = await buildSiteConfig(app.prisma, site.key, target);
      expect(built.posts.map(({ key }) => key)).toEqual(visible ? ["hello"] : []);
      if (visible) expect(built.posts[0]).toMatchObject({
        key: "hello", locale: "en", url: "/news/hello/", title: "Hello from the blog",
        body: "<p>Ready to share.</p>", layoutFilePath: "ExamplePost.tsx",
      });
      expect(built.blogLists[page.id].en["blog.list"]).toEqual({ postKeys: visible ? ["hello"] : [], pageSize: 12 });
      expect(built.blogLists[page.id].de["blog.list"].postKeys).toEqual([]);
    }

    await expectVisibility("staging", true);
    await expectVisibility("production", false);

    const { user } = await createTestUser(app, { role: "editor" });
    const published = await app.inject({
      method: "POST", url: `/api/sites/${site.key}/blog/posts/hello/translations/en/publish`,
      headers: { authorization: `Bearer ${getAccessToken(user)}` },
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json()).toMatchObject({ publishedAt: expect.any(String), translations: { en: { status: "published" } } });

    await expectVisibility("staging", true);
    await expectVisibility("production", true);
  });
});
