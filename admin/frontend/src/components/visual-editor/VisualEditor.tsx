import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ComponentType,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { VisualEditorContext, type FieldMeta } from "./VisualEditorContext";
import { EditPopover } from "./EditPopover";
import type { LayoutProps } from "./agenticms-shims";
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
  contentMap,
  keyTypes,
  locale,
  onContentChange,
  onFieldClick,
}: {
  LayoutComponent: ComponentType<LayoutProps>;
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
      if (type === "richtext") continue;
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
  }, [contentMap, keyTypes, onFieldClick]);

  return (
    <VisualEditorContext.Provider
      value={{ contentMap, keyTypes, onContentChange, onFieldClick }}
    >
      <div ref={containerRef}>
        <LayoutComponent
          content={contentMap}
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
  layout: Layout;
  contentEntries: Content[];
  detectedKeys: Record<string, LayoutKey>;
  locale: string;
  onContentChange: (key: string, value: string) => void;
}

export function VisualEditor({
  siteKey,
  layout,
  contentEntries,
  detectedKeys,
  locale,
  onContentChange,
}: VisualEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const rootRef = useRef<Root | null>(null);
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
      if (entry.locale === locale) {
        map[entry.key] = entry.value;
      }
    }
    for (const [key, value] of Object.entries(pendingEdits)) {
      map[key] = value;
    }
    return map;
  }, [detectedKeys, contentEntries, locale, pendingEdits]);

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
      setPendingEdits((prev) => ({ ...prev, [key]: value }));
      onContentChange(key, value);
      setEditingField(null);
    },
    [onContentChange]
  );

  const iframeCallbackRef = useCallback((node: HTMLIFrameElement | null) => {
    if (!node) {
      rootRef.current?.unmount();
      rootRef.current = null;
      iframeRef.current = null;
      setIframeReady(false);
      return;
    }

    if (iframeRef.current !== node) {
      rootRef.current?.unmount();
      rootRef.current = null;
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
  }, []);

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

    rootRef.current.render(
      <IframeRenderer
        LayoutComponent={LayoutComponent}
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
    contentMap,
    keyTypes,
    locale,
    handleFieldClick,
    onContentChange,
  ]);

  useEffect(() => {
    return () => {
      rootRef.current?.unmount();
      rootRef.current = null;
    };
  }, []);

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
    <div className="flex-1 overflow-hidden relative bg-neutral-950">
      {isStalePreview && (
        <div className="absolute left-3 top-3 z-10 rounded border border-amber-500/40 bg-amber-950/90 px-3 py-1 text-xs text-amber-100 shadow">
          Preview from last working layout version
        </div>
      )}

      <iframe
        ref={iframeCallbackRef}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
      />

      {editingField && (() => {
        const elRect = editingField.element.getBoundingClientRect();
        const iframeRect = iframeRef.current?.getBoundingClientRect();
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
