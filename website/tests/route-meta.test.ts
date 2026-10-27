import assert from "node:assert/strict";
import { routeMeta } from "../src/lib/route-meta.ts";
import { buildStaticPaths } from "../src/lib/static-paths.ts";
import { blogConfig } from "./fixtures/blog-config.ts";

const config = blogConfig();
const context = { base: "https://x", siteName: "Test Site", defaultLocale: "de", pathname: "/news/" };
const post = config.posts[0];

for (const blank of ["", " \t\n "]) {
  assert.deepEqual(routeMeta({
    kind: "post", locale: "de",
    post: { ...post, metaTitle: blank, metaDescription: blank, coverImage: blank },
  }, context), {
    metaTitle: post.title,
    metaDescription: post.excerpt,
    ogImage: "",
    canonical: `https://x${post.url}`,
  }, "blank post SEO fields fall back to title/excerpt and omit the image");
}

assert.deepEqual(routeMeta({ kind: "post", post, locale: "de" }, context), {
  metaTitle: post.metaTitle,
  metaDescription: post.metaDescription,
  ogImage: `https://x${post.coverImage}`,
  canonical: `https://x${post.url}`,
});
assert.deepEqual(routeMeta({
  kind: "post", locale: "de",
  post: { ...post, metaTitle: " SEO title ", metaDescription: " SEO description ", coverImage: " https://cdn.example/cover.webp " },
}, context), {
  metaTitle: "SEO title",
  metaDescription: "SEO description",
  ogImage: "https://cdn.example/cover.webp",
  canonical: `https://x${post.url}`,
});

const paths = buildStaticPaths(config, "de");
const first = paths[0].props;
const second = paths[1].props;
assert.equal(first.kind, "page");
assert.equal(second.kind, "page");
if (first.kind === "page" && second.kind === "page") {
  assert.deepEqual(routeMeta(second, { ...context, pathname: "/news/__page/2/" }), {
    metaTitle: "News – Seite 2", metaDescription: "News description", ogImage: "", canonical: "https://x/news/?page=2",
  });
  const content = { ...first.content, "_meta.canonical": "https://other.example/original/", "_meta.image": "/cover.webp" };
  assert.deepEqual(routeMeta({ ...first, content }, context), {
    metaTitle: "News", metaDescription: "News description", ogImage: "https://x/cover.webp", canonical: content["_meta.canonical"],
  });
  assert.equal(routeMeta(first, context).canonical, "https://x/news/");
  assert.equal(routeMeta({ ...second, content }, context).canonical, "https://x/news/?page=2");
  assert.equal(routeMeta({ ...second, locale: "en" }, context).canonical, "https://x/en/news/?page=2");
  assert.equal(routeMeta({ ...second, locale: "en" }, context).metaTitle, "News – Page 2");
  assert.equal(routeMeta({ ...second, page: { ...second.page, path: "/" } }, context).canonical, "https://x/?page=2");
  assert.equal(routeMeta({ ...first, content: {} }, context).metaTitle, "Test Site");
  assert.equal(routeMeta(second, { ...context, base: "" }).canonical, "");
}
assert.equal(routeMeta({ kind: "post", post, locale: "de" }, { ...context, base: "" }).canonical, "");

console.log("route-meta.test.ts passed");
