import { useEffect, useRef, useState } from "react";
import { type BlogPostPreview, previewBlogPost } from "../../api/blog";
import type { BlogPostInput } from "../../api/types";
import { blogErrorMessage } from "../../lib/blog-error";

const DEBOUNCE_MS = 800;

/**
 * Live preview of the unsaved post, rendered by the admin with the real post layout.
 * The iframe gets the HTML via srcdoc and no script permission; "Open in new tab"
 * opens the same version at its token URL, which follows further edits on its own.
 */
export function BlogPostPreviewPane({ siteKey, postKey, locale, post }: {
  siteKey: string;
  postKey: string;
  locale: string;
  post: BlogPostInput;
}) {
  const [preview, setPreview] = useState<BlogPostPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const scrollY = useRef(0);
  const lastLocale = useRef<string | null>(null);
  const body = JSON.stringify(post);
  const hasTranslation = !!post.translations[locale];

  useEffect(() => {
    if (!hasTranslation) return;
    // The first render and a language switch go out at once; typing is debounced.
    const immediate = lastLocale.current !== locale;
    lastLocale.current = locale;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setRendering(true);
      try {
        const result = await previewBlogPost(siteKey, postKey, locale, JSON.parse(body) as BlogPostInput);
        if (cancelled) return;
        scrollY.current = frameRef.current?.contentWindow?.scrollY ?? 0;
        setPreview(result);
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        console.error("[blog-preview] render failed", caught);
        setError(blogErrorMessage(caught));
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, immediate ? 0 : DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteKey, postKey, locale, body, hasTranslation]);

  return (
    <aside aria-label="Live preview" className="flex min-h-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
        <p role="status" className="text-xs text-zinc-500">
          {!hasTranslation
            ? "Nothing to preview yet"
            : rendering
              ? "Rendering…"
              : error
                ? "Showing the last version that rendered"
                : preview
                  ? `${locale.toUpperCase()} · unsaved changes included`
                  : "Preparing preview…"}
        </p>
        <button
          type="button"
          disabled={!preview}
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-cyan-300 hover:border-cyan-700 disabled:opacity-40"
          onClick={() => preview && window.open(preview.url, "_blank", "noopener")}
        >
          Open in new tab
        </button>
      </div>
      {error && hasTranslation && (
        <p role="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}
      {!hasTranslation ? (
        <p className="p-6 text-sm text-zinc-400">
          Add a title and slug for {locale.toUpperCase()} to preview this language.
        </p>
      ) : preview ? (
        <iframe
          ref={frameRef}
          title="Post preview"
          sandbox="allow-same-origin"
          srcDoc={preview.html}
          onLoad={() => frameRef.current?.contentWindow?.scrollTo(0, scrollY.current)}
          className="min-h-0 flex-1 bg-white"
        />
      ) : null}
    </aside>
  );
}
