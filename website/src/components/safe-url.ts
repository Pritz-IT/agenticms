// URL scheme allow-list for rendered link/image content.
//
// Defence-in-depth mirror of the admin write-boundary sanitiser
// (admin/src/lib/content-sanitize.ts) — KEEP THE TWO IN SYNC. The admin
// sanitises on write so new content is already safe; this guards content
// rendered into the public static site against any pre-existing/legacy values
// (e.g. a `javascript:` href stored before the write-boundary fix landed).

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_IMAGE_SCHEMES = new Set(["http", "https"]);

function detectScheme(url: string): string | null {
  // Drop characters a browser ignores while resolving the scheme (all C0
  // control chars and spaces, code point <= 0x20, e.g. TAB/LF/CR) so tricks
  // like `java\tscript:` cannot smuggle a dangerous scheme past the check.
  let normalized = "";
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x20) normalized += ch;
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
  return match ? match[1].toLowerCase() : null;
}

function sanitizeUrl(value: string, allowedSchemes: Set<string>): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const scheme = detectScheme(trimmed);
  if (scheme === null) return trimmed; // relative URL → safe
  return allowedSchemes.has(scheme) ? trimmed : "";
}

/** Allow http/https/mailto/tel + relative link hrefs; drop the rest. */
export function safeLinkUrl(value: string | undefined): string {
  return value ? sanitizeUrl(value, SAFE_LINK_SCHEMES) : "";
}

/** Allow http/https + relative image srcs; drop data:/javascript:/etc. */
export function safeImageUrl(value: string | undefined): string {
  return value ? sanitizeUrl(value, SAFE_IMAGE_SCHEMES) : "";
}
