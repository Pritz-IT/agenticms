import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageField, LinkField, safeImageUrl, safeLinkUrl } from "@agenticms/components";

// safeLinkUrl
assert.equal(safeLinkUrl("https://example.com"), "https://example.com");
assert.equal(safeLinkUrl("/about"), "/about");
assert.equal(safeLinkUrl("mailto:a@b.com"), "mailto:a@b.com");
assert.equal(safeLinkUrl("javascript:alert(1)"), "");
assert.equal(safeLinkUrl("JaVaScRiPt:alert(1)"), "");
assert.equal(safeLinkUrl("java\tscript:alert(1)"), "");
assert.equal(safeLinkUrl("  javascript:alert(1)"), "");
assert.equal(safeLinkUrl("data:text/html,<script>"), "");
assert.equal(safeLinkUrl(undefined), "");

// safeImageUrl
assert.equal(safeImageUrl("/assets/demo/logo.png"), "/assets/demo/logo.png");
assert.equal(safeImageUrl("https://cdn/x.png"), "https://cdn/x.png");
assert.equal(safeImageUrl("javascript:alert(1)"), "");
assert.equal(safeImageUrl("data:image/svg+xml,<svg onload=alert(1)>"), "");

// LinkField drops a javascript: href (renders a plain span, no anchor)
const dangerousLink = renderToStaticMarkup(
  <LinkField href="javascript:alert(1)">click</LinkField>
);
assert.ok(!dangerousLink.includes("javascript:"), "javascript: href must not be rendered");
assert.ok(!dangerousLink.includes("<a "), "dangerous link must not render an anchor");

// LinkField keeps a safe href
const safeLink = renderToStaticMarkup(<LinkField href="/contact">go</LinkField>);
assert.ok(safeLink.includes('href="/contact"'), "safe href must render");

// ImageField drops a javascript: src
const dangerousImg = renderToStaticMarkup(<ImageField src="javascript:alert(1)" alt="x" />);
assert.equal(dangerousImg, "", "dangerous image src must render nothing");

// ImageField keeps a safe src
const safeImg = renderToStaticMarkup(<ImageField src="/assets/logo.png" alt="logo" />);
assert.ok(safeImg.includes('src="/assets/logo.png"'), "safe image src must render");

console.log("fields.test.tsx — all assertions passed");
