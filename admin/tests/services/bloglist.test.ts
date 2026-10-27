import { describe, expect, it } from "vitest";
import { BlogListFilterError, parseBlogListFilter, resolveBlogList } from "../../src/services/blog/bloglist.js";
import { paginate } from "../../src/services/blog/pagination.js";
import type { BlogPostView } from "../../src/services/blog/views.js";

const post = (key: string, publishedAt: string | null, tags: string[] = [], locale = "de", category = "news"): BlogPostView => ({
  key, publishedAt, locale, category: { key: category, name: category }, tags: tags.map((key) => ({ key, name: key })),
  url: `/news/${key}/`, title: key, excerpt: "", coverImage: "", body: "", metaTitle: "", metaDescription: "", translations: [],
});
const posts = [post("b", "2026-01-02T23:59:59Z", ["a"]), post("a", "2026-01-01", ["a", "b"]), post("draft", null), post("c", "2026-01-02", ["b"], "en")];
const resolve = (filter: object, locale = "de") => resolveBlogList(posts, parseBlogListFilter(JSON.stringify(filter)), locale).map(({ key }) => key);

describe("bloglist filter", () => {
  it("uses the exact empty filter defaults", () => {
    expect(parseBlogListFilter("")).toEqual({ categories: [], tags: [], tagMatch: "any", dateFrom: null, dateTo: null, sort: "newest", pageSize: 12, limit: null });
  });
  it.each([{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 2.5 }, { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { pageSize: null, limit: null }, { categories: [1] }, { tags: "a" }, { tagMatch: "none" }, { sort: "random" }, { dateFrom: "2026-02-30" }, { dateTo: "2026-1-01" }, { dateFrom: "2026-02-01", dateTo: "2026-01-01" }, { extra: true }])("rejects invalid values %j", (filter) => {
    expect(() => parseBlogListFilter(JSON.stringify(filter))).toThrow(BlogListFilterError);
  });
  it.each(["no json", "[]", "null", '"text"', "12"])("rejects invalid JSON/filter shape %s", (value) => {
    expect(() => parseBlogListFilter(value)).toThrow(BlogListFilterError);
  });
  it("accepts limits, maximum page size and leap dates", () => {
    expect(parseBlogListFilter('{"pageSize":null,"limit":100,"dateFrom":"2024-02-29"}')).toMatchObject({ pageSize: null, limit: 100 });
    expect(parseBlogListFilter('{"pageSize":100}').pageSize).toBe(100);
  });
  it("matches any/all tags and categories by key", () => {
    expect(resolve({ tags: ["a", "b"], tagMatch: "any" })).toEqual(["b", "a"]);
    expect(resolve({ tags: ["a", "b"], tagMatch: "all" })).toEqual(["a"]);
    expect(resolve({ categories: ["other"] })).toEqual([]);
  });
  it("includes both date boundaries by date portion and excludes undated posts", () => {
    expect(resolve({ dateFrom: "2026-01-01", dateTo: "2026-01-02" })).toEqual(["b", "a"]);
    expect(resolve({ dateFrom: "2026-01-02", dateTo: "2026-01-02" })).toEqual(["b"]);
  });
  it("sorts oldest first, null last, limits after sorting, and never falls back to another locale", () => {
    expect(resolve({ sort: "oldest" })).toEqual(["a", "b", "draft"]);
    expect(resolve({ limit: 1 })).toEqual(["b"]);
    expect(resolve({}, "fr")).toEqual([]);
  });
  it("breaks date ties by key without changing input", () => {
    const tied = [post("z", null), post("b", "2026-01-01"), post("a", "2026-01-01"), post("y", null)];
    for (const sort of ["newest", "oldest"]) {
      expect(resolveBlogList(tied, parseBlogListFilter(JSON.stringify({ sort })), "de").map(({ key }) => key)).toEqual(["a", "b", "y", "z"]);
    }
    expect(tied.map(({ key }) => key)).toEqual(["z", "b", "a", "y"]);
  });
});

describe("pagination", () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  it("creates three pages and public query URLs with a bare first page", () => {
    expect(paginate(items, 12, 2, "/en/news/").pagination).toEqual({ current: 2, total: 3, prevUrl: "/en/news/", nextUrl: "/en/news/?page=3", pages: [{ number: 1, url: "/en/news/" }, { number: 2, url: "/en/news/?page=2" }, { number: 3, url: "/en/news/?page=3" }] });
    expect(paginate(items, 12, 3, "/en/news/")).toMatchObject({ items: [24], pagination: { nextUrl: null } });
    expect(paginate(items, 12, 1, "/en/news/").pagination.prevUrl).toBeNull();
  });
  it("keeps an empty first page and rejects invalid/out-of-range pages", () => {
    expect(paginate([], 12, 1, "/")).toMatchObject({ items: [], pagination: { current: 1, total: 1, prevUrl: null, nextUrl: null } });
    for (const page of [0, -1, 1.5, 4, NaN]) expect(() => paginate(items, 12, page, "/")).toThrow(RangeError);
    for (const size of [0, -1, 1.5, NaN]) expect(() => paginate(items, size, 1, "/")).toThrow(RangeError);
  });
});
