import type { ReactNode } from "react";
import { safeImageUrl, safeLinkUrl } from "./safe-url";

interface ImageFieldProps {
  src: string | undefined;
  alt: string;
  fallback?: string;
  className?: string;
}

export function ImageField({ src, alt, fallback, className }: ImageFieldProps) {
  const resolvedSrc = safeImageUrl(src) || safeImageUrl(fallback);
  if (!resolvedSrc) return null;

  return <img src={resolvedSrc} alt={alt} className={className} />;
}

interface LinkFieldProps {
  href: string | undefined;
  children: ReactNode;
  className?: string;
}

export function LinkField({ href, children, className }: LinkFieldProps) {
  const safeHref = safeLinkUrl(href);
  if (!safeHref) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a href={safeHref} className={className}>
      {children}
    </a>
  );
}
