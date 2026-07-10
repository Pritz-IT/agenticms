import assert from "node:assert/strict";
import {
  pageSlug,
  slugToUrlPath,
  buildSitemapUrls,
  buildSitemapXml,
  buildRobotsTxt,
} from "../src/lib/routes.ts";
import type { Page, SiteConfig } from "../src/lib/site-config-types.ts";

// pageSlug
assert.equal(pageSlug("/", "de", "de"), undefined);
assert.equal(pageSlug("", "de", "de"), undefined);
assert.equal(pageSlug("/", "en", "de"), "en");
assert.equal(pageSlug("/contact", "de", "de"), "contact");
assert.equal(pageSlug("/contact", "en", "de"), "en/contact");

// slugToUrlPath
assert.equal(slugToUrlPath(undefined), "/");
assert.equal(slugToUrlPath("contact"), "/contact/");
assert.equal(slugToUrlPath("en/contact"), "/en/contact/");

function makePage(
  path: string,
  overrides: Partial<Page> = {},
  detectedKeys: Record<string, { type: string; initial: string }> = {}
): Page {
  return {
    id: `page-${path}`,
    path,
    layoutId: "layout-x",
    sortOrder: 0,
    isPublished: true,
    layout: {
      id: "layout-x",
      name: "x",
      filePath: "x.tsx",
      detectedKeys,
      registeredAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    contents: [],
    ...overrides,
  } as Page;
}

function makeConfig(pages: Page[], siteUrl: string | null): SiteConfig {
  return {
    settings: siteUrl
      ? {
          id: "s1",
          name: "Test Site",
          domain: "example.com",
          stagingDomain: "staging.example.com",
          defaultLocale: "de",
          siteUrl,
        }
      : null,
    locales: [{ id: "l1", code: "de", label: "Deutsch", isDefault: true, sortOrder: 0 }],
    layouts: [],
    pages,
    navigation: [],
    stagingAccess: [],
    assets: [],
  } as SiteConfig;
}

// buildSitemapUrls: published pages, homepage + subpage
{
  const config = makeConfig([makePage("/"), makePage("/contact")], "https://example.com/");
  assert.deepEqual(buildSitemapUrls(config, "de"), [
    "https://example.com/",
    "https://example.com/contact/",
  ]);
}

// buildSitemapUrls: unpublished pages are excluded
{
  const config = makeConfig(
    [makePage("/"), makePage("/draft", { isPublished: false })],
    "https://example.com"
  );
  assert.deepEqual(buildSitemapUrls(config, "de"), ["https://example.com/"]);
}

// buildSitemapUrls: page canonicalizing elsewhere is excluded, self-canonical stays
{
  const away = makePage("/dupe", {}, {
    "_meta.canonical": { type: "text", initial: "https://other.example.com/original/" },
  });
  const self = makePage("/self", {}, {
    "_meta.canonical": { type: "text", initial: "https://example.com/self/" },
  });
  const config = makeConfig([away, self], "https://example.com");
  assert.deepEqual(buildSitemapUrls(config, "de"), ["https://example.com/self/"]);
}

// buildSitemapUrls: no siteUrl -> empty
{
  const config = makeConfig([makePage("/")], null);
  assert.deepEqual(buildSitemapUrls(config, "de"), []);
}

// buildSitemapXml: structure + escaping
{
  const xml = buildSitemapXml(["https://example.com/a&b/"]);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(xml.includes("<loc>https://example.com/a&amp;b/</loc>"));
  assert.ok(xml.trimEnd().endsWith("</urlset>"));
}

// buildRobotsTxt
assert.equal(
  buildRobotsTxt("https://example.com/"),
  "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n"
);
assert.equal(buildRobotsTxt(null), "User-agent: *\nAllow: /\n");
assert.equal(buildRobotsTxt(undefined), "User-agent: *\nAllow: /\n");

console.log("routes.test.ts passed");
