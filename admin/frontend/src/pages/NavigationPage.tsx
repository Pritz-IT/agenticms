import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CornerDownRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { TopBar } from "../components/TopBar";
import { LocaleTabs } from "../components/LocaleTabs";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  createNavigationItem,
  deleteNavigationItem,
  fetchNavigation,
  updateNavigationItem,
} from "../api/navigation";
import { fetchLocales } from "../api/locales";
import { fetchPages } from "../api/pages";
import type { NavigationItem, Page } from "../api/types";
import { DEFAULT_SITE_KEY } from "../site-routing";

const NO_PAGE_VALUE = "__no_page__";

function pathToLabel(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split(/[-/]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pagePath(item: NavigationItem): string {
  return item.targetPage?.path ?? "No target";
}

interface NavRowProps {
  item: NavigationItem;
  index: number;
  items: NavigationItem[];
  pages: Page[];
  depth?: number;
  childDraft?: { label: string; pageId: string };
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<NavigationItem>) => void;
  onMove: (fromIndex: number, toIndex: number) => void;
  onMoveChild?: (parentId: string, fromIndex: number, toIndex: number) => void;
  onAddChild?: (parentId: string) => void;
  onChildDraftChange?: (parentId: string, draft: { label: string; pageId: string }) => void;
}

function NavRow({
  item,
  index,
  items,
  pages,
  depth = 0,
  childDraft,
  onDelete,
  onUpdate,
  onMove,
  onMoveChild,
  onAddChild,
  onChildDraftChange,
}: NavRowProps) {
  const [label, setLabel] = useState(item.label);
  const draft = childDraft ?? { label: "", pageId: NO_PAGE_VALUE };
  const children = item.children ?? [];

  useEffect(() => {
    setLabel(item.label);
  }, [item.label]);

  function saveLabel() {
    const next = label.trim();
    if (next && next !== item.label) {
      onUpdate(item.id, { label: next });
    } else if (!next) {
      setLabel(item.label);
    }
  }

  return (
    <div className="border-b border-zinc-800/70 last:border-b-0">
      <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] items-center gap-3 px-4 py-3">
        <div className={depth > 0 ? "flex items-center gap-2 pl-8" : ""}>
          {depth > 0 && <CornerDownRight className="h-4 w-4 shrink-0 text-zinc-600" />}
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={saveLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setLabel(item.label);
            }}
            className="h-9 w-full rounded-md border border-zinc-800 bg-zinc-950/70 px-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-500/70 focus:ring-4 focus:ring-cyan-500/10"
          />
        </div>

        <Select
          value={item.targetPageId || NO_PAGE_VALUE}
          onValueChange={(value) =>
            onUpdate(item.id, { targetPageId: value === NO_PAGE_VALUE ? null : value })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="No target page" />
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

        <div className="flex items-center gap-1">
          <span className="mr-2 hidden min-w-24 text-right font-mono text-xs text-zinc-500 xl:inline">
            {pagePath(item)}
          </span>
          <button
            type="button"
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0}
            title="Move up"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(index, index + 1)}
            disabled={index === items.length - 1}
            title="Move down"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          {onAddChild && onChildDraftChange && (
            <button
              type="button"
              onClick={() => onAddChild(item.id)}
              disabled={!draft.label.trim()}
              title="Add child link"
              className="flex h-8 w-8 items-center justify-center rounded-md text-cyan-400 transition hover:bg-cyan-950/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-30"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            title="Delete"
            className="flex h-8 w-8 items-center justify-center rounded-md text-red-400 transition hover:bg-red-950/50 hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {onAddChild && onChildDraftChange && (
        <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] items-center gap-3 border-t border-zinc-900/80 bg-zinc-950/35 px-4 py-2 pl-10">
          <div className="flex items-center gap-2">
            <CornerDownRight className="h-4 w-4 shrink-0 text-zinc-600" />
            <input
              value={draft.label}
              onChange={(e) => onChildDraftChange(item.id, { ...draft, label: e.target.value })}
              placeholder={`Child under ${item.label}`}
              className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950/70 px-3 text-xs text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-500/70"
            />
          </div>
          <Select
            value={draft.pageId}
            onValueChange={(pageId) => {
              const page = pages.find((p) => p.id === pageId);
              onChildDraftChange(item.id, {
                pageId,
                label: draft.label.trim() || (page ? pathToLabel(page.path) : ""),
              });
            }}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="No target page" />
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
          <span className="text-right text-xs text-zinc-600">Add child with +</span>
        </div>
      )}

      {children.length > 0 && (
        <div className="border-t border-zinc-900/80 bg-zinc-950/25">
          {children.map((child, childIndex) => (
            <NavRow
              key={child.id}
              item={child}
              index={childIndex}
              items={children}
              pages={pages}
              depth={1}
              onDelete={onDelete}
              onUpdate={onUpdate}
              onMove={(fromIndex, toIndex) => onMoveChild?.(item.id, fromIndex, toIndex)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NavigationPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const [locale, setLocale] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newPageId, setNewPageId] = useState(NO_PAGE_VALUE);
  const [childDrafts, setChildDrafts] = useState<Record<string, { label: string; pageId: string }>>({});

  const localesQuery = useQuery({ queryKey: ["locales", siteKey], queryFn: () => fetchLocales(siteKey) });
  const pagesQuery = useQuery({ queryKey: ["pages", siteKey], queryFn: () => fetchPages(siteKey) });
  const locales = localesQuery.data ?? [];
  const pages = pagesQuery.data ?? [];
  const defaultLocale = locales.find((l) => l.isDefault)?.code ?? locales[0]?.code ?? "en";
  const validLocale = locales.some((l) => l.code === locale);
  const canWriteNavigation = !!locale && validLocale;

  useEffect(() => {
    if (!localesQuery.data) return;
    if (!locale || !validLocale) {
      setLocale(defaultLocale);
      setNewPageId(NO_PAGE_VALUE);
      setChildDrafts({});
    }
  }, [defaultLocale, locale, localesQuery.data, validLocale]);

  const navQuery = useQuery({
    queryKey: ["navigation", siteKey, locale],
    queryFn: () => fetchNavigation(siteKey, locale),
    enabled: canWriteNavigation,
  });

  const items = useMemo(() => navQuery.data ?? [], [navQuery.data]);

  const createMutation = useMutation({
    mutationFn: (data: Partial<NavigationItem>) => createNavigationItem(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] });
      setNewLabel("");
      setNewPageId(NO_PAGE_VALUE);
      toast.success("Navigation item added");
    },
    onError: (err) => {
      toastError("Failed to add navigation item", err);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NavigationItem> }) =>
      updateNavigationItem(siteKey, id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] });
      toast.success("Navigation updated");
    },
    onError: (err) => {
      toastError("Failed to update navigation", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNavigationItem(siteKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["navigation", siteKey, locale] });
      toast.success("Navigation item deleted");
    },
    onError: (err) => {
      toastError("Failed to delete navigation item", err);
    },
  });

  function handlePageDraftChange(pageId: string) {
    setNewPageId(pageId);
    if (!newLabel.trim() && pageId !== NO_PAGE_VALUE) {
      const page = pages.find((p) => p.id === pageId);
      if (page) setNewLabel(pathToLabel(page.path));
    }
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label || !canWriteNavigation) return;

    createMutation.mutate({
      label,
      locale,
      targetPageId: newPageId === NO_PAGE_VALUE ? null : newPageId,
      parentId: null,
      sortOrder: items.length,
    });
  }

  function handleMove(fromIndex: number, toIndex: number) {
    if (toIndex < 0 || toIndex >= items.length) return;
    const current = items[fromIndex];
    const target = items[toIndex];
    updateMutation.mutate({ id: current.id, data: { sortOrder: toIndex } });
    updateMutation.mutate({ id: target.id, data: { sortOrder: fromIndex } });
  }

  function handleChildMove(parentId: string, fromIndex: number, toIndex: number) {
    const parent = items.find((item) => item.id === parentId);
    const children = parent?.children ?? [];
    if (toIndex < 0 || toIndex >= children.length) return;
    const current = children[fromIndex];
    const target = children[toIndex];
    updateMutation.mutate({ id: current.id, data: { sortOrder: toIndex } });
    updateMutation.mutate({ id: target.id, data: { sortOrder: fromIndex } });
  }

  function handleChildDraftChange(parentId: string, draft: { label: string; pageId: string }) {
    setChildDrafts((prev) => ({ ...prev, [parentId]: draft }));
  }

  function handleAddChild(parentId: string) {
    const draft = childDrafts[parentId] ?? { label: "", pageId: NO_PAGE_VALUE };
    const label = draft.label.trim();
    const parent = items.find((item) => item.id === parentId);
    if (!label || !parent || !canWriteNavigation) return;

    createMutation.mutate({
      label,
      locale,
      parentId,
      targetPageId: draft.pageId === NO_PAGE_VALUE ? null : draft.pageId,
      sortOrder: parent.children?.length ?? 0,
    });
    setChildDrafts((prev) => ({ ...prev, [parentId]: { label: "", pageId: NO_PAGE_VALUE } }));
  }

  const isLoading = localesQuery.isLoading || navQuery.isLoading;

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Navigation" subtitle="Configure the shared site header once per locale">
        <LocaleTabs siteKey={siteKey} selectedLocale={locale} onSelectLocale={setLocale} />
      </TopBar>

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/45">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-medium text-zinc-100">Header links</h2>
            <p className="mt-1 text-xs text-zinc-500">
              These links are global for the selected locale and appear on every Demo page.
            </p>
          </div>

          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">Loading navigation...</div>
          ) : navQuery.isError ? (
            <div className="px-4 py-10 text-center text-sm text-red-400">Failed to load navigation.</div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-zinc-500">
              No header links configured for {locale.toUpperCase()}.
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] gap-3 border-b border-zinc-800/70 px-4 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
                <span>Label</span>
                <span>Target page</span>
                <span className="text-right">Actions</span>
              </div>
              {items.map((item, index) => (
                <NavRow
                  key={item.id}
                  item={item}
                  index={index}
                  items={items}
                  pages={pages}
                  childDraft={childDrafts[item.id]}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  onUpdate={(id, data) => updateMutation.mutate({ id, data })}
                  onMove={handleMove}
                  onMoveChild={handleChildMove}
                  onAddChild={handleAddChild}
                  onChildDraftChange={handleChildDraftChange}
                />
              ))}
            </div>
          )}
        </div>

        <form
          onSubmit={handleAdd}
          className="grid max-w-4xl grid-cols-[minmax(180px,1fr)_minmax(220px,1.2fr)_auto] items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-950/45 p-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Lösungen"
              className="h-9 rounded-md border border-zinc-800 bg-zinc-950/70 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-cyan-500/70 focus:ring-4 focus:ring-cyan-500/10"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-zinc-500">Target page</label>
            <Select value={newPageId} onValueChange={handlePageDraftChange}>
              <SelectTrigger>
                <SelectValue placeholder="No target page" />
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
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending || !newLabel.trim() || !locale}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-cyan-500 px-3 text-sm font-medium text-zinc-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Add link
          </button>
        </form>
      </div>
    </div>
  );
}
