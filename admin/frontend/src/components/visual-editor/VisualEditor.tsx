import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ComponentType,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { VisualEditorContext, type FieldMeta } from "./VisualEditorContext";
import { EditPopover } from "./EditPopover";
import { fetchPageBlogLists } from "../../api/blog";
import { fetchMediaObjectUrl } from "../../lib/media-url";
import { resolveBlogPreviewCovers } from "../../lib/blog-preview-covers";
import { blogErrorMessage, showBlogError } from "../../lib/blog-error";
import type { BlogList, LayoutProps } from "./agenticms-shims";
import { apiRaw } from "../../api/client";
import type { Layout, Content, LayoutKey, LayoutKeyType } from "../../api/types";

const EDITOR_CSS = `
  body { margin: 0; padding: 0; }
  .sf-ve-editable {
    transition: outline 150ms ease, outline-offset 150ms ease;
    outline: 2px solid transparent;
    outline-offset: 2px;
    position: relative;
  }
  .sf-ve-editable:hover {
    outline: 2px solid oklch(70% 0.15 200 / 0.7);
    outline-offset: 4px;
    border-radius: 4px;
    cursor: pointer;
  }
  .sf-ve-editable:hover::after {
    content: attr(data-sf-key);
    position: absolute;
    top: -22px;
    left: 0;
    font-size: 10px;
    font-family: ui-monospace, monospace;
    color: oklch(90% 0.05 200);
    background: oklch(20% 0.02 240);
    border: 1px solid oklch(35% 0.04 220);
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
    z-index: 100;
    pointer-events: none;
  }
`;

