import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPages } from "../api/pages";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const NONE = "__none__";

interface PagePickerProps {
  siteKey: string;
  value: string;
  onChange: (value: string) => void;
}

interface PageRef {
  path: string;
  label: string;
}

function parse(raw: string): PageRef | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v?.path ? v : null;
  } catch {
    return null;
  }
}

function pathToLabel(path: string): string {
  if (path === "/") return "Home";
  return path
    .replace(/^\//, "")
    .split(/[-/]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function PagePicker({ siteKey, value, onChange }: PagePickerProps) {
  const { data: pages = [] } = useQuery({
    queryKey: ["pages", siteKey],
    queryFn: () => fetchPages(siteKey),
  });

  const current = useMemo(() => parse(value), [value]);

  function handlePageChange(selectedPath: string) {
    if (selectedPath === NONE) {
      onChange("");
      return;
    }
    const label = current?.label || pathToLabel(selectedPath);
    onChange(JSON.stringify({ path: selectedPath, label }));
  }

  function handleLabelChange(newLabel: string) {
    if (!current) return;
    onChange(JSON.stringify({ path: current.path, label: newLabel }));
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select
        value={current?.path || NONE}
        onValueChange={handlePageChange}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a page…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE}>
              <span className="text-zinc-500">None</span>
            </SelectItem>
            <SelectSeparator />
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.path}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-zinc-400">{p.path}</span>
                  {p.layout && (
                    <span className="text-[10px] text-zinc-600">
                      {p.layout.name}
                    </span>
                  )}
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {current && (
        <input
          type="text"
          value={current.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="Nav label…"
          className="bg-neutral-900 border border-neutral-700 text-white rounded px-3 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
        />
      )}
    </div>
  );
}
