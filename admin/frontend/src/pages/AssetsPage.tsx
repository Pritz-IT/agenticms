import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "../lib/toast-error";
import { File, ImageIcon, ImagePlus, RefreshCw, Trash2, Type, Upload, UploadCloud, Wand2 } from "lucide-react";
import { TopBar } from "../components/TopBar";
import { convertAssetToWebp, copyGlobalAssetToSite, deleteAsset, fetchAssets, migrateLegacyAssets, uploadAsset } from "../api/assets";
import type { Asset } from "../api/types";
import { DEFAULT_SITE_KEY } from "../site-routing";

type Category = "image" | "font" | "other";

function categorize(mimeType: string): Category {
  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.startsWith("font/") ||
    mimeType.includes("woff") ||
    mimeType.includes("ttf") ||
    mimeType.includes("otf")
  )
    return "font";
  return "other";
}

export function AssetsPage() {
  const { siteKey = DEFAULT_SITE_KEY } = useParams();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<Category>("image");

  const assetsQuery = useQuery({ queryKey: ["assets", siteKey], queryFn: () => fetchAssets(siteKey) });

  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const uploading = bulkProgress !== null;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAsset(siteKey, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });
      toast.success("Asset deleted");
    },
    onError: (err) => {
      toastError("Failed to delete asset", err);
    },
  });

  const migrateMutation = useMutation({
    mutationFn: () => migrateLegacyAssets(siteKey),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });
      qc.invalidateQueries({ queryKey: ["pages", siteKey] });
      qc.invalidateQueries({ queryKey: ["layouts", siteKey] });
      if (result.missingFiles.length > 0) {
        toast.warning(`Migrated ${result.migrated} assets, ${result.missingFiles.length} files missing`);
      } else {
        toast.success(`Migrated ${result.migrated} legacy ${result.migrated === 1 ? "asset" : "assets"}`);
      }
    },
    onError: (err) => {
      toastError("Failed to migrate legacy assets", err);
    },
  });

  const convertWebpMutation = useMutation({
    mutationFn: (id: string) => convertAssetToWebp(siteKey, id),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });
      qc.invalidateQueries({ queryKey: ["pages", siteKey] });
      qc.invalidateQueries({ queryKey: ["layouts", siteKey] });
      toast.success(`Converted ${result.asset.filename}`, {
        description: `${result.contentUpdated} content ${result.contentUpdated === 1 ? "field" : "fields"} updated`,
      });
    },
    onError: (err) => {
      toastError("Failed to convert asset", err);
    },
  });

  const copyLatestGlobalMutation = useMutation({
    mutationFn: (asset: Asset) => copyGlobalAssetToSite(siteKey, asset.globalAssetId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });
      toast.success("Copied latest global asset");
    },
    onError: (err) => {
      toastError("Failed to copy latest global asset", err);
    },
  });

  // Run a batch upload with parallel requests and aggregated toast feedback.
  // Bypasses useMutation for the bulk path so a 5-file drop produces one
  // success message, not five.
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBulkProgress({ current: 0, total: files.length });
      let succeeded = 0;
      const failures: string[] = [];

      await Promise.all(
        files.map(async (file) => {
          try {
            await uploadAsset(siteKey, file);
            succeeded++;
          } catch (err) {
            failures.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
          } finally {
            setBulkProgress((prev) =>
              prev ? { current: prev.current + 1, total: prev.total } : prev,
            );
          }
        }),
      );

      setBulkProgress(null);
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });

      if (failures.length === 0) {
        toast.success(`Uploaded ${succeeded} ${succeeded === 1 ? "file" : "files"}`);
      } else if (succeeded === 0) {
        toast.error(`Failed to upload ${failures.length} ${failures.length === 1 ? "file" : "files"}`, {
          description: failures.slice(0, 3).join("\n"),
        });
      } else {
        toast.warning(`Uploaded ${succeeded}, failed ${failures.length}`, {
          description: failures.slice(0, 3).join("\n"),
        });
      }
    },
    [qc, siteKey],
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    void uploadFiles(files);
    e.target.value = "";
  }

  // Page-wide drag-and-drop — drop anywhere on the window while the page is
  // mounted. We preventDefault on dragover so the browser doesn't open the
  // dropped file in a new tab; the relatedTarget==null trick distinguishes
  // "left the window" from "moved to a child element".
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      if (e.relatedTarget === null) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragActive(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      void uploadFiles(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [uploadFiles]);

  const assets: Asset[] = assetsQuery.data ?? [];

  const grouped = useMemo(() => {
    const images: Asset[] = [];
    const fonts: Asset[] = [];
    const others: Asset[] = [];
    for (const a of assets) {
      const cat = categorize(a.mimeType);
      if (cat === "image") images.push(a);
      else if (cat === "font") fonts.push(a);
      else others.push(a);
    }
    return { images, fonts, others };
  }, [assets]);

  function onDelete(asset: Asset) {
    if (confirm(`Delete "${asset.filename}"?`)) {
      deleteMutation.mutate(asset.id);
    }
  }

  const visible =
    activeTab === "image" ? grouped.images
    : activeTab === "font" ? grouped.fonts
    : grouped.others;
  const legacyAssets = assets.filter((asset) =>
    asset.filePath.startsWith("/assets/") && !asset.filePath.startsWith(`/assets/${siteKey}/`)
  );

  return (
    <div className="app-page">
      <TopBar title="Assets" subtitle="Manage uploaded assets">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="ui-button ui-button-primary"
        >
          <Upload className="h-4 w-4" />
          {uploading
            ? `Uploading ${bulkProgress.current}/${bulkProgress.total}…`
            : "Upload"}
        </button>
      </TopBar>

      <DropOverlay visible={dragActive} />

      <div className="app-content space-y-5">
        <div className="surface p-4 text-sm text-zinc-400">
          This page manages site-owned assets. Shared global assets are read-only and appear in editor image pickers.
        </div>

        {assetsQuery.isLoading ? (
          <ImageGrid skeleton />
        ) : assetsQuery.isError ? (
          <div className="surface p-4 text-sm text-red-300">Failed to load assets.</div>
        ) : assets.length === 0 ? (
          <div className="empty-state">
            <ImagePlus className="h-9 w-9 text-zinc-700" strokeWidth={1.5} />
            <div>
              <p className="font-medium text-zinc-300">No assets uploaded yet</p>
              <p className="mt-1 text-sm text-zinc-500">Upload images and files for your pages.</p>
            </div>
          </div>
        ) : (
          <>
            {legacyAssets.length > 0 && (
              <div className="surface flex flex-col gap-3 border-amber-500/30 bg-amber-950/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-amber-100">Legacy asset paths need migration</p>
                  <p className="mt-1 text-xs text-amber-200/70">
                    {legacyAssets.length} {legacyAssets.length === 1 ? "asset still points" : "assets still point"} outside /assets/{siteKey}/.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => migrateMutation.mutate()}
                  disabled={migrateMutation.isPending}
                  className="ui-button border-amber-500/40 text-amber-100 hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {migrateMutation.isPending ? "Migrating..." : "Migrate legacy paths"}
                </button>
              </div>
            )}

            <CategoryTabs
              activeTab={activeTab}
              onSelect={setActiveTab}
              counts={{
                image: grouped.images.length,
                font: grouped.fonts.length,
                other: grouped.others.length,
              }}
            />

            {visible.length === 0 ? (
              <div className="empty-state">
                <p className="text-sm text-zinc-500">No {labelFor(activeTab).toLowerCase()} yet.</p>
              </div>
            ) : activeTab === "font" ? (
              <FontGrid>
                {visible.map((asset) => (
                  <FontCard
                    key={asset.id}
                    asset={asset}
                    onDelete={onDelete}
                    onCopyLatest={(item) => copyLatestGlobalMutation.mutate(item)}
                    disabled={deleteMutation.isPending}
                    copyDisabled={copyLatestGlobalMutation.isPending}
                  />
                ))}
              </FontGrid>
            ) : (
              <ImageGrid>
                {visible.map((asset) =>
                  activeTab === "image" ? (
                    <ImageCard
                      key={asset.id}
                      asset={asset}
                      onDelete={onDelete}
                      onCopyLatest={(item) => copyLatestGlobalMutation.mutate(item)}
                      onConvertWebp={(item) => convertWebpMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      copyDisabled={copyLatestGlobalMutation.isPending}
                      convertDisabled={convertWebpMutation.isPending}
                    />
                  ) : (
                    <OtherCard
                      key={asset.id}
                      asset={asset}
                      onDelete={onDelete}
                      onCopyLatest={(item) => copyLatestGlobalMutation.mutate(item)}
                      disabled={deleteMutation.isPending}
                      copyDisabled={copyLatestGlobalMutation.isPending}
                    />
                  )
                )}
              </ImageGrid>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── DnD overlay ──────────────────────────────────────────────────────────────

function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-blue-500 bg-zinc-900/80 px-10 py-8 text-center shadow-xl">
        <UploadCloud className="h-10 w-10 text-blue-400" strokeWidth={1.5} />
        <div>
          <p className="text-base font-medium text-zinc-100">Drop to upload</p>
          <p className="mt-1 text-xs text-zinc-400">Files will be added to your assets.</p>
        </div>
      </div>
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

interface CategoryTabsProps {
  activeTab: Category;
  onSelect: (cat: Category) => void;
  counts: Record<Category, number>;
}

function labelFor(cat: Category): string {
  return cat === "image" ? "Images" : cat === "font" ? "Fonts" : "Other";
}

function CategoryTabs({ activeTab, onSelect, counts }: CategoryTabsProps) {
  const tabs: Array<{ cat: Category; icon: React.ReactNode }> = [
    { cat: "image", icon: <ImageIcon className="h-4 w-4" /> },
    { cat: "font", icon: <Type className="h-4 w-4" /> },
  ];
  if (counts.other > 0) tabs.push({ cat: "other", icon: <File className="h-4 w-4" /> });

  return (
    <div className="flex items-center gap-1 border-b border-zinc-800" role="tablist">
      {tabs.map(({ cat, icon }) => {
        const active = cat === activeTab;
        const disabled = counts[cat] === 0 && cat !== activeTab;
        return (
          <button
            key={cat}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onSelect(cat)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 transition-colors -mb-px disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {icon}
            <span>{labelFor(cat)}</span>
            <span className={`text-[11px] tabular-nums ${active ? "text-zinc-400" : "text-zinc-600"}`}>
              {counts[cat]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Layout primitives ────────────────────────────────────────────────────────

function ImageGrid({ children, skeleton }: { children?: React.ReactNode; skeleton?: boolean }) {
  if (skeleton) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface overflow-hidden">
            <div className="aspect-video animate-pulse bg-zinc-900" />
            <div className="space-y-2 p-3">
              <div className="skeleton-line w-3/4" />
              <div className="skeleton-line w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function FontGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{children}</div>;
}

// ── Card variants ────────────────────────────────────────────────────────────

interface CardProps {
  asset: Asset;
  onDelete: (asset: Asset) => void;
  onCopyLatest?: (asset: Asset) => void;
  onConvertWebp?: (asset: Asset) => void;
  disabled?: boolean;
  copyDisabled?: boolean;
  convertDisabled?: boolean;
}

function ImageCard({ asset, onDelete, onCopyLatest, onConvertWebp, disabled, copyDisabled, convertDisabled }: CardProps) {
  return (
    <div className="surface group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-1 hover:border-zinc-700">
      <div className="flex aspect-video items-center justify-center overflow-hidden bg-zinc-950">
        <img
          src={asset.filePath}
          alt={asset.filename}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      </div>
      <CardFooter
        asset={asset}
        onDelete={onDelete}
        onCopyLatest={onCopyLatest}
        onConvertWebp={onConvertWebp}
        disabled={disabled}
        copyDisabled={copyDisabled}
        convertDisabled={convertDisabled}
      />
    </div>
  );
}

function FontCard({ asset, onDelete, onCopyLatest, disabled, copyDisabled }: CardProps) {
  const family = `asset-${asset.id}`;
  const loaded = useFontFace(asset.filePath, family);
  return (
    <div className="surface group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-1 hover:border-zinc-700">
      <div
        className="flex h-24 items-center justify-center bg-zinc-950 text-5xl text-zinc-100"
        style={{ fontFamily: loaded ? `"${family}", system-ui` : "system-ui" }}
      >
        Aa
      </div>
      <CardFooter
        asset={asset}
        onDelete={onDelete}
        onCopyLatest={onCopyLatest}
        disabled={disabled}
        copyDisabled={copyDisabled}
        icon={<Type className="h-3 w-3 text-zinc-500" />}
      />
    </div>
  );
}

function OtherCard({ asset, onDelete, onCopyLatest, disabled, copyDisabled }: CardProps) {
  return (
    <div className="surface group flex flex-col overflow-hidden transition duration-200 hover:-translate-y-1 hover:border-zinc-700">
      <div className="flex aspect-video items-center justify-center bg-zinc-950 text-zinc-600">
        <File className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <CardFooter
        asset={asset}
        onDelete={onDelete}
        onCopyLatest={onCopyLatest}
        disabled={disabled}
        copyDisabled={copyDisabled}
      />
    </div>
  );
}

interface CardFooterProps extends CardProps {
  icon?: React.ReactNode;
}

function CardFooter({ asset, onDelete, onCopyLatest, onConvertWebp, disabled, copyDisabled, convertDisabled, icon }: CardFooterProps) {
  const canCopyLatest = !!asset.differsFromGlobal && !!asset.globalAssetId && !!onCopyLatest;
  const canConvertWebp = !!onConvertWebp && (asset.mimeType === "image/png" || asset.mimeType === "image/jpeg");

  return (
    <div className="flex flex-1 flex-col gap-1 p-3">
      <p className="truncate text-sm font-medium text-zinc-100" title={asset.filename}>
        {asset.filename}
      </p>
      <p className="flex items-center gap-1 truncate text-xs text-zinc-500">
        {icon}
        {asset.mimeType}
      </p>
      <div className="mt-auto flex flex-col gap-2 pt-2">
        {canCopyLatest && (
          <button
            type="button"
            onClick={() => onCopyLatest(asset)}
            disabled={copyDisabled}
            className="ui-button ui-button-ghost text-blue-300 hover:text-blue-200"
          >
            <RefreshCw className="h-4 w-4" />
            Copy latest global asset
          </button>
        )}
        {canConvertWebp && (
          <button
            type="button"
            onClick={() => onConvertWebp(asset)}
            disabled={convertDisabled}
            className="ui-button ui-button-ghost text-cyan-300 hover:text-cyan-200"
          >
            <Wand2 className="h-4 w-4" />
            Convert to WebP
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(asset)}
          disabled={disabled}
          className="ui-button ui-button-ghost text-red-300 hover:text-red-200"
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Hook: register a remote font with the document via FontFace API ─────────

function useFontFace(url: string, family: string): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let face: FontFace | null = null;
    try {
      face = new FontFace(family, `url(${url})`);
      face
        .load()
        .then((f) => {
          if (cancelled) return;
          document.fonts.add(f);
          setLoaded(true);
        })
        .catch(() => {
          // Bad font file — fall back to system font silently.
        });
    } catch {
      // FontFace constructor unavailable (very old browser).
    }
    return () => {
      cancelled = true;
      if (face) {
        try {
          document.fonts.delete(face);
        } catch {
          // Already removed.
        }
      }
    };
  }, [url, family]);
  return loaded;
}
