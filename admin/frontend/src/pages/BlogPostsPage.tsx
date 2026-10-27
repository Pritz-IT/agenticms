import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createBlogPost,
  fetchBlogCategories,
  fetchBlogPosts,
  fetchBlogTags,
  type BlogPostFilters,
} from "../api/blog";
import { fetchLocales } from "../api/locales";
import { TopBar } from "../components/TopBar";
import { BlogSelect } from "../components/blog/BlogSelect";
import { blogErrorMessage, showBlogError } from "../lib/blog-error";
import { DEFAULT_SITE_KEY, siteSectionPath } from "../site-routing";

export function BlogPostsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  return <BlogPosts key={siteKey} siteKey={siteKey} />;
}

function BlogPosts({ siteKey }: { siteKey: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<BlogPostFilters>({});
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const postsQuery = useQuery({
    queryKey: ["blog", siteKey, "posts", filters],
    queryFn: () => fetchBlogPosts(siteKey, filters),
  });
  const categoriesQuery = useQuery({
    queryKey: ["blog", siteKey, "categories"],
    queryFn: () => fetchBlogCategories(siteKey),
  });
  const tagsQuery = useQuery({ queryKey: ["blog", siteKey, "tags"], queryFn: () => fetchBlogTags(siteKey) });
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const locales = localesQuery.data ?? [];
  const defaultLocale = locales.find((locale) => locale.isDefault)?.code ?? locales[0]?.code ?? "";
  const categories = categoriesQuery.data ?? [];
  const tags = tagsQuery.data ?? [];
  const categoryOptions = categories.map((category) => ({
    value: category.key,
    label: category.names[defaultLocale] || category.key,
  }));
  const createMutation = useMutation({
    mutationFn: () =>
      createBlogPost(siteKey, {
        key: newKey,
        category: newCategory,
        tags: [],
        layout: null,
        translations: {},
      }),
    onSuccess: (post) => {
      qc.invalidateQueries({ queryKey: ["blog", siteKey, "posts"] });
      toast.success("Post created");
      navigate(siteSectionPath(siteKey, `blogs/${encodeURIComponent(post.key)}`));
    },
    onError: (error) => showBlogError("create post", error),
  });
  const queries = [postsQuery, categoriesQuery, tagsQuery, localesQuery];
  const error = queries.find((query) => query.error)?.error;
  const loading = queries.some((query) => query.isLoading);

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Blogs" />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-52">
            <BlogSelect
              label="Category"
              value={filters.category ?? ""}
              onChange={(category) => setFilters({ ...filters, category })}
              options={categoryOptions}
              emptyLabel="All categories"
            />
          </div>
          <div className="w-52">
            <BlogSelect
              label="Tag"
              value={filters.tag ?? ""}
              onChange={(tag) => setFilters({ ...filters, tag })}
              options={tags.map((tag) => ({ value: tag.key, label: tag.names[defaultLocale] || tag.key }))}
              emptyLabel="All tags"
            />
          </div>
          <div className="w-44">
            <BlogSelect
              label="Status"
              value={filters.status ?? ""}
              onChange={(status) =>
                setFilters({ ...filters, status: status ? (status as "draft" | "published") : undefined })
              }
              options={[
                { value: "draft", label: "Draft" },
                { value: "published", label: "Published" },
              ]}
              emptyLabel="All statuses"
            />
          </div>
          <button
            className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
            disabled={loading || !!error || creating || !categories.length}
            onClick={() => setCreating(true)}
          >
            New post
          </button>
        </div>
        {!loading && !error && !categories.length && (
          <p className="text-sm text-zinc-400">
            A blog category is required. An administrator can create one under Blog categories.
          </p>
        )}
        {creating && (
          <form
            className="max-w-2xl rounded border border-zinc-800 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              createMutation.mutate();
            }}
          >
            <fieldset disabled={createMutation.isPending} className="flex flex-col gap-4">
              <h2 className="font-semibold">New post</h2>
              <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                Post key
                <input
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Lowercase letters, digits and single hyphens"
                  className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 focus:border-cyan-500 focus:outline-none"
                  value={newKey}
                  onChange={(event) => setNewKey(event.target.value)}
                  aria-describedby="post-key-hint"
                />
              </label>
              <p id="post-key-hint" className="text-xs text-zinc-500">
                The key cannot change after creation. Each translation has its own editable URL slug.
              </p>
              <BlogSelect
                label="Post category"
                value={newCategory}
                onChange={setNewCategory}
                options={categoryOptions}
                emptyLabel="Choose a category"
                disabled={createMutation.isPending}
              />
              {createMutation.error && (
                <p role="alert" className="text-sm text-red-400">
                  {blogErrorMessage(createMutation.error)}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
                  disabled={!newCategory || createMutation.isPending}
                >
                  {createMutation.isPending ? "Creating…" : "Create post"}
                </button>
                <button
                  type="button"
                  className="text-sm text-zinc-400"
                  onClick={() => {
                    setCreating(false);
                    createMutation.reset();
                  }}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {loading ? (
          <p className="text-zinc-400">Loading…</p>
        ) : error ? (
          <p role="alert" className="text-red-400">
            {blogErrorMessage(error)}
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-xs uppercase tracking-wider text-zinc-400">
                <tr>
                  {["Title", "Category", "Tags", "Translations", "Published", "Updated"].map((heading) => (
                    <th key={heading} className="px-4 py-3">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {!postsQuery.data?.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-zinc-500">
                      {Object.values(filters).some(Boolean)
                        ? "No posts match these filters."
                        : "No posts yet."}
                    </td>
                  </tr>
                )}
                {postsQuery.data?.map((post) => (
                  <tr key={post.key} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">
                      <Link
                        className="font-medium text-cyan-300 hover:underline"
                        to={siteSectionPath(siteKey, `blogs/${encodeURIComponent(post.key)}`)}
                      >
                        {post.translations[defaultLocale]?.title || post.key}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {categories.find((category) => category.key === post.category)?.names[defaultLocale] ||
                        post.category}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {post.tags
                        .map((key) => tags.find((tag) => tag.key === key)?.names[defaultLocale] || key)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {locales.map((locale) => {
                          const status = post.translations[locale.code]?.status;
                          return (
                            <span
                              key={locale.code}
                              className={`whitespace-nowrap rounded border px-2 py-0.5 text-xs ${status === "published" ? "border-emerald-800 bg-emerald-950 text-emerald-300" : status === "draft" ? "border-amber-800 bg-amber-950 text-amber-300" : "border-zinc-700 text-zinc-500"}`}
                            >
                              {locale.code.toUpperCase()}: {status ?? "Missing"}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-400">{post.publishedAt ?? "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-400">
                      {new Date(post.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
