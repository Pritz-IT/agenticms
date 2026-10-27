import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchBlogCategories,
  fetchBlogPost,
  fetchBlogTags,
  updateBlogPost,
  deleteBlogPost,
  publishBlogTranslation,
  unpublishBlogTranslation,
} from "../api/blog";
import { fetchLayouts } from "../api/layouts";
import { fetchLocales } from "../api/locales";
import { fetchSites } from "../api/sites";
import type {
  BlogCategory,
  BlogPost,
  BlogTag,
  BlogTranslationInput,
  Layout,
  Locale,
  Settings,
} from "../api/types";
import { TopBar } from "../components/TopBar";
import { LocaleTabs } from "../components/LocaleTabs";
import { RichTextEditor } from "../components/RichTextEditor";
import { BlogSelect } from "../components/blog/BlogSelect";
import { blogErrorMessage, showBlogError } from "../lib/blog-error";
import { emptyTranslation, postDraft, stagingPostUrl, updateTranslationTitle } from "../lib/blog-editor";
import { DEFAULT_SITE_KEY, siteSectionPath } from "../site-routing";

const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-cyan-500 focus:outline-none";

export function BlogPostEditorPage() {
  const { siteKey = DEFAULT_SITE_KEY, postKey = "" } = useParams();
  const postQuery = useQuery({
    queryKey: ["blog", siteKey, "posts", postKey],
    queryFn: () => fetchBlogPost(siteKey, postKey),
  });
  const categoriesQuery = useQuery({
    queryKey: ["blog", siteKey, "categories"],
    queryFn: () => fetchBlogCategories(siteKey),
  });
  const tagsQuery = useQuery({ queryKey: ["blog", siteKey, "tags"], queryFn: () => fetchBlogTags(siteKey) });
  const layoutsQuery = useQuery({
    queryKey: ["layouts", siteKey, "post"],
    queryFn: () => fetchLayouts(siteKey, "post"),
  });
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const sitesQuery = useQuery({ queryKey: ["sites"], queryFn: fetchSites });
  const settings = sitesQuery.data?.find((site) => site.key === siteKey);
  const queries = [postQuery, categoriesQuery, tagsQuery, layoutsQuery, localesQuery, sitesQuery];
  const error =
    queries.find((query) => query.error)?.error ??
    (sitesQuery.isSuccess && !settings ? new Error("Site not found") : null);

  if (
    !postQuery.data ||
    !categoriesQuery.data ||
    !tagsQuery.data ||
    !layoutsQuery.data ||
    !localesQuery.data ||
    !settings
  ) {
    return (
      <div className="flex h-full flex-col">
        <TopBar title="Post editor" />
        <p role={error ? "alert" : "status"} className={`p-6 ${error ? "text-red-400" : "text-zinc-400"}`}>
          {error ? blogErrorMessage(error) : "Loading…"}
        </p>
      </div>
    );
  }
  return (
    <PostEditor
      key={`${siteKey}/${postKey}`}
      siteKey={siteKey}
      post={postQuery.data}
      categories={categoriesQuery.data}
      tags={tagsQuery.data}
      layouts={layoutsQuery.data}
      locales={localesQuery.data}
      settings={settings}
    />
  );
}

