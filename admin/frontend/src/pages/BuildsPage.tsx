import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import {
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Rocket,
  RotateCcw,
  Send,
} from "lucide-react";
import { TopBar } from "../components/TopBar";
import { BuildStatusNotice } from "../components/BuildStatusNotice";
import { fetchBuilds, rollbackBuild, triggerBuild } from "../api/builds";
import type { Build, BuildTarget } from "../api/types";
import { DEFAULT_SITE_KEY } from "../site-routing";
import { paginateItems } from "../lib/pagination";

const BUILDS_PAGE_SIZE = 10;

const STATUS_COLORS: Record<Build["status"], string> = {
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  building: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
  success: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  failed: "border-red-500/25 bg-red-500/10 text-red-300",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function BuildsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [activeTarget, setActiveTarget] = useState<BuildTarget | null>(null);
  const [queuedBuild, setQueuedBuild] = useState<Build | null>(null);
  const [buildsPage, setBuildsPage] = useState(1);

  const buildsQuery = useQuery({
    queryKey: ["builds", siteKey],
    queryFn: () => fetchBuilds(siteKey),
    refetchInterval: (query) => {
      const builds = (query.state.data as Build[] | undefined) ?? [];
      const hasRunningBuild = builds.some(
        (build) => build.status === "pending" || build.status === "building"
      );

      return hasRunningBuild ? 1500 : 5000;
    },
  });

  const triggerMutation = useMutation({
    mutationFn: (target: BuildTarget) => triggerBuild(siteKey, target),
    onMutate: (target) => {
      setActiveTarget(target);
      setActiveBuildId(null);
      setQueuedBuild(null);
    },
    onSuccess: (build) => {
      setActiveBuildId(build.id);
      setQueuedBuild(build);
      setBuildsPage(1);
      qc.invalidateQueries({ queryKey: ["builds", siteKey] });
      toast.success(`${build.target} build queued`);
    },
    onError: (err, target) => {
      toastError(`Failed to trigger ${target} build`, err);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: (id: string) => rollbackBuild(siteKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["builds", siteKey] });
      toast.success("Build rolled back");
    },
    onError: (err) => {
      toastError("Rollback failed", err);
    },
  });

  const builds = buildsQuery.data ?? [];
  const paginatedBuilds = paginateItems(builds, buildsPage, BUILDS_PAGE_SIZE);
  const activeBuild =
    builds.find((build) => build.id === activeBuildId) ?? queuedBuild;

  useEffect(() => {
    setBuildsPage(1);
  }, [siteKey]);

  useEffect(() => {
    setBuildsPage((currentPage) =>
      paginateItems(builds, currentPage, BUILDS_PAGE_SIZE).currentPage
    );
  }, [builds.length]);

  const prevStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeBuild) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = activeBuild.status;
    if (!prev || prev === activeBuild.status) return;

    if (activeBuild.status === "success") {
      toast.success(`${activeBuild.target} build completed`, {
        description: activeBuild.outputPath ?? undefined,
      });
    } else if (activeBuild.status === "failed") {
      toast.error(`${activeBuild.target} build failed`, {
        description: activeBuild.errorLog ?? "No error log returned",
      });
    }
  }, [activeBuild?.status]);

  return (
    <div className="app-page">
      <TopBar title="Builds" subtitle="Trigger and monitor builds">
        <button
          onClick={() => triggerMutation.mutate("staging")}
          disabled={triggerMutation.isPending}
          className="ui-button"
        >
          <Rocket className="h-4 w-4" />
          {triggerMutation.isPending ? "Building…" : "Build Staging"}
        </button>
        <button
          onClick={() => triggerMutation.mutate("production")}
          disabled={triggerMutation.isPending}
          className="ui-button ui-button-primary"
        >
          <Send className="h-4 w-4" />
          {triggerMutation.isPending ? "Building…" : "Publish"}
        </button>
      </TopBar>

      <div className="app-content">
        <div className="mb-5">
          <BuildStatusNotice
            build={activeBuild}
            error={triggerMutation.error}
            isQueued={triggerMutation.isPending}
            target={activeTarget}
          />
        </div>

        {buildsQuery.isLoading ? (
          <div className="surface space-y-3 p-4">
            <div className="skeleton-line w-1/4" />
            <div className="skeleton-line w-full" />
            <div className="skeleton-line w-3/4" />
          </div>
        ) : buildsQuery.isError ? (
          <div className="surface p-4 text-sm text-red-300">Failed to load builds.</div>
        ) : (
          <div className="ui-table-wrap">
            {builds.length === 0 ? (
              <div className="empty-state border-0 bg-transparent shadow-none">
                <FolderKanban className="h-8 w-8 text-zinc-700" strokeWidth={1.5} />
                <div>
                  <p className="font-medium text-zinc-300">No builds yet</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    Run staging or production to create build history.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="divide-y divide-zinc-900 md:hidden">
                  {paginatedBuilds.items.map((build) => (
                    <article key={build.id} className="space-y-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="ui-label">Target</p>
                          <p className="mt-1 capitalize text-zinc-100">{build.target}</p>
                        </div>
                        <span className={`status-pill shrink-0 ${STATUS_COLORS[build.status]}`}>
                          {build.status}
                        </span>
                      </div>

                      <dl className="grid gap-3 text-sm">
                        <div>
                          <dt className="ui-label">Output Path</dt>
                          <dd className="mt-1 break-all font-mono text-xs leading-5 text-zinc-500">
                            {build.outputPath ?? "-"}
                          </dd>
                        </div>
                        <div>
                          <dt className="ui-label">Started</dt>
                          <dd className="mt-1 text-xs text-zinc-500">
                            {formatDate(build.startedAt)}
                          </dd>
                        </div>
                      </dl>

                      {build.status === "success" && (
                        <button
                          onClick={() => rollbackMutation.mutate(build.id)}
                          disabled={rollbackMutation.isPending}
                          className="ui-button ui-button-ghost w-full text-amber-300 hover:text-amber-200"
                        >
                          <RotateCcw className="h-4 w-4" />
                          Rollback
                        </button>
                      )}
                    </article>
                  ))}
                </div>

                <table className="ui-table hidden md:table">
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Status</th>
                      <th>Output Path</th>
                      <th>Started</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedBuilds.items.map((build) => (
                      <tr key={build.id} className="ui-row">
                        <td className="capitalize text-zinc-100">{build.target}</td>
                        <td>
                          <span
                            className={`status-pill ${STATUS_COLORS[build.status]}`}
                          >
                            {build.status}
                          </span>
                        </td>
                        <td className="font-mono text-xs text-zinc-500">
                          {build.outputPath ?? "-"}
                        </td>
                        <td className="text-xs text-zinc-500">
                          {formatDate(build.startedAt)}
                        </td>
                        <td className="text-right">
                          {build.status === "success" && (
                            <button
                              onClick={() => rollbackMutation.mutate(build.id)}
                              disabled={rollbackMutation.isPending}
                              className="ui-button ui-button-ghost text-amber-300 hover:text-amber-200"
                            >
                              <RotateCcw className="h-4 w-4" />
                              Rollback
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {builds.length > BUILDS_PAGE_SIZE && (
              <div className="flex flex-col gap-3 border-t border-zinc-900 px-4 py-3 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {paginatedBuilds.startIndex + 1}-{paginatedBuilds.endIndex} of{" "}
                  {paginatedBuilds.totalItems}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="ui-button ui-button-ghost h-8 px-2.5 text-xs"
                    disabled={paginatedBuilds.currentPage === 1}
                    onClick={() => setBuildsPage((page) => Math.max(1, page - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    Previous
                  </button>
                  <span className="min-w-20 text-center text-zinc-400">
                    Page {paginatedBuilds.currentPage} of {paginatedBuilds.totalPages}
                  </span>
                  <button
                    type="button"
                    className="ui-button ui-button-ghost h-8 px-2.5 text-xs"
                    disabled={paginatedBuilds.currentPage === paginatedBuilds.totalPages}
                    onClick={() =>
                      setBuildsPage((page) =>
                        Math.min(paginatedBuilds.totalPages, page + 1)
                      )
                    }
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
