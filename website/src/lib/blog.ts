import type { BlogList, BlogPostSummary, Pagination } from "../components/types";
import type { Page, SiteConfig } from "./site-config-types";

// ponytail: mirrors admin/src/services/blog/pagination.ts
export function paginate<T>(items: T[], pageSize: number, page: number, basePath: string): { items: T[]; pagination: Pagination } {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");
  const total = Math.max(1, Math.ceil(items.length / pageSize));
  if (!Number.isSafeInteger(page) || page < 1 || page > total) throw new RangeError("Page out of range");
  const url = (number: number) => number === 1 ? basePath : `${basePath}?page=${number}`;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    pagination: {
      current: page, total, prevUrl: page > 1 ? url(page - 1) : null, nextUrl: page < total ? url(page + 1) : null,
      pages: Array.from({ length: total }, (_, index) => ({ number: index + 1, url: url(index + 1) })),
    },
  };
}

function summary({ body, metaTitle, metaDescription, translations, layoutFilePath, ...post }: SiteConfig["posts"][number]): BlogPostSummary {
  return post;
}

function listConfig(config: SiteConfig, page: Page, locale: string) {
  return config.blogLists[page.id]?.[locale] ?? {};
}

export function blogListsForPage(config: SiteConfig, page: Page, locale: string, pageNumber: number, basePath: string): Record<string, BlogList> {
  const postsByKey = new Map(config.posts.filter((post) => post.locale === locale).map((post) => [post.key, post]));
  return Object.fromEntries(Object.entries(listConfig(config, page, locale)).map(([key, filter]) => {
    const posts = filter.postKeys.flatMap((postKey) => {
      const post = postsByKey.get(postKey);
      return post ? [summary(post)] : [];
    });
    if (filter.pageSize === null) return [key, { posts, pagination: null }];
    const result = paginate(posts, filter.pageSize, pageNumber, basePath);
    return [key, { posts: result.items, pagination: result.pagination }];
  }));
}

export function paginatedPageCount(config: SiteConfig, page: Page, locale: string): number {
  const filter = Object.values(listConfig(config, page, locale)).find(({ pageSize }) => pageSize !== null);
  if (!filter?.pageSize) return 1;
  return Math.max(1, Math.ceil(filter.postKeys.length / filter.pageSize));
}

export function pageTitleSuffix(locale: string, pageNumber: number): string {
  if (pageNumber === 1) return "";
  const pageWord = { de: "Seite", fr: "Page", it: "Pagina" }[locale] ?? "Page";
  return ` – ${pageWord} ${pageNumber}`;
}
