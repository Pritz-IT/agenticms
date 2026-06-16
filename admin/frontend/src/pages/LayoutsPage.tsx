import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { BadgeCheck, Braces, Copy, LayoutTemplate, RefreshCcw } from "lucide-react";
import { TopBar } from "../components/TopBar";
import {
  copyGlobalTemplateToSite,
  copyLayoutFromGlobal,
  fetchGlobalLayoutTemplates,
  fetchLayouts,
} from "../api/layouts";
import { DEFAULT_SITE_KEY } from "../site-routing";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

export function LayoutsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const queryClient = useQueryClient();
  const layoutsQuery = useQuery({ queryKey: ["layouts", siteKey], queryFn: () => fetchLayouts(siteKey) });
  const globalTemplatesQuery = useQuery({
    queryKey: ["global-layout-templates"],
    queryFn: fetchGlobalLayoutTemplates,
  });
  const createCopyMutation = useMutation({
    mutationFn: ({ templateId }: { templateId: string }) => copyGlobalTemplateToSite(siteKey, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["layouts", siteKey] }),
  });
  const copyFromGlobalMutation = useMutation({
    mutationFn: ({ layoutId }: { layoutId: string }) => copyLayoutFromGlobal(siteKey, layoutId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["layouts", siteKey] }),
  });

  const layouts = layoutsQuery.data ?? [];
  const globalTemplates = globalTemplatesQuery.data ?? [];
  const linkedTemplateIds = new Set(layouts.map((layout) => layout.globalTemplate?.id).filter(Boolean));

  return (
    <div className="app-page">
      <TopBar title="Layouts" subtitle="Detected page layouts" />

      <div className="app-content">
        {layoutsQuery.isLoading ? (
          <div className="space-y-4">
            <div className="surface space-y-3 p-4">
              <div className="skeleton-line w-1/4" />
              <div className="skeleton-line w-2/3" />
            </div>
            <div className="surface space-y-3 p-4">
              <div className="skeleton-line w-1/3" />
              <div className="skeleton-line w-1/2" />
            </div>
          </div>
        ) : layoutsQuery.isError ? (
          <div className="surface p-4 text-sm text-red-300">Failed to load layouts.</div>
        ) : (
          <div className="flex flex-col gap-4">
            {globalTemplates.length > 0 && (
              <div className="surface p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-zinc-100">Global templates</h2>
                  <span className="text-xs text-zinc-500">{globalTemplates.length} available</span>
                </div>
                <div className="flex flex-col gap-2">
                  {globalTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-zinc-200">{template.key}</p>
                        <p className="mt-0.5 text-xs text-zinc-600">{template.name}</p>
                      </div>
                      {linkedTemplateIds.has(template.id) ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-900/60 px-2 py-1 text-xs text-emerald-300">
                          <BadgeCheck className="h-3 w-3" strokeWidth={1.8} />
                          Copied
                        </span>
                      ) : (
                        <button
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 transition hover:border-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                          type="button"
                          disabled={createCopyMutation.isPending}
                          onClick={() => createCopyMutation.mutate({ templateId: template.id })}
                        >
                          <Copy className="h-3 w-3" strokeWidth={1.8} />
                          Create site copy
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {layouts.length === 0 ? (
              <div className="empty-state">
                <LayoutTemplate className="h-9 w-9 text-zinc-700" strokeWidth={1.5} />
                <div>
                  <p className="font-medium text-zinc-300">No layouts detected</p>
                  <p className="mt-1 text-sm text-zinc-500">Layouts will appear after the watcher parses the site.</p>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {layouts.map((layout) => (
                  <div
                    key={layout.id}
                    className="surface p-4 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-700"
                  >
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <div>
                        <h3 className="font-mono text-sm font-semibold text-zinc-100">{layout.filePath}</h3>
                        <p className="mt-1 text-xs text-zinc-500">{layout.name}</p>
                        {layout.globalTemplate && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-cyan-900/60 px-2 py-1 text-xs text-cyan-300">
                              Global template
                            </span>
                            {layout.globalTemplate.differsFromSiteCopy && (
                              <span className="rounded-md border border-amber-900/60 px-2 py-1 text-xs text-amber-300">
                                Modified
                              </span>
                            )}
                            {layout.globalTemplate.differsFromSiteCopy && (
                              <button
                                className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-200 transition hover:border-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
                                type="button"
                                disabled={copyFromGlobalMutation.isPending}
                                onClick={() => copyFromGlobalMutation.mutate({ layoutId: layout.id })}
                              >
                                <RefreshCcw className="h-3 w-3" strokeWidth={1.8} />
                                Copy from global
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="shrink-0 text-xs text-zinc-600">
                        Updated {formatDate(layout.updatedAt)}
                      </p>
                    </div>
                    {Object.keys(layout.detectedKeys).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {Object.entries(layout.detectedKeys).map(([key, meta]) => (
                          <span
                            key={key}
                            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950/55 px-2 py-1 text-xs text-zinc-300"
                          >
                            <Braces className="h-3 w-3 text-cyan-300/75" strokeWidth={1.8} />
                            <span className="font-medium">{key}</span>
                            <span className="text-zinc-600">{meta.type}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {globalTemplatesQuery.isError && (
              <div className="surface p-4 text-sm text-red-300">Failed to load global templates.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
