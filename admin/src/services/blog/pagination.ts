/**
 * Pages are pre-built under __page/N/. The website nginx template maps ?page=N
 * to those files; another web server or CDN must reproduce that mapping, or
 * pages 2+ stay unreachable. Page 1 uses the bare URL without a query parameter.
 * The editor preview pages through posts itself. Astro dev serves only page 1
 * unless a dev middleware provides the same mapping.
 */
export interface Pagination {
  current: number;
  total: number;
  prevUrl: string | null;
  nextUrl: string | null;
  pages: { number: number; url: string }[];
}

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
