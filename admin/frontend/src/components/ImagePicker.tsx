import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Check, ImageIcon, Link as LinkIcon } from "lucide-react";
import { fetchAssetLibrary, uploadAsset } from "../api/assets";

interface ImagePickerProps {
  siteKey: string;
  value: string;
  onChange: (url: string) => void;
}

type Mode = "library" | "url";

// External URLs (http://, https://, protocol-relative //) are edited as a
// free-form string; everything else (including /assets/... library paths and
// empty values) defaults to the library tab.
function detectMode(value: string): Mode {
  if (!value) return "library";
  if (/^(https?:)?\/\/.+/i.test(value)) return "url";
  return "library";
}

export function ImagePicker({ siteKey, value, onChange }: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(() => detectMode(value));
  const [libraryOpen, setLibraryOpen] = useState(false);

  const assetLibraryQuery = useQuery({
    queryKey: ["asset-library", siteKey],
    queryFn: () => fetchAssetLibrary(siteKey),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadAsset(siteKey, file),
    onSuccess: (asset) => {
      qc.invalidateQueries({ queryKey: ["assets", siteKey] });
      qc.invalidateQueries({ queryKey: ["asset-library", siteKey] });
      onChange(asset.filePath);
      setMode("library");
      setLibraryOpen(false);
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      uploadMutation.mutate(file);
    }
    e.target.value = "";
  }

  const images = (assetLibraryQuery.data ?? []).filter((a) =>
    a.mimeType.startsWith("image/")
  );

  return (
    <div className="space-y-3">
      {/* Mode tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-700">
        <TabButton
          active={mode === "library"}
          onClick={() => {
            setMode("library");
            setLibraryOpen(true);
          }}
          icon={<ImageIcon className="h-3.5 w-3.5" />}
          label="Library"
        />
        <TabButton
          active={mode === "url"}
          onClick={() => setMode("url")}
          icon={<LinkIcon className="h-3.5 w-3.5" />}
          label="Custom URL"
        />
      </div>

      {/* Shared preview — visible whenever there's a value, regardless of mode */}
      {value && (
        <div className="flex items-center gap-3 p-2 border border-cyan-700/50 rounded bg-cyan-950/20">
          <img
            src={value}
            alt="Selected"
            className="w-12 h-12 object-cover rounded border border-neutral-700 bg-neutral-900"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
          <p className="text-xs text-neutral-400 truncate flex-1 min-w-0">
            {mode === "url" ? value : value.split("/").pop()}
          </p>
        </div>
      )}

      {mode === "library" ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          {!libraryOpen && (
            <button
              type="button"
              onClick={() => setLibraryOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2 border border-neutral-700 rounded text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors text-xs"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Choose from library
            </button>
          )}

          {libraryOpen && (
            <>
              <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                {images.map((asset) => {
                  const selected = value === asset.filePath;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        onChange(asset.filePath);
                        setLibraryOpen(false);
                      }}
                      className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                        selected
                          ? "border-cyan-500"
                          : "border-transparent hover:border-neutral-500"
                      }`}
                    >
                      <img
                        src={asset.filePath}
                        alt={asset.filename}
                        className="w-full h-full object-cover"
                      />
                      {selected && (
                        <div className="absolute inset-0 bg-cyan-500/20 flex items-center justify-center">
                          <Check className="h-5 w-5 text-cyan-400 drop-shadow" />
                        </div>
                      )}
                      {asset.scope === "global-shared" && (
                        <span className="absolute left-1 top-1 rounded bg-zinc-950/85 px-1.5 py-0.5 text-[10px] font-medium text-cyan-100 shadow">
                          Global
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {assetLibraryQuery.isLoading && (
                <p className="text-xs text-neutral-500 text-center py-4">Loading assets...</p>
              )}

              {!assetLibraryQuery.isLoading && images.length === 0 && (
                <p className="text-xs text-neutral-500 text-center py-2">No images uploaded yet</p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setLibraryOpen(true);
              inputRef.current?.click();
            }}
            disabled={uploadMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2 border border-dashed border-neutral-600 rounded text-neutral-500 hover:border-neutral-400 hover:text-neutral-400 transition-colors disabled:opacity-50 text-xs"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploadMutation.isPending ? "Uploading..." : "Upload new image"}
          </button>

          {uploadMutation.isError && (
            <p className="text-red-400 text-xs">{String(uploadMutation.error)}</p>
          )}
        </>
      ) : (
        <div className="space-y-2">
          <input
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com/image.jpg"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:border-cyan-500"
          />
          <p className="text-[11px] text-neutral-500">
            Paste any public image URL. Use Library for uploaded assets.
          </p>
        </div>
      )}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 transition-colors -mb-px ${
        active
          ? "border-cyan-500 text-white"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
