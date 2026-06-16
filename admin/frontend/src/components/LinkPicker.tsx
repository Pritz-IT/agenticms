import { useEffect, useMemo, useState } from "react";
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
import { detectLinkMode, fragmentToHref } from "./link-picker-model";
import type { LinkMode } from "./link-picker-model";

const NONE = "__none__";
const FRAGMENT = "__fragment__";
const CUSTOM = "__custom__";
const PAGE_PREFIX = "page:";

interface LinkPickerProps {
  siteKey: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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

export function LinkPicker({ siteKey, value, onChange, placeholder }: LinkPickerProps) {
  const [modeOverride, setModeOverride] = useState<LinkMode | null>(null);
  const { data: pages = [] } = useQuery({
    queryKey: ["pages", siteKey],
    queryFn: () => fetchPages(siteKey),
  });

  const pagePaths = useMemo(() => pages.map((page) => page.path), [pages]);
  const detectedState = useMemo(() => detectLinkMode(value, pagePaths), [pagePaths, value]);
  const state = modeOverride ? { ...detectedState, mode: modeOverride } : detectedState;
  const selectValue =
    state.mode === "page"
      ? `${PAGE_PREFIX}${state.selectedPage}`
      : state.mode === "fragment"
        ? FRAGMENT
        : state.mode === "custom"
          ? CUSTOM
          : NONE;

  useEffect(() => {
    setModeOverride(null);
  }, [value]);

  function handleSelectChange(nextValue: string) {
    if (nextValue === NONE) {
      setModeOverride(null);
      onChange("");
      return;
    }

    if (nextValue === FRAGMENT) {
      setModeOverride(null);
      onChange(state.mode === "fragment" ? fragmentToHref(state.fragment) : "#");
      return;
    }

    if (nextValue === CUSTOM) {
      setModeOverride("custom");
      if (state.mode === "custom") {
        onChange(state.custom);
      }
      return;
    }

    if (nextValue.startsWith(PAGE_PREFIX)) {
      setModeOverride(null);
      onChange(nextValue.slice(PAGE_PREFIX.length));
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={selectValue} onValueChange={handleSelectChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select target..." />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE}>
              <span className="text-zinc-500">None</span>
            </SelectItem>
            <SelectSeparator />
            {pages.map((page) => (
              <SelectItem key={page.id} value={`${PAGE_PREFIX}${page.path}`}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-zinc-400">{page.path}</span>
                  <span>{pathToLabel(page.path)}</span>
                </span>
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={FRAGMENT}>Fragment</SelectItem>
            <SelectItem value={CUSTOM}>Custom URL</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {state.mode === "fragment" && (
        <input
          type="text"
          value={state.fragment}
          onChange={(e) => onChange(fragmentToHref(e.target.value))}
          placeholder="contact"
          className="bg-neutral-900 border border-neutral-700 text-white rounded px-3 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
        />
      )}

      {state.mode === "custom" && (
        <input
          type="text"
          value={state.custom}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "https://example.com or /#contact"}
          className="bg-neutral-900 border border-neutral-700 text-white rounded px-3 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
        />
      )}
    </div>
  );
}
