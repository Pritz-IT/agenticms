import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { Eye, FormInput } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { LocaleTabs } from "../components/LocaleTabs";
import { ContentField } from "../components/ContentField";
import { VisualEditor } from "../components/visual-editor/VisualEditor";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { fetchPage, updatePage } from "../api/pages";
import {
  fetchContent,
  createContent,
  deleteContent,
  deleteOrphanedContent,
  resetAllContent,
} from "../api/content";
import { fetchLocales } from "../api/locales";
import { fetchLayouts } from "../api/layouts";
import type { Content, ContentType, LayoutKey } from "../api/types";
import { DEFAULT_SITE_KEY, siteSectionPath } from "../site-routing";

const NO_LAYOUT_VALUE = "__no_layout__";
type EditorTab = "fields" | "visual";

function isContentType(type: LayoutKey["type"]): type is ContentType {
  return type !== "navigation";
}

function isContentLayoutEntry(entry: [string, LayoutKey]): entry is [string, LayoutKey & { type: ContentType }] {
  const [key, def] = entry;
  return !key.startsWith("_meta.") && isContentType(def.type);
}

export function PageEditorPage() {
  const { siteKey = DEFAULT_SITE_KEY, id } = useParams<{ siteKey: string; id: string }>();
  const qc = useQueryClient();

  // Queries
  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const layoutsQuery = useQuery({ queryKey: ["layouts", siteKey], queryFn: () => fetchLayouts(siteKey) });
  const pageQuery = useQuery({
    queryKey: ["pages", siteKey, id],
    queryFn: () => fetchPage(siteKey, id!),
    enabled: !!id,
  });

  // Derive default locale
  const locales = localesQuery.data ?? [];
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "";
  const [selectedLocale, setSelectedLocale] = useState<string>("");

  useEffect(() => {
    if (!selectedLocale && defaultLocale) {
      setSelectedLocale(defaultLocale);
    }
  }, [defaultLocale, selectedLocale]);

  const contentQuery = useQuery({
    queryKey: ["content", siteKey, id, selectedLocale],
    queryFn: () => fetchContent(siteKey, id!, { locale: selectedLocale }),
    enabled: !!id && !!selectedLocale,
  });

  const page = pageQuery.data;
  const layouts = layoutsQuery.data ?? [];
  const layout = page?.layout ?? layouts.find((l) => l.id === page?.layoutId);
  const contentEntries: Content[] = contentQuery.data ?? [];

  // contentMap: key -> Content
  const contentMap = new Map<string, Content>(contentEntries.map((c) => [c.key, c]));

  // Local path state for the path input
  const [localPath, setLocalPath] = useState<string>("");
  useEffect(() => {
    if (page?.path !== undefined) setLocalPath(page.path);
  }, [page?.path]);

  // Mutations
  const updatePageMutation = useMutation({
    mutationFn: ({ data }: { data: Parameters<typeof updatePage>[2] }) =>
      updatePage(siteKey, id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pages", siteKey, id] });
      toast.success("Page updated");
    },
    onError: (err) => {
      toastError("Failed to update page", err);
    },
  });

  const createContentMutation = useMutation({
    mutationFn: (data: Parameters<typeof createContent>[1]) => createContent(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content", siteKey, id, selectedLocale] });
    },
    onError: (err) => {
      toastError("Failed to save content", err);
    },
  });

  const resetContentMutation = useMutation({
    mutationFn: (contentId: string) => deleteContent(siteKey, contentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["content", siteKey, id, selectedLocale] });
      qc.invalidateQueries({ queryKey: ["pages", siteKey, id] });
      toast.success("Reset to layout default");
    },
    onError: (err) => {
      toastError("Failed to reset content", err);
    },
  });

  const cleanupOrphansMutation = useMutation({
    mutationFn: () => deleteOrphanedContent(siteKey, id!),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["content", siteKey, id, selectedLocale] });
      qc.invalidateQueries({ queryKey: ["pages", siteKey, id] });
      toast.success(`Removed ${data.deleted} orphaned entries`);
    },
    onError: (err) => {
      toastError("Failed to clean up orphaned content", err);
    },
  });

  const resetAllMutation = useMutation({
    mutationFn: () => resetAllContent(siteKey, id!, selectedLocale),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["content", siteKey, id, selectedLocale] });
      qc.invalidateQueries({ queryKey: ["pages", siteKey, id] });
      toast.success(`Reset ${data.deleted} fields to layout defaults`);
    },
    onError: (err) => {
      toastError("Failed to reset content", err);
    },
  });

  function handleContentChange(key: string, value: string) {
    const existing = contentMap.get(key);
    const keyDef = layout?.detectedKeys?.[key];
    if (keyDef && isContentType(keyDef.type)) {
      createContentMutation.mutate({
        pageId: id!,
        key,
        locale: selectedLocale,
        value,
        type: existing?.type ?? keyDef.type,
      });
    }
  }

  // Build completionMap for LocaleTabs from page.contents (all locales)
  const allContents: Content[] = page?.contents ?? [];
  const detectedKeys = layout?.detectedKeys ?? {};
  const totalKeys = Object.entries(detectedKeys).filter(
    ([k, def]) => !k.startsWith("_meta.") && isContentType(def.type)
  ).length;

  const completionMap: Record<string, { filled: number; total: number }> = {};
  for (const locale of locales) {
    const localeContents = allContents.filter((c) => c.locale === locale.code);
    const filled = localeContents.filter((c) => {
      const type = detectedKeys[c.key]?.type;
      return !c.key.startsWith("_meta.") && !!type && isContentType(type) && c.value && c.value.trim() !== "";
    }).length;
    completionMap[locale.code] = { filled, total: totalKeys };
  }

  // Separate regular keys from _meta keys
  const regularKeys = Object.entries(detectedKeys).filter(isContentLayoutEntry);
  const metaKeys = Object.entries(detectedKeys).filter(([k]) => k.startsWith("_meta."));

  // Find orphaned content entries (key exists in DB but not in layout's detectedKeys)
  const orphanedEntries = contentEntries.filter((c) => !(c.key in detectedKeys));

  const [activeTab, setActiveTab] = useState<EditorTab>("visual");

  const isLoading = pageQuery.isLoading || localesQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Loading…" />
        <div className="flex-1 flex items-center justify-center text-neutral-500">Loading…</div>
      </div>
    );
  }

  if (!page) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Page not found" />
        <div className="flex-1 flex items-center justify-center text-neutral-500">
          Page not found.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <TopBar title={page.path} subtitle={layout?.name ?? "No layout assigned"}>
        <LocaleTabs
          siteKey={siteKey}
          selectedLocale={selectedLocale}
          onSelectLocale={setSelectedLocale}
          completionMap={completionMap}
        />
      </TopBar>

      {/* Tab bar */}
      <div className="flex items-center border-b border-neutral-800 bg-neutral-900/50 px-6">
        <Link
          to={siteSectionPath(siteKey, "pages")}
          className="text-sm text-neutral-500 hover:text-neutral-300 mr-6 py-2.5"
        >
          ← Pages
        </Link>
        <button
          type="button"
          onClick={() => setActiveTab("fields")}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${
            activeTab === "fields"
              ? "border-cyan-500 text-white"
              : "border-transparent text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <FormInput className="h-3.5 w-3.5" />
          Fields
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("visual")}
          disabled={!layout}
          className={`flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 transition-colors ${
            activeTab === "visual"
              ? "border-cyan-500 text-white"
              : "border-transparent text-neutral-400 hover:text-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
          }`}
        >
          <Eye className="h-3.5 w-3.5" />
          Visual
        </button>
      </div>

      {/* Main layout: center + right sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Center content area */}
        {activeTab === "fields" ? (
          <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
            {regularKeys.length === 0 && !layout ? (
              <div className="text-neutral-500 text-sm">
                No content keys — assign a layout with keys to this page.
              </div>
            ) : regularKeys.length === 0 ? (
              <div className="text-neutral-500 text-sm">
                No content keys — assign a layout with keys to this page.
              </div>
            ) : (
              <div className="flex flex-col gap-6">
                {regularKeys.map(([key, keyDef]) => {
                  const existing = contentMap.get(key);
                  const isOverridden = !!existing;
                  return (
                    <ContentField
                      siteKey={siteKey}
                      key={key}
                      fieldKey={key}
                      type={keyDef.type}
                      value={existing?.value ?? keyDef.initial ?? ""}
                      defaultValue={keyDef.initial}
                      isOverridden={isOverridden}
                      onChange={(value) => handleContentChange(key, value)}
                      onReset={isOverridden ? () => resetContentMutation.mutate(existing.id) : undefined}
                    />
                  );
                })}
              </div>
            )}

            {/* Orphaned content entries */}
            {orphanedEntries.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-900/50 bg-red-950/30 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-red-300">
                      Unused content ({orphanedEntries.length})
                    </h3>
                    <p className="text-xs text-red-400/70 mt-0.5">
                      These entries no longer match any key in the layout.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => cleanupOrphansMutation.mutate()}
                    disabled={cleanupOrphansMutation.isPending}
                    className="px-3 py-1.5 text-xs font-medium rounded border border-red-800 bg-red-900/50 text-red-300 hover:bg-red-900 hover:text-red-200 transition-colors disabled:opacity-50"
                  >
                    {cleanupOrphansMutation.isPending ? "Removing…" : "Remove all"}
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  {orphanedEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between text-xs py-1.5 px-2 rounded bg-red-950/40"
                    >
                      <span className="font-mono text-red-300/80">{entry.key}</span>
                      <span className="text-red-400/50 max-w-48 truncate">
                        {entry.value.replace(/<[^>]*>/g, "").substring(0, 50)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : layout ? (
          <VisualEditor
            siteKey={siteKey}
            layout={layout}
            contentEntries={contentEntries}
            detectedKeys={detectedKeys}
            locale={selectedLocale}
            onContentChange={handleContentChange}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
            Assign a layout to use the visual editor.
          </div>
        )}

        {/* Right sidebar */}
        <aside className="w-72 shrink-0 border-l border-neutral-800 bg-neutral-900 overflow-auto p-5 flex flex-col gap-6">
          {/* Page Settings */}
          <section className="flex flex-col gap-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
              Page Settings
            </h2>

            {/* Path */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">Path</label>
              <input
                type="text"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
                onBlur={() => {
                  if (localPath !== page.path) {
                    updatePageMutation.mutate({ data: { path: localPath } });
                  }
                }}
                className="bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
              />
            </div>

            {/* Layout */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">Layout</label>
              <Select
                value={page.layoutId ?? NO_LAYOUT_VALUE}
                onValueChange={(value) =>
                  updatePageMutation.mutate({
                    data: { layoutId: value === NO_LAYOUT_VALUE ? undefined : value },
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No layout" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_LAYOUT_VALUE}>No layout</SelectItem>
                    {layouts.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.filePath}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">Status</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => updatePageMutation.mutate({ data: { isPublished: true } })}
                  className={`flex-1 px-3 py-1.5 text-sm rounded border transition-colors ${
                    page.isPublished
                      ? "border-green-600 bg-green-900/40 text-green-300"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  Published
                </button>
                <button
                  type="button"
                  onClick={() => updatePageMutation.mutate({ data: { isPublished: false } })}
                  className={`flex-1 px-3 py-1.5 text-sm rounded border transition-colors ${
                    !page.isPublished
                      ? "border-yellow-600 bg-yellow-900/40 text-yellow-300"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-600"
                  }`}
                >
                  Draft
                </button>
              </div>
            </div>

            {/* Sort Order */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-neutral-400 uppercase tracking-wider">
                Sort Order
              </label>
              <input
                type="number"
                defaultValue={page.sortOrder}
                onBlur={(e) =>
                  updatePageMutation.mutate({ data: { sortOrder: Number(e.target.value) } })
                }
                className="bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
              />
            </div>

            {/* Reset all content */}
            {contentEntries.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Reset all ${contentEntries.length} fields for "${selectedLocale}" to layout defaults?`)) {
                    resetAllMutation.mutate();
                  }
                }}
                disabled={resetAllMutation.isPending}
                className="w-full px-3 py-2 text-xs font-medium rounded border border-amber-800/50 bg-amber-950/30 text-amber-400 hover:bg-amber-900/40 hover:text-amber-300 transition-colors disabled:opacity-50"
              >
                {resetAllMutation.isPending ? "Resetting…" : `Reset all fields to defaults (${contentEntries.length})`}
              </button>
            )}
          </section>

          {/* SEO / _meta keys */}
          {metaKeys.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                SEO
              </h2>
              {metaKeys.map(([key]) => {
                const labelKey = key.replace(/^_meta\./, "");
                const existing = contentMap.get(key);
                return (
                  <div key={key} className="flex flex-col gap-1.5">
                    <label className="text-xs text-neutral-400 uppercase tracking-wider">
                      {labelKey}
                    </label>
                    <input
                      type="text"
                      value={existing?.value ?? ""}
                      onChange={(e) => handleContentChange(key, e.target.value)}
                      placeholder={`Enter ${labelKey}…`}
                      className="bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
                    />
                  </div>
                );
              })}
            </section>
          )}

          {/* Translation Status */}
          {locales.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Translation Status
              </h2>
              <div className="flex flex-col gap-2">
                {locales.map((locale) => {
                  const entry = completionMap[locale.code];
                  const filled = entry?.filled ?? 0;
                  const total = entry?.total ?? 0;
                  const isComplete = total > 0 && filled === total;
                  const isEmpty = filled === 0;

                  const colorClass = isComplete
                    ? "text-green-400"
                    : isEmpty
                      ? "text-red-400"
                      : "text-yellow-400";

                  return (
                    <div key={locale.id} className="flex items-center justify-between">
                      <span className="text-sm text-neutral-300">{locale.code.toUpperCase()}</span>
                      <span className={`text-xs font-medium ${colorClass}`}>
                        {filled}/{total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
