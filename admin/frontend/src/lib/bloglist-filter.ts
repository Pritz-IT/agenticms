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

export function shouldResetBlogListDraft(value: string, lastEmitted: string | null, dirty: boolean): boolean {
  return value !== lastEmitted && !dirty;
}

export function validateBlogListFilterForm(filter: BlogListFilter): string | null {
  for (const field of ["categories", "tags"] as const) {
    if (!Array.isArray(filter[field]) || filter[field].some((key) => typeof key !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key))) {
      return `${field} must be an array of keys`;
    }
  }
  if (filter.tagMatch !== "any" && filter.tagMatch !== "all") return "tagMatch must be any or all";
  if (filter.sort !== "newest" && filter.sort !== "oldest") return "sort must be newest or oldest";
  for (const field of ["dateFrom", "dateTo"] as const) {
    const date = filter[field];
    if (date !== null && (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) {
      return `${field} must be a YYYY-MM-DD date or null`;
    }
  }
  if (filter.dateFrom && filter.dateTo && filter.dateFrom > filter.dateTo) return "dateFrom must not be after dateTo";
  for (const field of ["pageSize", "limit"] as const) {
    const size = filter[field];
    if (size !== null && (!Number.isInteger(size) || size < 1 || size > 100)) return `${field} must be an integer from 1 to 100 or null`;
  }
  if (filter.pageSize === null && filter.limit === null) return "A bloglist without pagination must have a limit";
  return null;
}

export function serializeBlogListFilter(filter: BlogListFilter): string {
  const error = validateBlogListFilterForm(filter);
  if (error) throw new Error(error);
  return JSON.stringify(filter);
}

export function parseBlogListFilter(value: string): BlogListFilter {
  const input: unknown = value === "" ? {} : JSON.parse(value);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Bloglist filter must be an object");
  const defaults: BlogListFilter = {
    categories: [], tags: [], tagMatch: "any", dateFrom: null, dateTo: null,
    sort: "newest", pageSize: 12, limit: null,
  };
  if (Object.keys(input).some((key) => !Object.prototype.hasOwnProperty.call(defaults, key))) throw new Error("Unknown bloglist filter field");
  const filter = { ...defaults, ...input };
  const error = validateBlogListFilterForm(filter);
  if (error) throw new Error(error);
  return filter;
}
