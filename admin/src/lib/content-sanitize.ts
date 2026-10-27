import sanitizeHtml from "sanitize-html";
import { parseDocument, type ChildNode } from "htmlparser2";

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
    "figcaption",
    "figure",
    "h2",
    "h3",
    "h4",
    "hr",
    "li",
    "img",
    "ol",
    "p",
    "pre",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height"],
    td: ["colspan", "rowspan", "scope"],
    th: ["colspan", "rowspan", "scope"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
  },
  exclusiveFilter: (frame) =>
    frame.tag === "img" &&
    !(frame.attribs.src?.startsWith("/assets/") || frame.attribs.src?.startsWith("/media/")),
};

export function sanitizeRichTextValue(value: string): string {
  return sanitizeHtml(value, RICH_TEXT_SANITIZE_OPTIONS);
}

export interface SanitizerLoss {
  element: string;
  attribute?: string;
  value?: string;
}

type ParsedElement = {
  name: string;
  attribs: Record<string, string>;
  children: ChildNode[];
};

const MEANINGFUL_RICH_TEXT_ATTRIBUTES = new Set(["src", "alt", "href", "colspan", "rowspan"]);
const IGNORED_DOCUMENT_ELEMENTS = new Set(["html", "head", "body"]);

function isParsedElement(node: ChildNode): node is ChildNode & ParsedElement {
  return "name" in node && "attribs" in node;
}

function visitHtmlElements(html: string, visit: (element: ParsedElement) => void): void {
  const visitNodes = (nodes: ChildNode[]) => {
    for (const node of nodes) {
      if (isParsedElement(node)) visit(node);
      if ("children" in node) visitNodes(node.children);
    }
  };

  visitNodes(parseDocument(html).children);
}

function lossTokens(html: string): SanitizerLoss[] {
  const tokens: SanitizerLoss[] = [];
  visitHtmlElements(html, ({ name, attribs }) => {
    if (IGNORED_DOCUMENT_ELEMENTS.has(name)) return;
    tokens.push({ element: name });
    for (const [attribute, value] of Object.entries(attribs)) {
      if (MEANINGFUL_RICH_TEXT_ATTRIBUTES.has(attribute)) {
        tokens.push({ element: name, attribute, value });
      }
    }
  });
  return tokens;
}

function tokenKey({ element, attribute, value }: SanitizerLoss): string {
  return `${element}\u0000${attribute ?? ""}\u0000${value ?? ""}`;
}

/** Returns elements and meaningful attributes removed by sanitisation. */
export function findSanitizerLoss(input: string, output: string): SanitizerLoss[] {
  const inputTokens = lossTokens(input);
  const outputCounts = new Map<string, number>();
  for (const token of lossTokens(output)) {
    const key = tokenKey(token);
    outputCounts.set(key, (outputCounts.get(key) ?? 0) + 1);
  }

  const losses: SanitizerLoss[] = [];
  for (const token of inputTokens) {
    const key = tokenKey(token);
    const remaining = outputCounts.get(key) ?? 0;
    if (remaining > 0) outputCounts.set(key, remaining - 1);
    else losses.push(token);
  }
  return losses;
}

/** Returns image sources whose alt text is missing or blank. */
export function findImagesWithoutAlt(html: string): string[] {
  const sources: string[] = [];
  visitHtmlElements(html, ({ name, attribs }) => {
    if (name === "img" && !attribs.alt?.trim()) sources.push(attribs.src ?? "");
  });
  return sources;
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
 * Sanitise a content value according to its declared type. `text`, `page` and
 * `bloglist` (JSON text) pass through unchanged; only the
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