// Rendered inside the iframe React root so its useEffect fires
// after the layout DOM has been committed — correct timing guaranteed.
function IframeRenderer({
  LayoutComponent,
  blogLists,
  onPreviewPageChange,
  contentMap,
  keyTypes,
  locale,
  onContentChange,
  onFieldClick,
}: {
  LayoutComponent: ComponentType<LayoutProps>;
  blogLists: Record<string, BlogList>;
  onPreviewPageChange: (page: number) => void;
  contentMap: Record<string, string>;
  keyTypes: Record<string, LayoutKeyType>;
  locale: string;
  onContentChange: (key: string, value: string) => void;
  onFieldClick: (meta: FieldMeta, element: HTMLElement) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const doc = container.ownerDocument;
    const matched = new Set<string>();
    const annotations: { el: HTMLElement; key: string }[] = [];

    const textKeys = new Map<string, string>();
    const urlKeys = new Map<string, string>();
    const linkKeys = new Map<string, string>();

    for (const [key, value] of Object.entries(contentMap)) {
      if (key.startsWith("_meta.") || !value) continue;
      const type = keyTypes[key];
      if (type === "richtext" || type === "bloglist") continue;
      if (type === "link") {
        linkKeys.set(value, key);
      } else if (value.startsWith("/") || value.startsWith("http")) {
        urlKeys.set(value, key);
      } else {
        textKeys.set(value, key);
      }
    }

    // Pass 1: exact text node match
    if (textKeys.size > 0) {
      const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (!text) continue;
        const parent = (node as Text).parentElement;
        if (!parent || parent.dataset.sfKey) continue;
        const key = textKeys.get(text);
        if (key && !matched.has(key)) {
          annotations.push({ el: parent, key });
          matched.add(key);
        }
      }
    }

    // Pass 2: parent textContent match for split/concatenated text (e.g. splitSentences)
    // Note: cannot use `instanceof HTMLElement` — elements are in the iframe's
    // DOM, whose HTMLElement prototype differs from the parent window's.
    for (const [value, key] of textKeys) {
      if (matched.has(key)) continue;
      const stripped = value.replace(/\s+/g, "");
      const elements = container.querySelectorAll("*");
      for (const rawEl of elements) {
        const el = rawEl as HTMLElement;
        if (el.dataset.sfKey) continue;
        const elStripped = (el.textContent ?? "").replace(/\s+/g, "");
        if (elStripped === stripped && el.querySelectorAll("*").length < 10) {
          annotations.push({ el, key });
          matched.add(key);
          break;
        }
      }
    }

    // Pass 3: <img src> and inline background-image match for URL values
    for (const [value, key] of urlKeys) {
      if (matched.has(key)) continue;
      const imgs = container.querySelectorAll("img");
      let found = false;
      for (const img of imgs) {
        if (img.getAttribute("src") === value && !(img as HTMLElement).dataset.sfKey) {
          annotations.push({ el: img as HTMLElement, key });
          matched.add(key);
          found = true;
          break;
        }
      }
      if (found) continue;
      const allEls = container.querySelectorAll("*");
      for (const rawEl of allEls) {
        const el = rawEl as HTMLElement;
        if (el.dataset.sfKey) continue;
        if (el.style.backgroundImage?.includes(value)) {
          annotations.push({ el, key });
          matched.add(key);
          break;
        }
      }
    }

    // Pass 4: <a href> match for link fields
    for (const [value, key] of linkKeys) {
      if (matched.has(key)) continue;
      const anchors = container.querySelectorAll("a");
      for (const a of anchors) {
        if (a.getAttribute("href") === value && !(a as HTMLElement).dataset.sfKey) {
          annotations.push({ el: a as HTMLElement, key });
          matched.add(key);
          break;
        }
      }
    }

    // Pass 5: substring text match (e.g. "footer.tagline" inside "© 2026 Company. {tagline}")
    if (textKeys.size > 0) {
      for (const [value, key] of textKeys) {
        if (matched.has(key) || value.length < 4) continue;
        const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = node.textContent ?? "";
          if (!text.includes(value)) continue;
          const parent = (node as Text).parentElement;
          if (!parent || parent.dataset.sfKey) continue;
          annotations.push({ el: parent, key });
          matched.add(key);
          break;
        }
      }
    }

    for (const { el, key } of annotations) {
      if (el.dataset.sfKey) continue;
      el.dataset.sfKey = key;
      el.classList.add("sf-ve-editable");
    }

    const preTagged = container.querySelectorAll("[data-sf-key]");
    for (const el of preTagged) {
      const k = (el as HTMLElement).dataset.sfKey;
      if (k && keyTypes[k] && !el.classList.contains("sf-ve-editable")) {
        el.classList.add("sf-ve-editable");
      }
    }

    const handleClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest("[data-sf-key]") as HTMLElement | null;
      if (!target) return;
      const key = target.dataset.sfKey;
      if (!key || !keyTypes[key]) return;
      const relatedKeys = (target.dataset.sfRelatedKeys ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value && value !== key && keyTypes[value]);
      e.stopPropagation();
      e.preventDefault();
      onFieldClick({ key, type: keyTypes[key], relatedKeys }, target);
    };

    container.addEventListener("click", handleClick);

    return () => {
      container.removeEventListener("click", handleClick);
      for (const { el } of annotations) {
        delete el.dataset.sfKey;
        el.classList.remove("sf-ve-editable");
      }
    };
  }, [contentMap, keyTypes, onFieldClick, blogLists]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const base = container.ownerDocument.baseURI;
    const pages = Object.values(blogLists).flatMap((list) => list.pagination?.pages ?? []);
    const handlePagination = (event: MouseEvent) => {
      const link = (event.target as Element).closest("a[href]");
      if (!link) return;
      const href = new URL(link.getAttribute("href")!, base).href;
      const page = pages.find((entry) => new URL(entry.url, base).href === href);
      if (!page) return;
      event.preventDefault();
      event.stopPropagation();
      onPreviewPageChange(page.number);
    };
    // Capture before field-edit handlers, including wrappers around the whole list.
    container.addEventListener("click", handlePagination, true);
    return () => container.removeEventListener("click", handlePagination, true);
  }, [blogLists, onPreviewPageChange]);

  return (
    <VisualEditorContext.Provider
      value={{ contentMap, keyTypes, onContentChange, onFieldClick }}
    >
      <div ref={containerRef}>
        <LayoutComponent
          content={contentMap}
          blogLists={blogLists}
          navigation={[]}
          locale={locale}
          locales={[]}
          settings={null}
        />
      </div>
    </VisualEditorContext.Provider>
  );
}

