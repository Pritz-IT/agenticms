import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { FileText, Plus, Rocket, Send, Trash2, X } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { BuildStatusNotice } from "../components/BuildStatusNotice";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { createPage, deletePage, fetchPages } from "../api/pages";
import { fetchLayouts } from "../api/layouts";
import { fetchBuilds, triggerBuild } from "../api/builds";
import type { Build, BuildTarget } from "../api/types";
import { DEFAULT_SITE_KEY, siteSectionPath } from "../site-routing";

const NO_LAYOUT_VALUE = "__no_layout__";

export function PagesListPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newLayoutId, setNewLayoutId] = useState("");
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<BuildTarget | null>(null);
  const [queuedBuild, setQueuedBuild] = useState<Build | null>(null);

  const pagesQuery = useQuery({ queryKey: ["pages", siteKey], queryFn: () => fetchPages(siteKey) });
  const layoutsQuery = useQuery({ queryKey: ["layouts", siteKey], queryFn: () => fetchLayouts(siteKey) });
  const buildsQuery = useQuery({
    queryKey: ["builds", siteKey],
    queryFn: () => fetchBuilds(siteKey),
    enabled: activeBuildId !== null,
    refetchInterval: (query) => {
      const builds = (query.state.data as Build[] | undefined) ?? [];
      const activeBuild = builds.find((build) => build.id === activeBuildId);

      return activeBuildId &&
        (!activeBuild || activeBuild.status === "pending" || activeBuild.status === "building")
        ? 1500
        : false;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createPage>[1]) => createPage(siteKey, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pages", siteKey] });
      setShowCreate(false);
      setNewPath("");
      setNewLayoutId("");
      toast.success("Page created");
    },
    onError: (err) => {
      toastError("Failed to create page", err);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePage(siteKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pages", siteKey] });
      toast.success("Page deleted");
    },
    onError: (err) => {
      toastError("Failed to delete page", err);
    },
  });

  const buildMutation = useMutation({
    mutationFn: (target: BuildTarget) => triggerBuild(siteKey, target),
    onMutate: (target) => {
      setActiveTarget(target);
      setActiveBuildId(null);
      setQueuedBuild(null);
    },
    onSuccess: (build) => {
      setActiveBuildId(build.id);
      setQueuedBuild(build);
      qc.invalidateQueries({ queryKey: ["builds", siteKey] });
      toast.success(`${build.target} build queued`);
    },
    onError: (err, target) => {
      toastError(`Failed to trigger ${target} build`, err);
    },
  });

  const pages = pagesQuery.data ?? [];
  const layouts = layoutsQuery.data ?? [];
  const builds = buildsQuery.data ?? [];
  const activeBuild =
    builds.find((build) => build.id === activeBuildId) ?? queuedBuild;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ path: newPath, layoutId: newLayoutId || undefined });
  }

  return (
    <div className="app-page">
      <TopBar title="Pages" subtitle="Manage routes and assign layouts">
        <button
          onClick={() => setShowCreate((v) => !v)}
          className={showCreate ? "ui-button" : "ui-button ui-button-primary"}
        >
          {showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showCreate ? "Cancel" : "New page"}
        </button>
      </TopBar>

      <div className="app-content flex flex-col gap-5">
        {showCreate && (
          <form
            onSubmit={handleCreate}
            className="surface flex flex-wrap items-end gap-4 p-4"
          >
            <div className="flex min-w-56 flex-col gap-1.5">
              <label className="ui-label">Path</label>
              <input
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="/about"
                required
                className="w-full"
              />
            </div>
            <div className="flex min-w-56 flex-col gap-1.5">
              <label className="ui-label">Layout</label>
              <Select
                value={newLayoutId || NO_LAYOUT_VALUE}
                onValueChange={(value) =>
                  setNewLayoutId(value === NO_LAYOUT_VALUE ? "" : value)
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
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="ui-button ui-button-primary"
              >
                <Plus className="h-4 w-4" />
                {createMutation.isPending ? "Creating…" : "Create"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="ui-button"
              >
                Cancel
              </button>
            </div>
            {createMutation.isError && (
              <p className="w-full text-sm text-red-300">{String(createMutation.error)}</p>
            )}
          </form>
        )}

        {pagesQuery.isLoading ? (
          <div className="surface space-y-3 p-4">
            <div className="skeleton-line w-1/3" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-5/6" />
          </div>
        ) : pagesQuery.isError ? (
          <div className="surface p-4 text-sm text-red-300">Failed to load pages.</div>
        ) : (
          <div className="ui-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Layout</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pages.length === 0 ? (
                  <tr>
                    <td colSpan={4}>
                      <div className="empty-state border-0 bg-transparent shadow-none">
                        <FileText className="h-8 w-8 text-zinc-700" strokeWidth={1.5} />
                        <div>
                          <p className="font-medium text-zinc-300">No pages yet</p>
                          <p className="mt-1 text-sm text-zinc-500">Create the first route for this site.</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pages.map((page) => {
                    const layout = layouts.find((l) => l.id === page.layoutId);
                    return (
                      <tr key={page.id} className="ui-row">
                        <td>
                          <Link
                            to={`${siteSectionPath(siteKey, "pages")}/${page.id}`}
                            className="font-medium text-cyan-300 transition hover:text-cyan-200"
                          >
                            {page.path}
                          </Link>
                        </td>
                        <td>
                          {layout ? (
                            <span className="font-mono text-xs text-zinc-300">{layout.filePath}</span>
                          ) : (
                            <span className="text-zinc-600">No layout</span>
                          )}
                        </td>
                        <td>
                          {page.isPublished ? (
                            <span className="status-pill border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
                              Published
                            </span>
                          ) : (
                            <span className="status-pill border-amber-500/25 bg-amber-500/10 text-amber-300">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => {
                              if (confirm(`Delete page "${page.path}"?`)) {
                                deleteMutation.mutate(page.id);
                              }
                            }}
                            disabled={deleteMutation.isPending}
                            className="ui-button ui-button-ghost text-red-300 hover:text-red-200"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only sm:not-sr-only">Delete</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => buildMutation.mutate("staging")}
            disabled={buildMutation.isPending}
            className="ui-button"
          >
            <Rocket className="h-4 w-4" />
            {buildMutation.isPending ? "Building…" : "Build Staging"}
          </button>
          <button
            onClick={() => buildMutation.mutate("production")}
            disabled={buildMutation.isPending}
            className="ui-button ui-button-primary"
          >
            <Send className="h-4 w-4" />
            {buildMutation.isPending ? "Building…" : "Publish Production"}
          </button>
        </div>

        <BuildStatusNotice
          build={activeBuild}
          error={buildMutation.error}
          isQueued={buildMutation.isPending}
          target={activeTarget}
        />
      </div>
    </div>
  );
}
