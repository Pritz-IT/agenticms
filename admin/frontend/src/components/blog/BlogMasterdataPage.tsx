import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchBlogCategories,
  createBlogCategory,
  updateBlogCategory,
  deleteBlogCategory,
  fetchBlogTags,
  createBlogTag,
  updateBlogTag,
  deleteBlogTag,
} from "../../api/blog";
import { fetchLocales } from "../../api/locales";
import { fetchPages } from "../../api/pages";
import { fetchLayouts } from "../../api/layouts";
import type { BlogCategory, BlogTag } from "../../api/types";
import { blogErrorMessage, showBlogError } from "../../lib/blog-error";
import { DEFAULT_SITE_KEY } from "../../site-routing";
import { TopBar } from "../TopBar";
import { BlogSelect } from "./BlogSelect";

const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none";
const emptyDraft = (): BlogCategory => ({
  key: "",
  names: {},
  sortOrder: 0,
  pagePath: "",
  defaultLayout: "",
});

export function BlogMasterdataPage({ kind }: { kind: "categories" | "tags" }) {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  return <Masterdata key={`${siteKey}/${kind}`} siteKey={siteKey} kind={kind} />;
}

function Masterdata({ siteKey, kind }: { siteKey: string; kind: "categories" | "tags" }) {
  const isCategory = kind === "categories";
  const title = isCategory ? "Blog categories" : "Tags";
  const singular = isCategory ? "category" : "tag";
  const qc = useQueryClient();
  const queryKey = ["blog", siteKey, kind];
  const recordsQuery = useQuery<BlogTag[]>({
    queryKey,
    queryFn: () => (isCategory ? fetchBlogCategories(siteKey) : fetchBlogTags(siteKey)),
  });
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const pagesQuery = useQuery({
    queryKey: ["pages", siteKey],
    queryFn: () => fetchPages(siteKey),
    enabled: isCategory,
  });
  const layoutsQuery = useQuery({
    queryKey: ["layouts", siteKey, "post"],
    queryFn: () => fetchLayouts(siteKey, "post"),
    enabled: isCategory,
  });
  const [draft, setDraft] = useState(emptyDraft);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  function closeForm() {
    setFormOpen(false);
    setEditingKey(null);
    setDraft(emptyDraft());
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      // PATCH replaces all names, including translations outside the currently visible locale.
      const common = {
        key: draft.key,
        sortOrder: draft.sortOrder,
        names: Object.fromEntries(Object.entries(draft.names).filter(([, name]) => name.trim())),
      };
      if (isCategory) {
        const data = { ...common, pagePath: draft.pagePath, defaultLayout: draft.defaultLayout };
        return editingKey ? updateBlogCategory(siteKey, editingKey, data) : createBlogCategory(siteKey, data);
      }
      return editingKey ? updateBlogTag(siteKey, editingKey, common) : createBlogTag(siteKey, common);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog", siteKey] });
      toast.success(`${isCategory ? "Category" : "Tag"} saved`);
      closeForm();
    },
    onError: (error) => showBlogError(`save ${singular}`, error),
  });
  const deleteMutation = useMutation({
    mutationFn: (key: string) =>
      isCategory ? deleteBlogCategory(siteKey, key) : deleteBlogTag(siteKey, key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog", siteKey] });
      toast.success(`${isCategory ? "Category" : "Tag"} deleted`);
    },
    onError: (error) => showBlogError(`delete ${singular}`, error),
  });
  const queries = [recordsQuery, localesQuery, ...(isCategory ? [pagesQuery, layoutsQuery] : [])];
  const error = queries.find((query) => query.error)?.error;
  const loading = queries.some((query) => query.isLoading);
  const busy = saveMutation.isPending || deleteMutation.isPending;
  const locales = localesQuery.data ?? [];

  function edit(record: BlogTag) {
    setDraft({ ...emptyDraft(), ...record, names: { ...record.names } });
    setEditingKey(record.key);
    setFormOpen(true);
    saveMutation.reset();
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title={title} />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        {loading ? (
          <p className="text-zinc-400">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-red-400">
            {blogErrorMessage(error)}
          </p>
        ) : (
          <>
            {!formOpen && (
              <button
                className="self-start rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950"
                disabled={busy}
                onClick={() => {
                  setFormOpen(true);
                  saveMutation.reset();
                }}
              >
                New {singular}
              </button>
            )}
            {formOpen && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMutation.mutate();
                }}
                className="max-w-3xl"
              >
                <fieldset disabled={busy} className="flex flex-col gap-4 disabled:opacity-60">
                  <h2 className="text-lg font-semibold">
                    {editingKey ? `Edit ${singular}: ${editingKey}` : `New ${singular}`}
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                      Key
                      <input
                        className={inputClass}
                        required
                        pattern="[a-z0-9]+(-[a-z0-9]+)*"
                        title="Lowercase letters, digits and single hyphens"
                        value={draft.key}
                        readOnly={editingKey !== null}
                        onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                      Order
                      <input
                        className={inputClass}
                        type="number"
                        required
                        step="1"
                        min="-2147483648"
                        max="2147483647"
                        value={Number.isNaN(draft.sortOrder) ? "" : draft.sortOrder}
                        onChange={(event) => setDraft({ ...draft, sortOrder: event.target.valueAsNumber })}
                      />
                    </label>
                    {locales.map((locale) => (
                      <label key={locale.code} className="flex flex-col gap-1.5 text-sm text-zinc-400">
                        Name ({locale.label})
                        <input
                          className={inputClass}
                          value={draft.names[locale.code] ?? ""}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              names: { ...draft.names, [locale.code]: event.target.value },
                            })
                          }
                        />
                      </label>
                    ))}
                    {isCategory && (
                      <>
                        <BlogSelect
                          label="Overview page"
                          value={draft.pagePath}
                          onChange={(pagePath) => setDraft({ ...draft, pagePath })}
                          emptyLabel="Choose a page"
                          options={(pagesQuery.data ?? [])
                            .filter((page) => page.path !== "/")
                            .map((page) => ({ value: page.path, label: page.path }))}
                          disabled={busy}
                        />
                        <BlogSelect
                          label="Default post layout"
                          value={draft.defaultLayout}
                          onChange={(defaultLayout) => setDraft({ ...draft, defaultLayout })}
                          emptyLabel="Choose a post layout"
                          options={(layoutsQuery.data ?? []).map((layout) => ({
                            value: layout.name,
                            label: layout.name,
                          }))}
                          disabled={busy}
                        />
                      </>
                    )}
                  </div>
                  {isCategory &&
                    (!pagesQuery.data?.some((page) => page.path !== "/") || !layoutsQuery.data?.length) && (
                      <p className="text-sm text-amber-300">
                        Create a non-root overview page and register a post layout before adding a category.
                      </p>
                    )}
                  {saveMutation.error && (
                    <p role="alert" className="text-sm text-red-400">
                      {blogErrorMessage(saveMutation.error)}
                    </p>
                  )}
                  <div className="flex gap-3">
                    <button
                      className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
                      disabled={busy || (isCategory && (!draft.pagePath || !draft.defaultLayout))}
                    >
                      {saveMutation.isPending ? "Saving…" : "Save"}
                    </button>
                    <button type="button" className="px-3 py-2 text-sm text-zinc-400" onClick={closeForm}>
                      Cancel
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            {deleteMutation.error && (
              <p role="alert" className="text-sm text-red-400">
                {blogErrorMessage(deleteMutation.error)}
              </p>
            )}
            <div className="overflow-x-auto rounded border border-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-400">
                  <tr>
                    <th className="px-4 py-3">Key</th>
                    <th className="px-4 py-3">Names</th>
                    {isCategory && (
                      <>
                        <th className="px-4 py-3">Overview page</th>
                        <th className="px-4 py-3">Default post layout</th>
                      </>
                    )}
                    <th className="px-4 py-3">Order</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {!recordsQuery.data?.length && (
                    <tr>
                      <td colSpan={isCategory ? 6 : 4} className="px-4 py-6 text-zinc-500">
                        No {kind} yet.
                      </td>
                    </tr>
                  )}
                  {recordsQuery.data?.map((record) => (
                    <tr key={record.key}>
                      <td className="px-4 py-3 font-medium">{record.key}</td>
                      <td className="px-4 py-3">
                        {Object.entries(record.names).map(([locale, name]) => (
                          <div key={locale}>
                            <span className="text-zinc-500">{locale.toUpperCase()}: </span>
                            {name}
                          </div>
                        ))}
                      </td>
                      {isCategory && (
                        <>
                          <td className="px-4 py-3">{(record as BlogCategory).pagePath}</td>
                          <td className="px-4 py-3">{(record as BlogCategory).defaultLayout}</td>
                        </>
                      )}
                      <td className="px-4 py-3 text-zinc-400">{record.sortOrder}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-3">
                          <button
                            className="text-cyan-300 disabled:opacity-40"
                            disabled={busy || formOpen}
                            onClick={() => edit(record)}
                            aria-label={`Edit ${record.key}`}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-400 disabled:opacity-40"
                            disabled={busy || formOpen}
                            aria-label={`Delete ${record.key}`}
                            onClick={() => {
                              if (window.confirm(`Delete ${singular} “${record.key}”?`))
                                deleteMutation.mutate(record.key);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
