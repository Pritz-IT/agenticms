import { describe, expect, it } from "vitest";
import { paginateItems } from "../../frontend/src/lib/pagination";

describe("paginateItems", () => {
  it("returns a bounded page slice with display indexes", () => {
    const items = Array.from({ length: 23 }, (_, index) => index + 1);

    const page = paginateItems(items, 3, 10);

    expect(page.items).toEqual([21, 22, 23]);
    expect(page.currentPage).toBe(3);
    expect(page.totalPages).toBe(3);
    expect(page.startIndex).toBe(20);
    expect(page.endIndex).toBe(23);
    expect(page.totalItems).toBe(23);
  });

  it("clamps requested pages into the valid range", () => {
    const items = Array.from({ length: 12 }, (_, index) => index);

    expect(paginateItems(items, 0, 5).currentPage).toBe(1);
    expect(paginateItems(items, 99, 5).currentPage).toBe(3);
  });

  it("keeps empty lists on page one", () => {
    const page = paginateItems([], 4, 10);

    expect(page.items).toEqual([]);
    expect(page.currentPage).toBe(1);
    expect(page.totalPages).toBe(1);
    expect(page.startIndex).toBe(0);
    expect(page.endIndex).toBe(0);
  });
});
