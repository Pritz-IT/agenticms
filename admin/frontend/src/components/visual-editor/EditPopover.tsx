import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { RichTextEditor } from "../RichTextEditor";
import { ImagePicker } from "../ImagePicker";
import { PagePicker } from "../PagePicker";
import { LinkPicker } from "../LinkPicker";
import { NavigationInlineEditor } from "./NavigationInlineEditor";
import type { LayoutKeyType } from "../../api/types";

interface EditPopoverProps {
  siteKey: string;
  fieldKey: string;
  type: LayoutKeyType;
  value: string;
  relatedFields?: Array<{
    key: string;
    type: LayoutKeyType;
    value: string;
  }>;
  locale: string;
  anchorRect: DOMRect;
  onSave: (key: string, value: string) => void;
  onClose: () => void;
}

export function EditPopover({
  siteKey,
  fieldKey,
  type,
  value,
  relatedFields = [],
  locale,
  anchorRect,
  onSave,
  onClose,
}: EditPopoverProps) {
  const [localValue, setLocalValue] = useState(value);
  const [relatedValues, setRelatedValues] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const relatedFieldsKey = useMemo(
    () => relatedFields.map((field) => `${field.key}\u0000${field.value}`).join("\u0001"),
    [relatedFields]
  );

  useEffect(() => {
    setLocalValue(value);
    setRelatedValues(Object.fromEntries(relatedFields.map((field) => [field.key, field.value])));
  }, [relatedFieldsKey, value]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (popoverRef.current && !popoverRef.current.contains(target) && !target.closest("[data-radix-popper-content-wrapper]")) {
        onClose();
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  });

  const handleSave = useCallback(() => {
    if (localValue !== value) {
      onSave(fieldKey, localValue);
    }
    for (const field of relatedFields) {
      const nextValue = relatedValues[field.key] ?? "";
      if (nextValue !== field.value) {
        onSave(field.key, nextValue);
      }
    }
    onClose();
  }, [fieldKey, localValue, onClose, onSave, relatedFields, relatedValues, value]);

  const isGrouped = relatedFields.length > 0;
  const top = Math.min(anchorRect.bottom + 8, window.innerHeight - (type === "navigation" ? 520 : isGrouped ? 320 : 200));
  const left = Math.max(8, anchorRect.left);
  const maxWidth = window.innerWidth - left - 16;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[9999] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl"
      style={{
        top,
        left,
        width: Math.min(type === "image" || type === "page" || type === "navigation" ? 560 : 420, maxWidth),
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
        <span className="text-xs font-mono text-neutral-400">{fieldKey}</span>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-3">
        {type === "richtext" ? (
          <RichTextEditor
            value={localValue}
            onChange={setLocalValue}
            placeholder={`Enter ${fieldKey}...`}
          />
        ) : type === "image" ? (
          <ImagePicker siteKey={siteKey} value={localValue} onChange={setLocalValue} />
        ) : type === "page" ? (
          <PagePicker siteKey={siteKey} value={localValue} onChange={setLocalValue} />
        ) : type === "navigation" ? (
          <NavigationInlineEditor siteKey={siteKey} locale={locale} />
        ) : type === "link" ? (
          <LinkPicker siteKey={siteKey} value={localValue} onChange={setLocalValue} placeholder={`Enter ${fieldKey}...`} />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder={`Enter ${fieldKey}...`}
            className="w-full bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-600"
          />
        )}

        {relatedFields.length > 0 && (
          <div className="mt-3 space-y-3 border-t border-neutral-800 pt-3">
            {relatedFields.map((field) => (
              <label key={field.key} className="block">
                <span className="mb-1 block text-[11px] font-mono text-neutral-500">{field.key}</span>
                {field.type === "link" ? (
                  <LinkPicker
                    siteKey={siteKey}
                    value={relatedValues[field.key] ?? ""}
                    onChange={(nextValue) =>
                      setRelatedValues((prev) => ({ ...prev, [field.key]: nextValue }))
                    }
                    placeholder={`Enter ${field.key}...`}
                  />
                ) : (
                  <input
                    type="text"
                    value={relatedValues[field.key] ?? ""}
                    onChange={(e) =>
                      setRelatedValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave();
                    }}
                    placeholder={`Enter ${field.key}...`}
                    className="w-full bg-neutral-800 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-cyan-600"
                  />
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      {type !== "navigation" && <div className="flex justify-end gap-2 px-3 pb-3">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs font-medium rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="px-3 py-1.5 text-xs font-medium rounded bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
        >
          Save
        </button>
      </div>}
    </div>,
    document.body
  );
}
