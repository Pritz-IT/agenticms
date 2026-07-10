import type { SiteConfig } from "./site-config-types";
import { resolveContent } from "./content";

/**
 * Builds the route slug for a page/locale combination.
 * Returns undefined for the default-locale homepage (Astro's root route).
 */
export function pageSlug(
  pagePath: string,
  localeCode: string,
  defaultLocale: string
): string | undefined {
  const stripped = pagePath.replace(/^\//, "");
  const isHomepage = stripped === "" || stripped === "/";
  const isDefault = localeCode === defaultLocale;

  if (isHomepage) {
    return isDefault ? undefined : localeCode;
  }
  return isDefault ? stripped : `${localeCode}/${stripped}`;
}

/** Converts a route slug to the served URL path (directory build format → trailing slash). */
export function slugToUrlPath(slug: string | undefined): string {
  return slug ? `/${slug}/` : "/";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Collects the absolute URLs of all indexable pages: published pages only,
 * excluding pages whose _meta.canonical points somewhere else.
 * Returns [] when settings.siteUrl is not configured.
 */
export function buildSitemapUrls(config: SiteConfig, defaultLocale: string): string[] {
  const base = (config.settings?.siteUrl ?? "").replace(/\/+$/, "");
  if (!base) {
    return [];
  }

  const urls: string[] = [];
  for (const page of config.pages) {
    if (!page.isPublished) {
      continue;
    }
    for (const locale of config.locales) {
      const loc = base + slugToUrlPath(pageSlug(page.path, locale.code, defaultLocale));
      const content = resolveContent(page, locale.code, defaultLocale);
      const canonicalOverride = content["_meta.canonical"];
      if (canonicalOverride && canonicalOverride !== loc) {
        continue;
      }
      urls.push(loc);
    }
  }
  return urls;
}

export function buildSitemapXml(urls: string[]): string {
  const entries = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</urlset>",
    "",
  ].join("\n");
}

export function buildRobotsTxt(siteUrl: string | null | undefined): string {
  const base = (siteUrl ?? "").replace(/\/+$/, "");
  const lines = ["User-agent: *", "Allow: /"];
  if (base) {
    lines.push("", `Sitemap: ${base}/sitemap.xml`);
  }
  return lines.join("\n") + "\n";
}
