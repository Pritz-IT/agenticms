import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText, sanitizeRichText } from "@agenticms/components";

const dirtyHtml =
  '<p onclick="alert(1)">Hello <strong>world</strong></p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="/safe">safe</a>';

assert.equal(
  sanitizeRichText(dirtyHtml),
  '<p>Hello <strong>world</strong></p><a rel="noopener noreferrer">bad</a><a href="/safe" rel="noopener noreferrer">safe</a>'
);

const rendered = renderToStaticMarkup(<RichText value={dirtyHtml} className="copy" />);

assert.equal(
  rendered,
  '<div class="sf-richtext copy"><p>Hello <strong>world</strong></p><a rel="noopener noreferrer">bad</a><a href="/safe" rel="noopener noreferrer">safe</a></div>'
);
