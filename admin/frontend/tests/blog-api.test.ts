import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import {
  fetchBlogCategories,
  createBlogCategory,
  updateBlogCategory,
  deleteBlogCategory,
  fetchBlogTags,
  createBlogTag,
  updateBlogTag,
  deleteBlogTag,
  fetchBlogPosts,
  fetchBlogPost,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  publishBlogTranslation,
  unpublishBlogTranslation,
} from "../src/api/blog";
import { fetchLayouts } from "../src/api/layouts";
import { ApiError, getAccessToken, setAccessToken } from "../src/api/client";

describe("blog api", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("uses encoded site-scoped URLs, methods and complete bodies", async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string | undefined });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const category = {
      key: "news",
      pagePath: "/news",
      defaultLayout: "Article",
      names: { de: "Neuigkeiten", en: "News" },
      sortOrder: 1,
    };
    const tag = { key: "bus", names: { de: "Bus" }, sortOrder: 2 };
    const post = {
      key: "first",
      category: "news",
      tags: ["bus"],
      layout: null,
      publishedAt: null,
      translations: {},
    };
    await fetchBlogCategories("a/b");
    await createBlogCategory("a/b", category);
    await updateBlogCategory("a/b", "a b", category);
    await deleteBlogCategory("a/b", "a b");
    await fetchBlogTags("a/b");
    await createBlogTag("a/b", tag);
    await updateBlogTag("a/b", "a b", tag);
    await deleteBlogTag("a/b", "a b");
    await fetchBlogPosts("a/b");
    await fetchBlogPosts("a/b", { category: "a & b", tag: "bus", status: "draft" });
    await fetchBlogPosts("a/b", { category: "", tag: "" });
    await fetchBlogPost("a/b", "a b");
    await createBlogPost("a/b", post);
    await updateBlogPost("a/b", "a b", post);
    await deleteBlogPost("a/b", "a b");
    await publishBlogTranslation("a/b", "a b", "de/CH");
    await unpublishBlogTranslation("a/b", "a b", "de/CH");
    const root = "/api/sites/a%2Fb/blog";
    const call = (path: string, method?: string, body?: unknown) => ({
      url: root + path,
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.deepEqual(calls, [
      call("/categories"),
      call("/categories", "POST", category),
      call("/categories/a%20b", "PATCH", category),
      call("/categories/a%20b", "DELETE"),
      call("/tags"),
      call("/tags", "POST", tag),
      call("/tags/a%20b", "PATCH", tag),
      call("/tags/a%20b", "DELETE"),
      call("/posts"),
      call("/posts?category=a+%26+b&tag=bus&status=draft"),
      call("/posts"),
      call("/posts/a%20b"),
      call("/posts", "POST", post),
      call("/posts/a%20b", "PUT", post),
      call("/posts/a%20b", "DELETE"),
      call("/posts/a%20b/translations/de%2FCH/publish", "POST"),
      call("/posts/a%20b/translations/de%2FCH/unpublish", "POST"),
    ]);
  });

  it("keeps layout kinds separate while allowing the layout library to fetch all", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (url: string) => {
      paths.push(url);
      return new Response("[]", { status: 200 });
    }) as typeof fetch;
    await fetchLayouts("demo", "page");
    await fetchLayouts("demo", "post");
    await fetchLayouts("demo");
    assert.deepEqual(paths, [
      "/api/sites/demo/layouts?kind=page",
      "/api/sites/demo/layouts?kind=post",
      "/api/sites/demo/layouts",
    ]);
  });

  it.each([400, 409])("preserves %s error details and uses Bearer authentication", async (status) => {
    const oldToken = getAccessToken();
    setAccessToken("test-blog-token");
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-blog-token");
      return new Response(JSON.stringify({ error: "Blog tag is used by post bus-routes" }), { status });
    }) as typeof fetch;
    try {
      await assert.rejects(
        deleteBlogTag("demo", "bus"),
        (error: unknown) =>
          error instanceof ApiError && error.status === status && error.message.includes("bus-routes")
      );
    } finally {
      setAccessToken(oldToken ?? "");
    }
  });
});
