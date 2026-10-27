import type { BlogList, ContentMap } from "../components/types";
import type { Page, SiteConfig } from "./site-config-types";
import { blogListsForPage, paginatedPageCount } from "./blog";
import { resolveContent } from "./content";
import { pageSlug } from "./routes";

export type StaticPath = {
  params: { slug: string | undefined };
  props:
    | { kind: "page"; page: Page; locale: string; content: ContentMap; pageNumber: number; blogLists: Record<string, BlogList> }
    | { kind: "post"; post: SiteConfig["posts"][number]; locale: string };
};

export function buildStaticPaths(config: SiteConfig, defaultLocale: string): StaticPath[] {
  const paths: StaticPath[] = [];
  for (const page of config.pages) {
    for (const locale of config.locales) {
      const slug = pageSlug(page.path, locale.code, defaultLocale);
      const content = resolveContent(page, locale.code, defaultLocale);
      const total = paginatedPageCount(config, page, locale.code);
      for (let pageNumber = 1; pageNumber <= total; pageNumber++) {
        paths.push({
          params: { slug: pageNumber === 1 ? slug : `${slug ? `${slug}/` : ""}__page/${pageNumber}` },
          props: {
            kind: "page", page, locale: locale.code, content, pageNumber,
            blogLists: blogListsForPage(config, page, locale.code, pageNumber, slug ? `/${slug}` : "/"),
          },
        });
      }
    }
  }
  for (const post of config.posts) {
    paths.push({
      params: { slug: post.url.replace(/^\/+|\/+$/g, "") || undefined },
      props: { kind: "post", post, locale: post.locale },
    });
  }
  return paths;
}
