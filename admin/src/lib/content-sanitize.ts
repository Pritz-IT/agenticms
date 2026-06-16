import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitisation of CMS content at the WRITE boundary.
 *
 * Content is rendered into the public static site and into the admin visual
 * editor preview, partly via `dangerouslySetInnerHTML` / raw `href`/`src`
 * interpolation. Sanitising here — before persistence — makes stored content
 * safe regardless of which renderer reads it later (closes editor-shipped
 * stored XSS on both the admin control plane and the public site).
 *
 * The rich-text allow-list is intentionally identical to the public renderer in
 * `website/src/components/RichText.tsx` — KEEP THE TWO IN SYNC. (They live in
 * separate packages, mirrored the same way the visual-editor shims mirror the
 * website components.)
 */
export const RICH_TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "em",
    "h2",
    "h3",
    "h4",
    "hr",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

export function sanitizeRichTextValue(value: string): string {
  return sanitizeHtml(value, RICH_TEXT_SANITIZE_OPTIONS);
}

// Schemes a stored URL may carry. Anything else (javascript:, data:, vbscript:,
// file:, …) is rejected to an empty string rather than persisted.
const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_IMAGE_SCHEMES = new Set(["http", "https"]);

/**
 * Detect the URL scheme the same way a browser does: characters a browser
 * ignores while resolving the scheme — all C0 control characters and spaces
 * (code point <= 0x20, e.g. TAB/LF/CR) — are dropped first, so tricks like
 * `java\tscript:` or `\x01javascript:` cannot smuggle a dangerous scheme past
 * the check. Returns the lowercased scheme, or null for a scheme-less
 * (relative) URL.
 */
function detectScheme(url: string): string | null {
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
  // No scheme → relative URL (/path, #anchor, ?query, ./rel) → safe.
  if (scheme === null) return trimmed;
  return allowedSchemes.has(scheme) ? trimmed : "";
}

/** Sanitise a link href: allow http/https/mailto/tel + relative; drop the rest. */
export function safeLinkUrl(value: string): string {
  return sanitizeUrl(value, SAFE_LINK_SCHEMES);
}

/** Sanitise an image src: allow http/https + relative; drop data:/javascript:/etc. */
export function safeImageUrl(value: string): string {
  return sanitizeUrl(value, SAFE_IMAGE_SCHEMES);
}

/**
 * Sanitise a content value according to its declared type. `text` and `page`
 * are rendered escaped / as references and pass through unchanged; only the
 * types that reach an HTML sink (richtext, link, image) are sanitised.
 */
export function sanitizeContentValue(value: string, type: string): string {
  switch (type) {
    case "richtext":
      return sanitizeRichTextValue(value);
    case "link":
      return safeLinkUrl(value);
    case "image":
      return safeImageUrl(value);
    default:
      return value;
  }
}
