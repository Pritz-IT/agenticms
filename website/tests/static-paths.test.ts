import assert from "node:assert/strict";
import { buildStaticPaths } from "../src/lib/static-paths.ts";
import { resolveContent } from "../src/lib/content.ts";
import { buildSitemapUrls, buildSitemapXml, pageSlug } from "../src/lib/routes.ts";
import { blogConfig } from "./fixtures/blog-config.ts";
import defaultConfig from "../src/data/default-config.json";
import type { SiteConfig } from "../src/lib/site-config-types.ts";

assert.deepEqual(buildStaticPaths(defaultConfig as SiteConfig, "en"), []);

const config = blogConfig();
const paths = buildStaticPaths(config, "de");
assert.deepEqual(paths.filter(({ props }) => props.kind === "page").map(({ params }) => params.slug), [
  "news", "news/__page/2", "news/__page/3", "news/__page/1", "en/news", "en/news/__page/1",
]);
assert.equal(paths.length, 32);
for (const slug of ["news", "en/news"]) {
  assert.deepEqual(paths.find(({ params }) => params.slug === `${slug}/__page/1`)!.props,
    paths.find(({ params }) => params.slug === slug)!.props);
}
for (const post of config.posts) {
  const path = paths.find(({ params }) => params.slug === post.url.replace(/^\/+|\/+$/g, ""));
  assert.deepEqual(path?.props, { kind: "post", post, locale: post.locale });
}
const second = paths.find(({ params }) => params.slug === "news/__page/2")!.props;
assert.equal(second.kind, "page");
if (second.kind === "page") {
  assert.equal(second.pageNumber, 2);
  assert.equal(second.blogLists.articles.pagination?.prevUrl, "/news/");
  assert.deepEqual(second.content, resolveContent(config.pages[0], "de", "de"));
  assert.deepEqual(second.blogLists.articles.posts.map(({ key }) => key), config.posts.slice(12, 24).map(({ key }) => key));
  assert.equal(second.blogLists.articles.pagination?.pages[1].url, "/news/?page=2");
}
const english = paths.find(({ params }) => params.slug === "en/news")!.props;
assert.equal(english.kind, "page");
if (english.kind === "page") assert.deepEqual(english.blogLists.articles.posts.map(({ locale }) => locale), ["en"]);

// Pagination also works at the default-locale root and at a locale root.
const homepage = blogConfig();
homepage.pages[0].path = "/";
homepage.blogLists.news.en.articles.postKeys = [];
const homePaths = buildStaticPaths(homepage, "de");
assert.deepEqual(homePaths.filter(({ props }) => props.kind === "page").map(({ params }) => params.slug), [
  undefined, "__page/2", "__page/3", "__page/1", "en", "en/__page/1",
]);
const homeSecond = homePaths[1].props;
if (homeSecond.kind === "page") assert.equal(homeSecond.blogLists.articles.pagination?.pages[1].url, "/?page=2");
const emptyEnglish = homePaths.find(({ params }) => params.slug === "en")!.props;
if (emptyEnglish.kind === "page") assert.deepEqual(emptyEnglish.blogLists.articles.posts, []);
assert.deepEqual(homePaths.find(({ params }) => params.slug === "__page/1")!.props, homePaths[0].props);
assert.deepEqual(homePaths.find(({ params }) => params.slug === "en/__page/1")!.props, emptyEnglish);

// Single-page and empty overviews still create the directory nginx uses to detect pagination.
for (const postKeys of [["post-1"], []]) {
  const singlePage = blogConfig();
  singlePage.blogLists.news.de.articles.postKeys = postKeys;
  const singlePaths = buildStaticPaths(singlePage, "de");
  assert.deepEqual(singlePaths.filter(({ props }) => props.kind === "page").map(({ params }) => params.slug), [
    "news", "news/__page/1", "en/news", "en/news/__page/1",
  ]);
  const first = singlePaths[0].props;
  assert.equal(first.kind, "page");
  if (first.kind === "page") assert.equal(first.pageNumber, 1);
  assert.deepEqual(singlePaths[1].props, first);
}

// Internal marker and chunk routes never become sitemap URLs.
for (const sitemapConfig of [config, homepage]) {
  const urls = buildSitemapUrls(sitemapConfig, "de");
  assert.equal(urls.length, 30);
  assert.ok(urls.includes(sitemapConfig === homepage ? "https://x/?page=2" : "https://x/news/?page=2"));
  assert.ok(!buildSitemapXml(urls).includes("__page"));
}

const englishPagination = blogConfig();
englishPagination.blogLists.news.en.articles = { postKeys: ["post-1", "post-2"], pageSize: 1 };
englishPagination.posts.push({ ...englishPagination.posts[1], locale: "en", url: "/en/news/second-english-post" });
const englishSecond = buildStaticPaths(englishPagination, "de").find(({ params }) => params.slug === "en/news/__page/2")!.props;
assert.equal(englishSecond.kind, "page");
if (englishSecond.kind === "page") {
  assert.equal(englishSecond.blogLists.articles.pagination?.prevUrl, "/en/news/");
  assert.equal(englishSecond.blogLists.articles.posts[0].url, "/en/news/second-english-post");
}

// Unpaginated secondary lists repeat unchanged across overview pages.
const sidebar = blogConfig();
sidebar.blogLists.news.de.sidebar = { postKeys: ["post-1"], pageSize: null };
const sidebarSecond = buildStaticPaths(sidebar, "de")[1].props;
if (sidebarSecond.kind === "page") {
  assert.equal(sidebarSecond.blogLists.sidebar.posts[0].key, "post-1");
  assert.equal(sidebarSecond.blogLists.sidebar.pagination, null);
}

// No-blog sites keep the original paths, locale and resolved content.
const unpaginated = blogConfig();
for (const lists of Object.values(unpaginated.blogLists.news)) lists.articles.pageSize = null;
assert.deepEqual(buildStaticPaths(unpaginated, "de").filter(({ props }) => props.kind === "page").map(({ params }) => params.slug), [
  "news", "en/news",
]);
const noBlog = { ...config, posts: [], blogLists: {} };
assert.deepEqual(buildStaticPaths(noBlog, "de"), config.pages.flatMap((page) => config.locales.map((locale) => ({
  params: { slug: pageSlug(page.path, locale.code, "de") },
  props: { kind: "page", page, locale: locale.code, content: resolveContent(page, locale.code, "de"), pageNumber: 1, blogLists: {} },
}))));

console.log("static-paths.test.ts passed");
