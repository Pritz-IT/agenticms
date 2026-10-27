import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import type { BlogList, BlogPostSummary } from "../src/components/visual-editor/agenticms-shims";
import { resolveBlogPreviewCovers } from "../src/lib/blog-preview-covers";

function post(coverImage: string): BlogPostSummary {
  return { key: coverImage, coverImage, locale: "en", url: "/news/post", title: "Post", excerpt: "", publishedAt: null,
    category: { key: "news", name: "News" }, tags: [] };
}

describe("blog preview covers", () => {
  it("fetches unique media in parallel and returns lists and every created URL despite a failure", async () => {
    const failure = new Error("404 missing cover");
    const pending = new Map<string, { resolve: (url: string) => void; reject: (error: Error) => void }>();
    const fetchCover = vi.fn((src: string) => new Promise<string>((resolve, reject) => pending.set(src, { resolve, reject })));
    const lists: Record<string, BlogList> = {
      main: { posts: [post("/media/a"), post("/media/b"), post("/media/c")], pagination: null },
      sidebar: { posts: [post("/media/a"), post("/media/b"), post(""), post("https://example.com/cover.png")], pagination: null },
    };
    const original = structuredClone(lists);
    const resultPromise = resolveBlogPreviewCovers(lists, fetchCover);
    assert.deepEqual(fetchCover.mock.calls, [["/media/a"], ["/media/b"], ["/media/c"]]);
    pending.get("/media/c")!.resolve("blob:c");
    pending.get("/media/b")!.reject(failure);
    pending.get("/media/a")!.resolve("blob:a");
    const result = await resultPromise;
    assert.deepEqual(result.lists.main.posts.map((p) => p.coverImage), ["blob:a", "", "blob:c"]);
    assert.deepEqual(result.lists.sidebar.posts.map((p) => p.coverImage), ["blob:a", "", "", "https://example.com/cover.png"]);
    assert.deepEqual(result.objectUrls, ["blob:a", "blob:c"]);
    assert.deepEqual(result.failures, [{ src: "/media/b", error: failure }]);
    assert.deepEqual(lists, original);
  });

  it("returns all posts with blank covers when every fetch fails", async () => {
    const failure = new Error("Offline");
    const result = await resolveBlogPreviewCovers({ main: { posts: [post("/media/a"), post("/media/b")], pagination: null } }, async () => { throw failure; });
    assert.deepEqual(result.lists.main.posts.map((p) => p.coverImage), ["", ""]);
    assert.deepEqual(result.objectUrls, []);
    assert.equal(result.failures.length, 2);
  });

  it("does not fetch covers for empty lists or public images", async () => {
    const fetchCover = vi.fn();
    for (const lists of [{}, { main: { posts: [post(""), post("/assets/cover.png")], pagination: null } }]) {
      const result = await resolveBlogPreviewCovers(lists, fetchCover);
      assert.deepEqual(result, { lists, objectUrls: [], failures: [] });
    }
    assert.equal(fetchCover.mock.calls.length, 0);
  });
});
