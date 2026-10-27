import assert from "node:assert/strict";
import { blogListsForPage, paginatedPageCount, pageTitleSuffix, paginate } from "../src/lib/blog.ts";
import type { BlogPostView } from "../src/components/types.ts";
import type { Page, SiteConfig } from "../src/lib/site-config-types.ts";

const posts = Array.from({ length: 25 }, (_, index): BlogPostView & { layoutFilePath: string } => ({
  key: `post-${index + 1}`,
  locale: "de",
  url: `/news/post-${index + 1}/`,
  title: `Post ${index + 1}`,
  excerpt: "",
  coverImage: "",
  publishedAt: null,
  category: { key: "news", name: "News" },
  tags: [],
  body: "",
  metaTitle: "",
  metaDescription: "",
  translations: [{ locale: "de", url: `/news/post-${index + 1}/` }],
  layoutFilePath: "Post.tsx",
}));

const page: Page = {
  id: "news",
  path: "/news",
  layoutId: "layout-news",
  sortOrder: 0,
  isPublished: true,
  layout: null,
  contents: [],
};

const config: SiteConfig = {
  buildTarget: "production",
  posts,
  blogLists: { news: { de: { articles: { postKeys: posts.map(({ key }) => key), pageSize: 12 } } } },
  settings: null,
  locales: [],
  layouts: [],
  pages: [page],
  navigation: [],
  stagingAccess: [],
  assets: [],
};

// Mirrors admin/tests/services/bloglist.test.ts.
{
  const items = Array.from({ length: 25 }, (_, index) => index);
  assert.deepEqual(paginate(items, 12, 2, "/en/news/").pagination, {
    current: 2,
    total: 3,
    prevUrl: "/en/news/",
    nextUrl: "/en/news/?page=3",
    pages: [
      { number: 1, url: "/en/news/" },
      { number: 2, url: "/en/news/?page=2" },
      { number: 3, url: "/en/news/?page=3" },
    ],
  });
  assert.deepEqual(paginate(items, 12, 3, "/en/news/").items, [24]);
  assert.equal(paginate(items, 12, 3, "/en/news/").pagination.nextUrl, null);
  assert.equal(paginate(items, 12, 1, "/en/news/").pagination.prevUrl, null);
  assert.deepEqual(paginate([], 12, 1, "/"), {
    items: [],
    pagination: { current: 1, total: 1, prevUrl: null, nextUrl: null, pages: [{ number: 1, url: "/" }] },
  });
  for (const number of [0, -1, 1.5, 4, NaN]) assert.throws(() => paginate(items, 12, number, "/"), RangeError);
  for (const size of [0, -1, 1.5, NaN]) assert.throws(() => paginate(items, size, 1, "/"), RangeError);
}

assert.deepEqual(blogListsForPage(config, page, "de", 2, "/news/").articles, {
  posts: posts.slice(12, 24).map(({ body, metaTitle, metaDescription, translations, layoutFilePath, ...summary }) => summary),
  pagination: paginate(posts, 12, 2, "/news/").pagination,
});

assert.deepEqual(blogListsForPage({ ...config, blogLists: { news: { de: { articles: { postKeys: [], pageSize: 12 } } } } }, page, "de", 1, "/news/").articles, {
  posts: [],
  pagination: { current: 1, total: 1, prevUrl: null, nextUrl: null, pages: [{ number: 1, url: "/news/" }] },
});

assert.equal(paginatedPageCount(config, page, "de"), 3);
assert.equal(paginatedPageCount({ ...config, blogLists: { news: { de: { articles: { postKeys: [], pageSize: null } } } } }, page, "de"), 1);
assert.equal(pageTitleSuffix("de", 2), " – Seite 2");
assert.equal(pageTitleSuffix("fr", 2), " – Page 2");
assert.equal(pageTitleSuffix("it", 2), " – Pagina 2");
assert.equal(pageTitleSuffix("en", 2), " – Page 2");
assert.equal(pageTitleSuffix("de", 1), "");

console.log("blog.test.ts passed");
