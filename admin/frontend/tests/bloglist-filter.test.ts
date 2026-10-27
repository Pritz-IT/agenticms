import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseBlogListFilter as parseStoredFilter } from "../../src/services/blog/bloglist";
import { parseBlogListFilter, serializeBlogListFilter, validateBlogListFilterForm } from "../src/lib/bloglist-filter";

describe("bloglist filter form", () => {
  for (const field of ["pageSize", "limit"] as const) {
    for (const value of [0, 101, 2.5]) {
      it(`rejects ${field} ${value}`, () => {
        assert.ok(validateBlogListFilterForm({ ...parseStoredFilter(""), [field]: value }));
      });
    }
  }
  it("requires a limit when pagination is off", () => {
    assert.ok(validateBlogListFilterForm({ ...parseStoredFilter(""), pageSize: null }));
    assert.equal(validateBlogListFilterForm({ ...parseStoredFilter(""), pageSize: null, limit: 3 }), null);
  });
  it("round-trips through the backend parser without changing the filter", () => {
    const filter = { ...parseStoredFilter(""), categories: ["news"], tags: ["transport"], tagMatch: "all" as const,
      dateFrom: "2026-01-01", dateTo: "2026-10-27", sort: "oldest" as const, pageSize: 1, limit: 100 };
    assert.deepEqual(parseStoredFilter(serializeBlogListFilter(filter)), filter);
    assert.deepEqual(parseBlogListFilter(serializeBlogListFilter(filter)), filter);
  });
  it("uses the backend defaults for an empty or partial value", () => {
    for (const value of ["", "{}", '{"limit":5}']) {
      assert.deepEqual(parseBlogListFilter(value), parseStoredFilter(value));
    }
  });
  it("rejects invalid dates, reversed dates, invalid keys and unknown fields", () => {
    for (const patch of [
      { dateFrom: "2026-02-30" }, { dateFrom: "2026-10-27", dateTo: "2026-01-01" },
      { categories: ["Bad key"] }, { tagMatch: "other" }, { sort: "other" }, { extra: true },
    ]) {
      const value = JSON.stringify({ ...parseStoredFilter(""), ...patch });
      assert.throws(() => parseStoredFilter(value));
      assert.throws(() => parseBlogListFilter(value));
    }
  });
});