function PostEditor({
  siteKey,
  post,
  categories,
  tags,
  layouts,
  locales,
  settings,
}: {
  siteKey: string;
  post: BlogPost;
  categories: BlogCategory[];
  tags: BlogTag[];
  layouts: Layout[];
  locales: Locale[];
  settings: Settings;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(post);
  const [draft, setDraft] = useState(() => postDraft(post));
  const [selectedLocale, setSelectedLocale] = useState(settings.defaultLocale);
  const [slugEdited, setSlugEdited] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(Object.keys(post.translations).map((locale) => [locale, true]))
  );
  const translation = draft.translations[selectedLocale] ?? emptyTranslation();
  const savedTranslation = saved.translations[selectedLocale];
  const dirty = JSON.stringify(draft) !== JSON.stringify(postDraft(saved));

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function acceptSaved(result: BlogPost) {
    setSaved(result);
    setDraft(postDraft(result));
    qc.setQueryData(["blog", siteKey, "posts", post.key], result);
    qc.invalidateQueries({ queryKey: ["blog", siteKey, "posts"] });
  }

  const saveMutation = useMutation({
    mutationFn: () => updateBlogPost(siteKey, post.key, draft),
    onSuccess: (result) => {
      acceptSaved(result);
      toast.success("Post saved");
    },
    onError: (error) => showBlogError("save post", error),
  });
  const statusMutation = useMutation({
    mutationFn: ({ locale, published }: { locale: string; published: boolean }) =>
      published
        ? unpublishBlogTranslation(siteKey, post.key, locale)
        : publishBlogTranslation(siteKey, post.key, locale),
    onSuccess: (result, { published }) => {
      acceptSaved(result);
      toast.success(published ? "Translation unpublished" : "Translation published");
    },
    onError: (error) => showBlogError("change publication status", error),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteBlogPost(siteKey, post.key),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["blog", siteKey, "posts", post.key], exact: true });
      qc.invalidateQueries({ queryKey: ["blog", siteKey, "posts"] });
      toast.success("Post deleted");
      navigate(siteSectionPath(siteKey, "blogs"));
    },
    onError: (error) => showBlogError("delete post", error),
  });
  const busy = saveMutation.isPending || statusMutation.isPending || deleteMutation.isPending;
  const error = saveMutation.error ?? statusMutation.error ?? deleteMutation.error;
  const savedCategory = categories.find((category) => category.key === saved.category);
  const categoryDefaultLayout = categories.find((category) => category.key === draft.category)?.defaultLayout;
  const previewUrl =
    settings.stagingDomain && savedCategory && savedTranslation
      ? stagingPostUrl(
          settings.stagingDomain,
          savedCategory.pagePath,
          selectedLocale,
          settings.defaultLocale,
          savedTranslation.slug
        )
      : null;
  const coverPreview =
    settings.stagingDomain && /^\/(assets|media)\//.test(translation.coverImage ?? "")
      ? `https://${settings.stagingDomain}${translation.coverImage}`
      : null;

  function changeTranslation(fields: Partial<BlogTranslationInput>) {
    setDraft((current) => ({
      ...current,
      translations: {
        ...current.translations,
        [selectedLocale]: { ...(current.translations[selectedLocale] ?? emptyTranslation()), ...fields },
      },
    }));
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar title={saved.translations[settings.defaultLocale]?.title || post.key} subtitle="Post editor" />
      <form
        className="flex flex-1 flex-col gap-6 overflow-auto p-6"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) saveMutation.mutate();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            className="text-sm text-cyan-300 hover:underline"
            to={siteSectionPath(siteKey, "blogs")}
            onClick={(event) => {
              if (dirty && !window.confirm("Discard unsaved changes?")) event.preventDefault();
            }}
          >
            Back to blogs
          </Link>
          <div className="flex items-center gap-3">
            <span role="status" className="text-xs text-zinc-500">
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
            <button
              type="submit"
              className="rounded bg-cyan-400 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-40"
              disabled={busy || !dirty}
            >
              {saveMutation.isPending ? "Saving…" : "Save post"}
            </button>
            <button
              type="button"
              className="px-2 py-2 text-sm text-red-400 disabled:opacity-40"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete post “${post.key}” and all its translations?`))
                  deleteMutation.mutate();
              }}
            >
              Delete post
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {blogErrorMessage(error)}
          </p>
        )}
        <fieldset disabled={busy} className="grid max-w-5xl gap-4 sm:grid-cols-2 disabled:opacity-60">
          <legend className="mb-4 text-lg font-semibold">Shared fields</legend>
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            Post key
            <input className={inputClass} value={post.key} readOnly />
          </label>
          <BlogSelect
            label="Category"
            value={draft.category}
            onChange={(category) => setDraft({ ...draft, category })}
            options={categories.map((category) => ({
              value: category.key,
              label: category.names[settings.defaultLocale] || category.key,
            }))}
            emptyLabel="Choose a category"
            disabled={busy}
          />
          <BlogSelect
            label="Layout override"
            value={draft.layout ?? ""}
            onChange={(layout) => setDraft({ ...draft, layout: layout || null })}
            options={layouts.map((layout) => ({ value: layout.name, label: layout.name }))}
            emptyLabel={`Category default${categoryDefaultLayout ? ` (${categoryDefaultLayout})` : ""}`}
            disabled={busy}
          />
          <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
            Published date
            <input
              className={inputClass}
              type="date"
              value={draft.publishedAt ?? ""}
              onChange={(event) => setDraft({ ...draft, publishedAt: event.target.value || null })}
            />
            <span className="text-xs text-zinc-500">
              Set automatically on first publish if empty. This date does not schedule publication.
            </span>
          </label>
          <fieldset className="sm:col-span-2">
            <legend className="mb-2 text-sm text-zinc-400">Tags</legend>
            <div className="flex flex-wrap gap-4">
              {tags.length ? (
                tags.map((tag) => (
                  <label key={tag.key} className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={draft.tags.includes(tag.key)}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          tags: event.target.checked
                            ? [...draft.tags, tag.key]
                            : draft.tags.filter((key) => key !== tag.key),
                        })
                      }
                    />
                    {tag.names[settings.defaultLocale] || tag.key}
                  </label>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No tags configured.</p>
              )}
            </div>
          </fieldset>
        </fieldset>
        {locales.length === 0 ? (
          <p className="text-zinc-400">Configure a language before adding a translation.</p>
        ) : (
          <fieldset disabled={busy} className="flex max-w-5xl flex-col gap-4 disabled:opacity-60">
            <legend className="mb-4 text-lg font-semibold">Translations</legend>
            <div className="overflow-x-auto">
              <LocaleTabs
                siteKey={siteKey}
                selectedLocale={selectedLocale}
                onSelectLocale={setSelectedLocale}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-zinc-400">
                {selectedLocale.toUpperCase()}: {savedTranslation?.status ?? "Not saved"}
              </span>
              <button
                type="button"
                disabled={busy || dirty || !savedTranslation}
                className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-cyan-300 disabled:opacity-40"
                onClick={() =>
                  statusMutation.mutate({
                    locale: selectedLocale,
                    published: savedTranslation?.status === "published",
                  })
                }
              >
                {savedTranslation?.status === "published" ? "Unpublish" : "Publish"}
              </button>
              {previewUrl && (
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-cyan-300 hover:underline"
                >
                  Preview on staging
                </a>
              )}
            </div>
            {(dirty || !savedTranslation) && (
              <p className="text-xs text-zinc-500">
                Save the post before changing publication status. Staging previews reflect the latest staging
                build.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                Title
                <input
                  className={inputClass}
                  required={!!draft.translations[selectedLocale]}
                  value={translation.title}
                  onChange={(event) =>
                    changeTranslation(
                      updateTranslationTitle(translation, event.target.value, !!slugEdited[selectedLocale])
                    )
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
                Slug
                <input
                  className={inputClass}
                  required={!!draft.translations[selectedLocale]}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  title="Lowercase letters, digits and single hyphens"
                  value={translation.slug}
                  onChange={(event) => {
                    setSlugEdited({ ...slugEdited, [selectedLocale]: true });
                    changeTranslation({ slug: event.target.value });
                  }}
                />
              </label>
            </div>
            {savedTranslation?.status === "published" && savedTranslation.slug !== translation.slug && (
              <p
                role="alert"
                className="rounded border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-300"
              >
                Changing the slug of this published translation means the old URL will stop working.
              </p>
            )}
            <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
              Excerpt
              <textarea
                className={inputClass}
                rows={3}
                value={translation.excerpt}
                onChange={(event) => changeTranslation({ excerpt: event.target.value })}
              />
            </label>
            <div
              role="group"
              aria-labelledby="blog-body-label"
              ref={(element) => {
                if (element) element.inert = busy;
              }}
            >
              <p id="blog-body-label" className="mb-1.5 text-sm text-zinc-400">
                Body
              </p>
              <RichTextEditor
                key={selectedLocale}
                value={translation.body}
                onChange={(body) => changeTranslation({ body })}
              />
            </div>
            {/* Task 17 replaces this path field with the post-media upload/asset picker. */}
            <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
              Cover image
              <input
                className={inputClass}
                placeholder="/assets/… or /media/…"
                pattern="/(assets|media)/.*"
                value={translation.coverImage ?? ""}
                onChange={(event) => changeTranslation({ coverImage: event.target.value || null })}
              />
            </label>
            {coverPreview && (
              <figure>
                <img
                  src={coverPreview}
                  alt="Cover preview"
                  className="max-h-52 max-w-full rounded object-contain"
                />
                <figcaption className="mt-1 text-xs text-zinc-500">
                  Preview from the latest staging build.
                </figcaption>
              </figure>
            )}
            <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
              Meta title
              <input
                className={inputClass}
                value={translation.metaTitle}
                onChange={(event) => changeTranslation({ metaTitle: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm text-zinc-400">
              Meta description
              <textarea
                className={inputClass}
                rows={3}
                value={translation.metaDescription}
                onChange={(event) => changeTranslation({ metaDescription: event.target.value })}
              />
            </label>
          </fieldset>
        )}
      </form>
    </div>
  );
}