interface VisualEditorProps {
  siteKey: string;
  pageId: string;
  defaultLocale: string;
  layout: Layout;
  contentEntries: Content[];
  detectedKeys: Record<string, LayoutKey>;
  locale: string;
  onContentChange: (key: string, value: string) => void;
}

export function VisualEditor({
  siteKey,
  pageId,
  defaultLocale,
  layout,
  contentEntries,
  detectedKeys,
  locale,
  onContentChange,
}: VisualEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const rootRef = useRef<Root | null>(null);
  const unmountPreview = useCallback(() => {
    const root = rootRef.current;
    rootRef.current = null;
    // The iframe is a separate React root; dispose it after the parent commit.
    if (root) queueMicrotask(() => root.unmount());
  }, []);
  const [LayoutComponent, setLayoutComponent] =
    useState<ComponentType<LayoutProps> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStalePreview, setIsStalePreview] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [editingField, setEditingField] = useState<{
    meta: FieldMeta;
    element: HTMLElement;
  } | null>(null);
  const [, setScrollTick] = useState(0);
  const [pendingEdits, setPendingEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    let importedUrl: string | null = null;

    async function loadLayoutModule() {
      setLayoutComponent(null);
      setLoadError(null);
      setIsStalePreview(false);

      try {
        const response = await apiRaw(`/api/sites/${siteKey}/layouts/${layout.id}/module.js`, {
          credentials: "include",
          cache: "no-store",
        });

        if (!response.ok) {
          let detail = `${response.status} ${response.statusText}`;
          try {
            const body = await response.clone().json();
            if (Array.isArray(body.errors) && body.errors[0]?.text) {
              const loc = body.errors[0].location;
              detail = loc?.file && loc?.line
                ? `${body.errors[0].text} (${loc.file}:${loc.line}:${loc.column ?? 0})`
                : body.errors[0].text;
            } else if (body.error) {
              detail = body.error;
            }
          } catch {
            detail = await response.text();
          }
          throw new Error(detail);
        }

        const code = await response.text();
        objectUrl = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        importedUrl = objectUrl;
        const mod = await import(/* @vite-ignore */ objectUrl) as { default?: ComponentType<LayoutProps> };
        if (!mod.default) throw new Error("Layout module did not export a default component");

        if (!cancelled) {
          setIsStalePreview(response.headers.get("X-SF-Stale") === "1");
          setLayoutComponent(() => mod.default as ComponentType<LayoutProps>);
        }
      } catch (err) {
        console.error("Failed to load layout preview", err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    }

    void loadLayoutModule();

    return () => {
      cancelled = true;
      if (objectUrl && objectUrl !== importedUrl) URL.revokeObjectURL(objectUrl);
      if (importedUrl) URL.revokeObjectURL(importedUrl);
    };
  }, [layout.id, siteKey]);

  const savedFilters = JSON.stringify(Object.entries(detectedKeys)
    .filter(([, definition]) => definition.type === "bloglist")
    .map(([key, definition]) => [key, contentEntries.find((entry) => entry.key === key && entry.locale === defaultLocale)?.value ?? definition.initial ?? ""]));
  const previewScope = JSON.stringify([siteKey, pageId, locale, savedFilters]);
  const [paging, setPaging] = useState({ scope: previewScope, page: 1 });
  const previewPage = paging.scope === previewScope ? paging.page : 1;
  const [blogLists, setBlogLists] = useState<Record<string, BlogList>>({});
  const previewRequest = JSON.stringify([previewScope, previewPage]);
  const [loadedPreview, setLoadedPreview] = useState("");
  const [blogListsError, setBlogListsError] = useState<string | null>(null);
  const [blogListsLoading, setBlogListsLoading] = useState(false);
  const handlePreviewPageChange = useCallback((page: number) => {
    setPaging({ scope: previewScope, page });
    setEditingField(null);
  }, [previewScope]);

  useEffect(() => {
    let disposed = false;
    const objectUrls: string[] = [];
    setBlogLists({});
    setBlogListsError(null);
    if (savedFilters === "[]") {
      setBlogListsLoading(false);
      return;
    }
    setBlogListsLoading(true);

    async function loadBlogLists() {
      try {
        const lists = await fetchPageBlogLists(siteKey, pageId, locale, previewPage);
        if (disposed) return;
        const resolved = await resolveBlogPreviewCovers(lists, async (src) => {
          const url = await fetchMediaObjectUrl(siteKey, src);
          // Track each completion so cleanup does not wait for slower covers.
          if (disposed) URL.revokeObjectURL(url);
          else objectUrls.push(url);
          return url;
        });
        if (disposed) return;
        for (const { error } of resolved.failures) console.error("[blog] preview cover failed", error);
        if (resolved.failures.length) {
          toast.error("Some blog preview covers could not be loaded");
        }
        setBlogLists(resolved.lists);
        setLoadedPreview(previewRequest);
      } catch (error) {
        objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
        if (!disposed) {
          showBlogError("load blog preview", error);
          setBlogListsError(blogErrorMessage(error));
        }
      } finally {
        if (!disposed) setBlogListsLoading(false);
      }
    }
    void loadBlogLists();
    return () => {
      disposed = true;
      objectUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [siteKey, pageId, locale, previewPage, savedFilters, previewRequest]);

  useEffect(() => {
    setPendingEdits({});
    setEditingField(null);
  }, [siteKey, pageId, locale]);

  // Clear pending edits once the API data catches up
  useEffect(() => {
    setPendingEdits((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const entry of contentEntries) {
        if (entry.locale === locale && next[entry.key] === entry.value) {
          delete next[entry.key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [contentEntries, locale]);

  const contentMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [key, def] of Object.entries(detectedKeys)) {
      map[key] = def.initial ?? "";
    }
    for (const entry of contentEntries) {
      if (entry.locale === (entry.type === "bloglist" ? defaultLocale : locale)) {
        map[entry.key] = entry.value;
      }
    }
    for (const [key, value] of Object.entries(pendingEdits)) {
      map[key] = value;
    }
    return map;
  }, [detectedKeys, contentEntries, locale, defaultLocale, pendingEdits]);

  const keyTypes = useMemo(() => {
    const map: Record<string, LayoutKeyType> = {};
    for (const [key, def] of Object.entries(detectedKeys)) {
      map[key] = def.type as LayoutKeyType;
    }
    return map;
  }, [detectedKeys]);

  const handleFieldClick = useCallback(
    (meta: FieldMeta, element: HTMLElement) => {
      setEditingField({ meta, element });
    },
    []
  );

  // Re-render on iframe scroll so the popover tracks the element
  useEffect(() => {
    if (!editingField || !iframeReady) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const onScroll = () => setScrollTick((t) => t + 1);
    doc.addEventListener("scroll", onScroll, true);
    return () => doc.removeEventListener("scroll", onScroll, true);
  }, [editingField, iframeReady]);

  const handleSave = useCallback(
    (key: string, value: string) => {
      if (keyTypes[key] !== "bloglist") setPendingEdits((prev) => ({ ...prev, [key]: value }));
      onContentChange(key, value);
      setEditingField(null);
    },
    [onContentChange, keyTypes]
  );

  const iframeCallbackRef = useCallback((node: HTMLIFrameElement | null) => {
    if (!node) {
      unmountPreview();
      iframeRef.current = null;
      setIframeReady(false);
      return;
    }

    if (iframeRef.current !== node) {
      unmountPreview();
      setIframeReady(false);
    }

    iframeRef.current = node;
    const doc = node.contentDocument ?? node.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write("<!DOCTYPE html><html><head></head><body></body></html>");
    doc.close();
    const base = doc.createElement("base");
    base.href = window.location.origin + "/";
    doc.head.appendChild(base);
    const style = doc.createElement("style");
    style.textContent = EDITOR_CSS;
    doc.head.appendChild(style);
    setIframeReady(true);
  }, [unmountPreview]);

  useEffect(() => {
    if (!iframeReady || !LayoutComponent) return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;

    if (!rootRef.current) {
      let container = doc.getElementById("sf-preview-root");
      if (!container) {
        container = doc.createElement("div");
        container.id = "sf-preview-root";
        doc.body.appendChild(container);
      }
      rootRef.current = createRoot(container);
    }

    if (savedFilters !== "[]" && loadedPreview !== previewRequest) {
      rootRef.current.render(null);
      return;
    }

    rootRef.current.render(
      <IframeRenderer
        LayoutComponent={LayoutComponent}
        blogLists={blogLists}
        onPreviewPageChange={handlePreviewPageChange}
        contentMap={contentMap}
        keyTypes={keyTypes}
        locale={locale}
        onContentChange={onContentChange}
        onFieldClick={handleFieldClick}
      />
    );
  }, [
    iframeReady,
    LayoutComponent,
    blogLists,
    handlePreviewPageChange,
    savedFilters,
    loadedPreview,
    previewRequest,
    contentMap,
    keyTypes,
    locale,
    handleFieldClick,
    onContentChange,
  ]);

  useEffect(() => unmountPreview, [unmountPreview]);

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center text-red-400 text-sm p-8">
        <div className="text-center">
          <p className="font-medium">Failed to load layout preview</p>
          <p className="text-xs text-red-400/60 mt-1">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!LayoutComponent) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
        Loading layout preview...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-neutral-950">
      {Object.entries(keyTypes).some(([, type]) => type === "bloglist") && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-neutral-800 p-2 text-xs text-neutral-300">
          {Object.entries(keyTypes).filter(([, type]) => type === "bloglist").map(([key]) => (
            <button key={key} type="button" className="rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800"
              onClick={(event) => handleFieldClick({ key, type: "bloglist" }, event.currentTarget)}>Edit {key}</button>
          ))}
          {blogListsLoading && <span role="status">Loading posts…</span>}
          {blogListsError && <span role="alert" className="text-red-400">{blogListsError}</span>}
        </div>
      )}
      {isStalePreview && (
        <div className="absolute left-3 top-3 z-10 rounded border border-amber-500/40 bg-amber-950/90 px-3 py-1 text-xs text-amber-100 shadow">
          Preview from last working layout version
        </div>
      )}

      <iframe
        ref={iframeCallbackRef}
        title="Layout preview"
        style={{ width: "100%", flex: 1, minHeight: 0, border: "none", display: "block" }}
      />

      {editingField && (() => {
        const elRect = editingField.element.getBoundingClientRect();
        const iframeRect = editingField.element.ownerDocument === document
          ? { x: 0, y: 0 }
          : iframeRef.current?.getBoundingClientRect();
        if (!iframeRect) return null;
        // EditPopover lives outside the iframe's React tree, so the
        // VisualEditorContext.Provider that wraps IframeRenderer doesn't
        // reach it. Re-provide here with the same value so inline editors
        // (NavigationInlineEditor) can read keyTypes / contentMap and write
        // back through onContentChange.
        return (
          <VisualEditorContext.Provider
            value={{ contentMap, keyTypes, onContentChange, onFieldClick: handleFieldClick }}
          >
            <EditPopover
              siteKey={siteKey}
              fieldKey={editingField.meta.key}
              type={editingField.meta.type}
              value={contentMap[editingField.meta.key] ?? ""}
              relatedFields={(editingField.meta.relatedKeys ?? []).map((key) => ({
                key,
                type: keyTypes[key],
                value: contentMap[key] ?? "",
              }))}
              locale={locale}
              anchorRect={new DOMRect(
                elRect.x + iframeRect.x,
                elRect.y + iframeRect.y,
                elRect.width,
                elRect.height
              )}
              onSave={handleSave}
              onClose={() => setEditingField(null)}
            />
          </VisualEditorContext.Provider>
        );
      })()}
    </div>
  );
}
