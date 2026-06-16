import type { ReactNode, MouseEvent } from "react";
import { useVisualEditor } from "./VisualEditorContext";
import { sanitizeRichText, safeImageUrl, safeLinkUrl } from "./content-safety";

// ── Type exports (match website/src/components/types.ts) ──

export interface SiteSettings {
  id: string;
  name: string;
  domain: string;
  stagingDomain: string;
  defaultLocale: string;
}

export interface LocaleOption {
  id: string;
  code: string;
  label: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface NavigationItem {
  id: string;
  locale: string;
  label: string;
  targetPageId: string | null;
  targetPage?: {
    path: string;
  } | null;
  parentId: string | null;
  sortOrder: number;
  children: NavigationItem[];
}

export type ContentMap = Record<string, string>;

export interface LayoutProps {
  content: ContentMap;
  navigation: NavigationItem[];
  locale: string;
  locales: LocaleOption[];
  settings: SiteSettings | null;
}

// ── Helper: find content key by matching value ──

function findKeyForValue(
  contentMap: Record<string, string>,
  value: string | undefined
): string | undefined {
  if (!value) return undefined;
  return Object.entries(contentMap).find(([, v]) => v === value)?.[0];
}

export function EditableWrap({
  sfKey,
  children,
  className,
}: {
  sfKey: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useVisualEditor();
  if (!sfKey || !ctx) return <>{children}</>;

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    ctx.onFieldClick(
      { key: sfKey, type: ctx.keyTypes[sfKey] ?? "text" },
      el
    );
  };

  return (
    <div
      data-sf-key={sfKey}
      onClick={handleClick}
      className={`sf-ve-editable ${className ?? ""}`}
      style={{ cursor: "pointer", position: "relative" }}
    >
      {children}
    </div>
  );
}

// ── RichText ──

interface RichTextProps {
  value: string;
  className?: string;
}

export function RichText({ value, className }: RichTextProps) {
  const ctx = useVisualEditor();
  const sfKey = ctx ? findKeyForValue(ctx.contentMap, value) : undefined;
  const classes = ["sf-richtext", className].filter(Boolean).join(" ");

  if (!ctx || !sfKey) {
    return (
      <div
        className={classes}
        dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }}
      />
    );
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    ctx.onFieldClick(
      { key: sfKey, type: "richtext" },
      e.currentTarget
    );
  };

  return (
    <div
      data-sf-key={sfKey}
      className={`${classes} sf-ve-editable`}
      onClick={handleClick}
      style={{ cursor: "pointer" }}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }}
    />
  );
}

// Re-exported so layout components importing it from the shim keep working;
// the real implementation lives in ./content-safety (was a no-op pass-through).
export { sanitizeRichText };

// ── ImageField ──

interface ImageFieldProps {
  src: string | undefined;
  alt: string;
  fallback?: string;
  className?: string;
}

export function ImageField({ src, alt, fallback, className }: ImageFieldProps) {
  const ctx = useVisualEditor();
  const resolvedSrc = safeImageUrl(src) || fallback;
  const sfKey = ctx ? findKeyForValue(ctx.contentMap, src) : undefined;

  if (!resolvedSrc) return null;

  const img = <img src={resolvedSrc} alt={alt} className={className} />;

  if (!ctx || !sfKey) return img;

  return (
    <EditableWrap sfKey={sfKey} className={className}>
      {img}
    </EditableWrap>
  );
}

// ── LinkField ──

interface LinkFieldProps {
  href: string | undefined;
  children: ReactNode;
  className?: string;
}

export function LinkField({ href, children, className }: LinkFieldProps) {
  const ctx = useVisualEditor();
  // sfKey lookup uses the RAW href (matches the stored contentMap value); the
  // rendered href is always scheme-sanitised.
  const sfKey = ctx ? findKeyForValue(ctx.contentMap, href) : undefined;
  const safeHref = safeLinkUrl(href);

  if (!ctx || !sfKey) {
    if (!safeHref) return <span className={className}>{children}</span>;
    return <a href={safeHref} className={className}>{children}</a>;
  }

  const handleClick = (e: MouseEvent<HTMLAnchorElement | HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    ctx.onFieldClick(
      { key: sfKey, type: "link" },
      e.currentTarget as HTMLElement
    );
  };

  if (!href) {
    return (
      <span className={`${className ?? ""} sf-ve-editable`} data-sf-key={sfKey} onClick={handleClick} style={{ cursor: "pointer" }}>
        {children}
      </span>
    );
  }

  return (
    <a href={safeHref} className={`${className ?? ""} sf-ve-editable`} data-sf-key={sfKey} onClick={handleClick} style={{ cursor: "pointer" }}>
      {children}
    </a>
  );
}
