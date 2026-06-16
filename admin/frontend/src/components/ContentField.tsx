import { RotateCcw } from "lucide-react";
import { RichTextEditor } from "./RichTextEditor";
import { ImagePicker } from "./ImagePicker";
import { PagePicker } from "./PagePicker";
import { LinkPicker } from "./LinkPicker";
import type { ContentType } from "../api/types";

interface ContentFieldProps {
  siteKey: string;
  fieldKey: string;
  type: ContentType;
  value: string;
  defaultValue?: string;
  isOverridden?: boolean;
  onChange: (value: string) => void;
  onReset?: () => void;
  missing?: boolean;
}

const TYPE_LABEL: Record<ContentType, string> = {
  text: "text",
  richtext: "rich text",
  image: "image",
  link: "link",
  page: "page",
};

export function ContentField({
  siteKey,
  fieldKey,
  type,
  value,
  defaultValue,
  isOverridden,
  onChange,
  onReset,
  missing,
}: ContentFieldProps) {
  if (fieldKey.startsWith("_meta.")) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <label
          className={`text-xs font-medium uppercase tracking-wider ${
            missing ? "text-red-400" : "text-neutral-400"
          }`}
        >
          {fieldKey}
          {missing && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-red-900 text-red-300 text-[10px] normal-case tracking-normal">
              missing
            </span>
          )}
        </label>
        <span className="text-[10px] text-neutral-600 px-1.5 py-0.5 border border-neutral-700 rounded">
          {TYPE_LABEL[type]}
        </span>
        {isOverridden && onReset && (
          <button
            type="button"
            onClick={onReset}
            title={`Reset to layout default${defaultValue ? `: ${defaultValue.substring(0, 60).replace(/<[^>]*>/g, "")}${defaultValue.length > 60 ? "…" : ""}` : ""}`}
            className="ml-auto flex items-center gap-1 text-[10px] text-amber-400/70 hover:text-amber-300 transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset to default
          </button>
        )}
      </div>

      {type === "richtext" ? (
        <RichTextEditor value={value} onChange={onChange} placeholder={`Enter ${fieldKey}…`} />
      ) : type === "image" ? (
        <ImagePicker siteKey={siteKey} value={value} onChange={onChange} />
      ) : type === "page" ? (
        <PagePicker siteKey={siteKey} value={value} onChange={onChange} />
      ) : type === "link" ? (
        <LinkPicker siteKey={siteKey} value={value} onChange={onChange} placeholder={defaultValue || `Enter ${fieldKey}…`} />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultValue || `Enter ${fieldKey}…`}
          className="bg-neutral-900 border border-neutral-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-neutral-500"
        />
      )}
    </div>
  );
}
