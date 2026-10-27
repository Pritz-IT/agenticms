import type { BlogPostView, BlogPostSummary } from "./views.js";
import type { Pagination } from "./pagination.js";

export interface BlogListFilter {
  categories: string[];
  tags: string[];
  tagMatch: "any" | "all";
  dateFrom: string | null;
  dateTo: string | null;
  sort: "newest" | "oldest";
  pageSize: number | null;
  limit: number | null;
}

export interface BlogList {
  posts: BlogPostSummary[];
  pagination: Pagination | null;
}

export class BlogListFilterError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "BlogListFilterError";
  }
}

export function parseBlogListFilter(value: string): BlogListFilter {
  if (typeof value !== "string") throw new BlogListFilterError("Bloglist filter must be a JSON string");
  let input: unknown;
  try {
    input = value === "" ? {} : JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new BlogListFilterError("Bloglist filter must be valid JSON");
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BlogListFilterError("Bloglist filter must be an object");
  const defaults: BlogListFilter = { categories: [], tags: [], tagMatch: "any", dateFrom: null, dateTo: null, sort: "newest", pageSize: 12, limit: null };
  if (Object.keys(input).some((key) => !Object.hasOwn(defaults, key))) throw new BlogListFilterError("Unknown bloglist filter field");
  const filter = { ...defaults, ...input };
  for (const field of ["categories", "tags"] as const) {
    if (!Array.isArray(filter[field]) || filter[field].some((key) => typeof key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))) {
      throw new BlogListFilterError(`${field} must be an array of keys`);
    }
  }
  if (filter.tagMatch !== "any" && filter.tagMatch !== "all") throw new BlogListFilterError("tagMatch must be any or all");
  if (filter.sort !== "newest" && filter.sort !== "oldest") throw new BlogListFilterError("sort must be newest or oldest");
  for (const field of ["dateFrom", "dateTo"] as const) {
    const date = filter[field];
    if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      throw new BlogListFilterError(`${field} must be a YYYY-MM-DD date or null`);
    }
  }
  if (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) throw new BlogListFilterError("dateFrom must not be after dateTo");
  for (const field of ["pageSize", "limit"] as const) {
    const size = filter[field];
    if (size !== null && (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > 100)) throw new BlogListFilterError(`${field} must be an integer from 1 to 100 or null`);
  }
  if (filter.pageSize === null && filter.limit === null) throw new BlogListFilterError("A bloglist without pagination must have a limit");
  return filter;
}

export function resolveBlogList(posts: BlogPostView[], filter: BlogListFilter, locale: string): BlogPostView[] {
  const matched = posts.filter((post) => {
    if (post.locale !== locale || (filter.categories.length && !filter.categories.includes(post.category.key))) return false;
    const hasTag = (key: string) => post.tags.some((tag) => tag.key === key);
    if (filter.tags.length && !(filter.tagMatch === "all" ? filter.tags.every(hasTag) : filter.tags.some(hasTag))) return false;
    const date = post.publishedAt?.slice(0, 10);
    return (!filter.dateFrom || (date !== undefined && date >= filter.dateFrom))
      && (!filter.dateTo || (date !== undefined && date <= filter.dateTo));
  });
  matched.sort((a, b) => {
    if (a.publishedAt === null && b.publishedAt !== null) return 1;
    if (b.publishedAt === null && a.publishedAt !== null) return -1;
    const dateOrder = (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "");
    return (filter.sort === "oldest" ? dateOrder : -dateOrder) || a.key.localeCompare(b.key);
  });
  return filter.limit === null ? matched : matched.slice(0, filter.limit);
}

export function blogListDefaults(detectedKeys: unknown): Record<string, string> {
  const definitions = (detectedKeys ?? {}) as Record<string, { type: string; initial?: string }>;
  return Object.fromEntries(Object.entries(definitions)
    .filter(([, definition]) => definition.type === "bloglist")
    .map(([key, definition]) => [key, definition.initial ?? ""]));
}
