import { routeMeta } from "./route-meta";
import type { SiteConfig } from "./site-config-types";
import type { StaticPath } from "./static-paths";

// Single source of the document <head> for both the static build ([...slug].astro)
// and the admin's in-process post preview. Returns finished HTML so the two
// renderers cannot drift tag by tag.

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function tag(name: "meta" | "link", attrs: Record<string, string>): string {
  return `<${name}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join("")}>`;
}

export function documentHeadHtml(
  props: StaticPath["props"],
  config: SiteConfig,
  { content, defaultLocale, pathname }: { content: Record<string, string>; defaultLocale: string; pathname: string }
): string {
  const favicon = content["_meta.favicon"];
  const base = (config.settings?.siteUrl ?? "").replace(/\/+$/, "");
  const siteName = config.settings?.name ?? "";
  const { metaTitle, metaDescription, ogImage, canonical } = routeMeta(props, { base, siteName, defaultLocale, pathname });

  const isHomepage = props.kind === "page" && props.pageNumber === 1 && props.page.path.replace(/^\//, "") === "";
  // `<` escaped so a site name can never close the script element.
  const organizationJsonLd = isHomepage && siteName && base
    ? JSON.stringify({ "@context": "https://schema.org", "@type": "Organization", name: siteName, url: base + "/" }).replace(/</g, "\\u003c")
    : "";

  const parts = [
    tag("meta", { charset: "utf-8" }),
    tag("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
    `<title>${escapeText(metaTitle)}</title>`,
  ];
  if (config.buildTarget === "staging") parts.push(tag("meta", { name: "robots", content: "noindex" }));
  if (metaDescription) parts.push(tag("meta", { name: "description", content: metaDescription }));
  if (favicon) parts.push(tag("link", { rel: "shortcut icon", href: favicon }));
  if (canonical) parts.push(tag("link", { rel: "canonical", href: canonical }));
  parts.push(tag("meta", { property: "og:type", content: "website" }));
  if (siteName) parts.push(tag("meta", { property: "og:site_name", content: siteName }));
  if (metaTitle) parts.push(tag("meta", { property: "og:title", content: metaTitle }));
  if (metaDescription) parts.push(tag("meta", { property: "og:description", content: metaDescription }));
  if (canonical) parts.push(tag("meta", { property: "og:url", content: canonical }));
  if (metaTitle) parts.push(tag("meta", { name: "twitter:title", content: metaTitle }));
  if (metaDescription) parts.push(tag("meta", { name: "twitter:description", content: metaDescription }));
  if (ogImage) {
    parts.push(
      tag("meta", { property: "og:image", content: ogImage }),
      tag("meta", { name: "twitter:image", content: ogImage }),
      tag("meta", { name: "twitter:card", content: "summary_large_image" }),
    );
  } else {
    parts.push(tag("meta", { name: "twitter:card", content: "summary" }));
  }
  if (organizationJsonLd) parts.push(`<script type="application/ld+json">${organizationJsonLd}</script>`);
  return parts.join("");
}
