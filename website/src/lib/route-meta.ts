import { pageTitleSuffix } from "./blog";
import { pageSlug, pageUrlPath } from "./routes";
import type { StaticPath } from "./static-paths";

export function routeMeta(
  props: StaticPath["props"],
  { base, siteName, defaultLocale, pathname }: { base: string; siteName: string; defaultLocale: string; pathname: string }
) {
  const metaTitle = props.kind === "post"
    ? props.post.metaTitle?.trim() || props.post.title
    : (props.content["_meta.title"] ?? siteName) + pageTitleSuffix(props.locale, props.pageNumber);
  const metaDescription = props.kind === "post"
    ? props.post.metaDescription?.trim() || props.post.excerpt
    : props.content["_meta.description"] ?? "";
  const rawImage = props.kind === "post" ? props.post.coverImage?.trim() || "" : props.content["_meta.image"] ?? "";
  const ogImage = rawImage ? (/^https?:\/\//i.test(rawImage) ? rawImage : base + rawImage) : "";
  const canonical = props.kind === "post"
    ? (base ? base + props.post.url : "")
    : props.pageNumber >= 2
      ? (base ? base + pageUrlPath(pageSlug(props.page.path, props.locale, defaultLocale), props.pageNumber) : "")
      : props.content["_meta.canonical"] || (base ? base + pathname : "");

  return { metaTitle, metaDescription, ogImage, canonical };
}
