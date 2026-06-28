import sanitizeHtml from "sanitize-html";

export function sanitizeRichText(value: string): string {
  return sanitizeHtml(value, {
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
    allowedAttributes: {
      a: ["href", "target", "rel"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }, true),
    },
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
