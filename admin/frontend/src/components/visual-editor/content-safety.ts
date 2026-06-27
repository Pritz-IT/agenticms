import sanitizeHtml from "sanitize-html";

// Content-safety for the visual-editor PREVIEW (admin origin).
//
// The admin server already sanitises content at the write boundary, so newly
// saved content is clean. This is defence-in-depth for the preview, which
// renders content via dangerouslySetInnerHTML / raw href/src and runs in the
// admin SPA origin — it guards against any pre-existing/legacy values stored
// before the write-boundary fix landed.
//
// KEEP IN SYNC with admin/src/lib/content-sanitize.ts and
// website/src/components/RichText.tsx (same allow-lists; separate packages).

const RICH_TEXT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
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
    "sub",
    "sup",
    "ul",
  ],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
};

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value ?? "", RICH_TEXT_SANITIZE_OPTIONS);
}

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "tel"]);
const SAFE_IMAGE_SCHEMES = new Set(["http", "https"]);

function detectScheme(url: string): string | null {
  // Drop chars a browser ignores while resolving the scheme (C0 controls and
  // spaces, code point <= 0x20) so `java\tscript:` etc. cannot slip through.
  let normalized = "";
  for (const ch of url) {
    if (ch.charCodeAt(0) > 0x20) normalized += ch;
  }
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
  return match ? match[1].toLowerCase() : null;
}

function sanitizeUrl(value: string | undefined, allowedSchemes: Set<string>): string {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed === "") return "";
  const scheme = detectScheme(trimmed);
  if (scheme === null) return trimmed; // relative URL → safe
  return allowedSchemes.has(scheme) ? trimmed : "";
}

export function safeLinkUrl(value: string | undefined): string {
  return sanitizeUrl(value, SAFE_LINK_SCHEMES);
}

export function safeImageUrl(value: string | undefined): string {
  return sanitizeUrl(value, SAFE_IMAGE_SCHEMES);
}
