import assert from "node:assert/strict";
import { documentHeadHtml } from "../src/lib/document-head.ts";
import { buildStaticPaths } from "../src/lib/static-paths.ts";
import { blogConfig } from "./fixtures/blog-config.ts";

const config = blogConfig();
const post = config.posts[0];
const options = { content: {}, defaultLocale: "de", pathname: post.url };

const hostile = documentHeadHtml(
  { kind: "post", locale: "de", post: { ...post, metaTitle: `</title><script>x</script>`, metaDescription: `"><script>` } },
  { ...config, buildTarget: "staging" },
  options,
);
assert.ok(!hostile.includes("<script>"), "title and attribute values are escaped");
assert.ok(hostile.includes(`<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>`));
assert.ok(hostile.includes(`<meta name="robots" content="noindex">`), "staging builds are noindex");

const production = documentHeadHtml({ kind: "post", locale: "de", post }, { ...config, buildTarget: "production" }, options);
assert.ok(!production.includes("noindex"), "production builds are indexable");

const anyPage = buildStaticPaths(config, "de").map((path) => path.props).find((props) => props.kind === "page");
assert.ok(anyPage && anyPage.kind === "page", "fixture has a page");
const home = { ...anyPage, pageNumber: 1, page: { ...anyPage.page, path: "/" } };
const head = documentHeadHtml(home, { ...config, settings: { ...config.settings!, name: "</script><b>", siteUrl: "https://x" } }, { ...options, pathname: "/" });
assert.ok(head.includes(`"name":"\\u003c/script>\\u003cb>"`), "JSON-LD cannot close its script element");

console.log("document-head tests passed");
