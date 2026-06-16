export type PaginationResult<T> = {
  currentPage: number;
  endIndex: number;
  items: T[];
  startIndex: number;
  totalItems: number;
  totalPages: number;
};

export function paginateItems<T>(
  items: T[],
  requestedPage: number,
  pageSize: number
): PaginationResult<T> {
  const safePageSize = Math.max(1, pageSize);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, totalItems);

  return {
    currentPage,
    endIndex,
    items: items.slice(startIndex, endIndex),
    startIndex,
    totalItems,
    totalPages,
  };
}
