import sanitizeHtml from "sanitize-html";

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
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
  });
}

interface RichTextProps {
  value: string;
  className?: string;
}

export function RichText({ value, className }: RichTextProps) {
  const classes = ["sf-richtext", className].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }}
    />
  );
}
