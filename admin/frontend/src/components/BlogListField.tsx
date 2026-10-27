import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBlogCategories, fetchBlogTags } from "../api/blog";
import { blogErrorMessage, showBlogError } from "../lib/blog-error";
import { parseBlogListFilter, serializeBlogListFilter, validateBlogListFilterForm, type BlogListFilter } from "../lib/bloglist-filter";
import { BlogSelect } from "./blog/BlogSelect";

interface BlogListFieldProps {
  siteKey: string;
  locale: string;
  value: string;
  onChange: (value: string) => void;
  onValidityChange?: (valid: boolean) => void;
}

const inputClass = "w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-600";

function readFilter(value: string) {
  try {
    return { filter: parseBlogListFilter(value), error: null };
  } catch (error) {
    console.error("[blog] read list filter failed", error);
    return { filter: null, error: blogErrorMessage(error) };
  }
}

export function BlogListField({ siteKey, locale, value, onChange, onValidityChange }: BlogListFieldProps) {
  const tagMatchName = useId();
  const [draft, setDraft] = useState(() => readFilter(value));
  useEffect(() => { setDraft(readFilter(value)); }, [value]);
  const categories = useQuery({ queryKey: ["blog-categories", siteKey], queryFn: () => fetchBlogCategories(siteKey) });
  const tags = useQuery({ queryKey: ["blog-tags", siteKey], queryFn: () => fetchBlogTags(siteKey) });
  const loadError = categories.error ?? tags.error;
  useEffect(() => { if (loadError) showBlogError("load blog filters", loadError); }, [loadError]);

  const { filter } = draft;
  const error = draft.error ?? (filter ? validateBlogListFilterForm(filter) : "Invalid filter");
  useEffect(() => { onValidityChange?.(!error); }, [error, onValidityChange]);

  function change(next: BlogListFilter) {
    setDraft({ filter: next, error: null });
    if (!validateBlogListFilterForm(next)) onChange(serializeBlogListFilter(next));
  }

  if (!filter) return <div role="alert" className="space-y-2 text-sm text-red-400">
    <p>{error}</p>
    <button type="button" className="underline" onClick={() => change(parseBlogListFilter(""))}>Reset filter to defaults</button>
  </div>;

  return <div className="flex flex-col gap-4">
    <p className="text-xs text-neutral-400">Shared across all languages. An empty selection includes all posts.</p>
    {loadError && <p role="alert" className="text-sm text-red-400">{blogErrorMessage(loadError)}</p>}
    {(["categories", "tags"] as const).map((field) => {
      const query = field === "categories" ? categories : tags;
      return <fieldset key={field} className="min-w-0">
        <legend className="mb-1.5 text-sm text-neutral-400">{field === "categories" ? "Categories" : "Tags"}</legend>
        <div className="max-h-32 overflow-y-auto rounded border border-neutral-700 p-2 space-y-1">
          {query.isPending ? <p className="text-xs text-neutral-500">Loading…</p> : !query.data?.length ? <p className="text-xs text-neutral-500">No {field} available.</p> : query.data.map((item) => <label key={item.key} className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={filter[field].includes(item.key)} onChange={(event) => change({ ...filter, [field]: event.target.checked ? [...filter[field], item.key] : filter[field].filter((key) => key !== item.key) })} />
            {item.names[locale] || item.key}
          </label>)}
        </div>
      </fieldset>;
    })}
    <fieldset className="flex items-center gap-4 text-sm text-neutral-300">
      <legend className="mb-1.5 text-neutral-400">Match tags</legend>
      {(["any", "all"] as const).map((match) => <label key={match} className="flex items-center gap-2">
        <input type="radio" name={tagMatchName} checked={filter.tagMatch === match} onChange={() => change({ ...filter, tagMatch: match })} />
        {match === "any" ? "Any" : "All"}
      </label>)}
    </fieldset>
    <div className="grid grid-cols-2 gap-3">
      {(["dateFrom", "dateTo"] as const).map((field) => <label key={field} className="min-w-0 text-sm text-neutral-400">
        {field === "dateFrom" ? "Date from" : "Date to"}
        <input type="date" className={`${inputClass} mt-1.5`} value={filter[field] ?? ""} onChange={(event) => change({ ...filter, [field]: event.target.value || null })} />
      </label>)}
    </div>
    <BlogSelect label="Sort" value={filter.sort} emptyLabel="Newest first" options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]} onChange={(sort) => change({ ...filter, sort: sort === "oldest" ? "oldest" : "newest" })} />
    <label className="flex items-center gap-2 text-sm text-neutral-300">
      <input type="checkbox" checked={filter.pageSize !== null} onChange={(event) => change({ ...filter, pageSize: event.target.checked ? 12 : null })} />
      Paginate posts
    </label>
    <div className="grid grid-cols-2 gap-3">
      {(["pageSize", "limit"] as const).map((field) => <label key={field} className="text-sm text-neutral-400">
        {field === "pageSize" ? "Page size" : "Limit"}
        <input type="number" min={1} max={100} step={1} disabled={field === "pageSize" && filter.pageSize === null}
          className={`${inputClass} mt-1.5 disabled:opacity-40`} value={filter[field] === null || Number.isNaN(filter[field]) ? "" : filter[field]!}
          onChange={(event) => change({ ...filter, [field]: event.target.value === "" && field === "limit" ? null : event.target.valueAsNumber })} />
      </label>)}
    </div>
    <p className="text-xs text-neutral-500">1–100 posts. A limit is required when pagination is off.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </div>;
}
