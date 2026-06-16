import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  createNavigationItem,
  deleteNavigationItem,
  fetchNavigation,
  updateNavigationItem,
} from "../../api/navigation";
import { fetchPages } from "../../api/pages";
import type { NavigationItem } from "../../api/types";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { LinkPicker } from "../LinkPicker";
import { useVisualEditor } from "./VisualEditorContext";

const NO_PAGE_VALUE = "__no_page__";
const SLOT_KEY_PATTERN = /^(.*\.nav\.[^.]+)\.label$/;

interface LayoutSlot {
  prefix: string;
  id: string;
  labelKey: string;
  linkKey: string;
  label: string;
  link: string;
}

function pathToLabel(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split(/[-/]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface NavigationInlineEditorProps {
  siteKey: string;
  locale: string;
}

export function NavigationInlineEditor({ siteKey, locale }: NavigationInlineEditorProps) {
  const qc = useQueryClient();
  const ve = useVisualEditor();
  const [label, setLabel] = useState("");
  const [pageId, setPageId] = useState(NO_PAGE_VALUE);
  const [overrideOpen, setOverrideOpen] = useState(false);

  const navQuery = useQuery({
    queryKey: ["navigation", siteKey, locale],
    queryFn: () => fetchNavigation(siteKey, locale),
    enabled: !!locale,
  });
  const pagesQuery = useQuery({ queryKey: ["pages", siteKey], queryFn: () => fetchPages(siteKey) });
  const pages = pagesQuery.data ?? [];
  const items = navQuery.data ?? [];

  // Layout-defined nav slots — keys like `header.nav.<id>.label` paired with
  // `header.nav.<id>.link`. Discovery walks the iframe DOM so the order matches
  // what's actually rendered (Postgres JSONB doesn't preserve insertion order,
  // so reading from keyTypes scrambles the sequence). Falls back to keyTypes
  // iteration if the iframe isn't reachable.
  const slots: LayoutSlot[] = useMemo(() => {
    if (!ve) return [];

    const buildSlot = (prefix: string): LayoutSlot | null => {
      const labelKey = `${prefix}.label`;
      const linkKey = `${prefix}.link`;
      if (!ve.keyTypes[labelKey] || !ve.keyTypes[linkKey]) return null;
      return {
        prefix,
        id: prefix.split(".").pop() ?? prefix,
        labelKey,
        linkKey,
        label: ve.contentMap[labelKey] ?? "",
        link: ve.contentMap[linkKey] ?? "",
      };
    };

    const found: LayoutSlot[] = [];
    const seen = new Set<string>();

    const iframe = typeof document !== "undefined" ? document.querySelector("iframe") : null;
    const doc = iframe?.contentDocument;
    if (doc) {
      for (const el of doc.querySelectorAll<HTMLElement>("[data-sf-key]")) {
        const key = el.dataset.sfKey ?? "";
        const m = SLOT_KEY_PATTERN.exec(key);
        if (!m) continue;
        const prefix = m[1];
        if (seen.has(prefix)) continue;
        const slot = buildSlot(prefix);
        if (!slot) continue;
        seen.add(prefix);
        found.push(slot);
      }
    }

    // Fallback / safety net: anything declared by the layout that wasn't found
    // in the DOM (e.g. server-rendered fragment off-screen). Appended at the
    // end so the DOM order wins.
    for (const key of Object.keys(ve.keyTypes)) {
      const m = SLOT_KEY_PATTERN.exec(key);
      if (!m) continue;
      const prefix = m[1];
      if (seen.has(prefix)) continue;
      const slot = buildSlot(prefix);
      if (!slot) continue;
      seen.add(prefix);
      found.push(slot);
    }
    return found;
  }, [ve]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<NavigationItem>) => createNavigationItem(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] });
      setLabel("");
      setPageId(NO_PAGE_VALUE);
      setOverrideOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NavigationItem> }) =>
      updateNavigationItem(siteKey, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNavigationItem(siteKey, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] }),
  });

  function handleDraftPageChange(nextPageId: string) {
    setPageId(nextPageId);
    if (!label.trim() && nextPageId !== NO_PAGE_VALUE) {
      const page = pages.find((p) => p.id === nextPageId);
      if (page) setLabel(pathToLabel(page.path));
    }
  }

  function addItem() {
    const trimmed = label.trim();
    if (!trimmed) return;
    createMutation.mutate({
      locale,
      label: trimmed,
      targetPageId: pageId === NO_PAGE_VALUE ? null : pageId,
      parentId: null,
      sortOrder: items.length,
    });
  }

  async function resetToLayoutDefaults() {
    if (!confirm("Delete all custom navigation items for this locale and fall back to the layout?")) return;
    await Promise.all(items.map((item) => deleteMutation.mutateAsync(item.id)));
  }

  const customItemsActive = items.length > 0;

  // ── 1. Custom items override layout — show only the editor ──────────────
  if (customItemsActive) {
    return (
      <div className="flex max-h-[480px] flex-col gap-3 overflow-auto">
        <div className="flex items-center justify-between">
          <SectionHeader title="Navigation" badge="Custom" badgeTone="active" />
          {slots.length > 0 && (
            <button
              type="button"
              onClick={resetToLayoutDefaults}
              disabled={deleteMutation.isPending}
              className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-40"
              title="Delete all custom items and show layout defaults"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to layout
            </button>
          )}
        </div>

        <AddCustomItemForm
          label={label}
          setLabel={setLabel}
          pageId={pageId}
          handleDraftPageChange={handleDraftPageChange}
          pages={pages}
          onAdd={addItem}
          pending={createMutation.isPending}
        />

        <div className="rounded-md border border-neutral-800">
          {navQuery.isLoading ? (
            <div className="px-3 py-4 text-center text-xs text-neutral-500">Loading navigation...</div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-neutral-800 p-2 last:border-b-0">
                <input
                  value={item.label}
                  onChange={(e) => updateMutation.mutate({ id: item.id, data: { label: e.target.value } })}
                  className="h-8 rounded border border-neutral-800 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-cyan-700"
                />
                <Select
                  value={item.targetPageId || NO_PAGE_VALUE}
                  onValueChange={(nextPageId) =>
                    updateMutation.mutate({
                      id: item.id,
                      data: { targetPageId: nextPageId === NO_PAGE_VALUE ? null : nextPageId },
                    })
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Target page" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={NO_PAGE_VALUE}>No target page</SelectItem>
                      {pages.map((page) => (
                        <SelectItem key={page.id} value={page.id}>
                          <span className="font-mono text-xs text-zinc-300">{page.path}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(item.id)}
                  className="flex h-8 w-8 items-center justify-center rounded text-red-400 transition hover:bg-red-950/50 hover:text-red-300"
                  title="Delete navigation item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ── 2. Layout-driven — show slots, hide override form behind a toggle ───
  if (slots.length > 0) {
    return (
      <div className="flex max-h-[480px] flex-col gap-3 overflow-auto">
        <SectionHeader title="Navigation" badge="From layout" badgeTone="active" />

        <div className="rounded-md border border-neutral-800">
          {slots.map((slot) => (
            <div
              key={slot.prefix}
              className="grid grid-cols-[1fr_1fr] gap-2 border-b border-neutral-800 p-2 last:border-b-0"
            >
              <input
                value={slot.label}
                onChange={(e) => ve?.onContentChange(slot.labelKey, e.target.value)}
                className="h-8 rounded border border-neutral-800 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-cyan-700"
                placeholder="Label"
              />
              <LinkPicker
                siteKey={siteKey}
                value={slot.link}
                onChange={(next) => ve?.onContentChange(slot.linkKey, next)}
                placeholder="Target"
              />
            </div>
          ))}
        </div>

        {!overrideOpen ? (
          <button
            type="button"
            onClick={() => setOverrideOpen(true)}
            className="flex items-center gap-1.5 self-start rounded px-2 py-1 text-[11px] text-neutral-400 transition hover:bg-neutral-800 hover:text-neutral-200"
          >
            <Plus className="h-3 w-3" />
            Override with custom items
          </button>
        ) : (
          <div className="space-y-2 rounded-md border border-cyan-900/40 bg-cyan-950/10 p-2">
            <p className="text-[11px] text-neutral-400">
              Adding a custom item replaces the layout links above for this locale.
            </p>
            <AddCustomItemForm
              label={label}
              setLabel={setLabel}
              pageId={pageId}
              handleDraftPageChange={handleDraftPageChange}
              pages={pages}
              onAdd={addItem}
              pending={createMutation.isPending}
            />
            <button
              type="button"
              onClick={() => setOverrideOpen(false)}
              className="text-[11px] text-neutral-500 hover:text-neutral-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── 3. Nothing yet — bare empty-state add form ──────────────────────────
  return (
    <div className="flex max-h-[480px] flex-col gap-3 overflow-auto">
      <SectionHeader title="Navigation" />
      <p className="text-[11px] text-neutral-500">Define the navigation entries for this locale.</p>
      <AddCustomItemForm
        label={label}
        setLabel={setLabel}
        pageId={pageId}
        handleDraftPageChange={handleDraftPageChange}
        pages={pages}
        onAdd={addItem}
        pending={createMutation.isPending}
      />
    </div>
  );
}

// ── Add row used in both override and empty states ─────────────────────────

interface AddCustomItemFormProps {
  label: string;
  setLabel: (v: string) => void;
  pageId: string;
  handleDraftPageChange: (v: string) => void;
  pages: Array<{ id: string; path: string }>;
  onAdd: () => void;
  pending: boolean;
}

function AddCustomItemForm({
  label,
  setLabel,
  pageId,
  handleDraftPageChange,
  pages,
  onAdd,
  pending,
}: AddCustomItemFormProps) {
  return (
    <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label"
        className="h-9 rounded border border-neutral-700 bg-neutral-800 px-3 text-sm text-white outline-none focus:border-cyan-600"
      />
      <Select value={pageId} onValueChange={handleDraftPageChange}>
        <SelectTrigger>
          <SelectValue placeholder="Target page" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NO_PAGE_VALUE}>No target page</SelectItem>
            {pages.map((page) => (
              <SelectItem key={page.id} value={page.id}>
                <span className="font-mono text-xs text-zinc-300">{page.path}</span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <button
        type="button"
        onClick={onAdd}
        disabled={!label.trim() || pending}
        className="flex h-9 w-9 items-center justify-center rounded bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
        title="Add navigation item"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Section header with badge ──────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  badge?: string;
  badgeTone?: "active" | "muted";
}

function SectionHeader({ title, badge, badgeTone = "muted" }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">{title}</span>
      {badge && (
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
            badgeTone === "active"
              ? "border-cyan-700/60 bg-cyan-950/40 text-cyan-300"
              : "border-neutral-700 bg-neutral-900 text-neutral-500"
          }`}
        >
          {badge}
        </span>
      )}
    </div>
  );
}
