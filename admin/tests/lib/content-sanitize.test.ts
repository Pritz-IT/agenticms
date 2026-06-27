import { describe, it, expect } from "vitest";
import {
  sanitizeRichTextValue,
  safeLinkUrl,
  safeImageUrl,
  sanitizeContentValue,
} from "../../src/lib/content-sanitize.js";

describe("sanitizeRichTextValue", () => {
  it("strips <script> tags", () => {
    expect(sanitizeRichTextValue("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
  });

  it("strips inline event-handler attributes (onerror/onclick)", () => {
    const out = sanitizeRichTextValue('<p onclick="alert(1)">hi</p>');
    expect(out).not.toContain("onclick");
    expect(out).toContain("hi");
  });

  it("strips <img> (not in the allow-list) and its onerror payload", () => {
    const out = sanitizeRichTextValue('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
  });

  it("keeps allow-listed formatting tags", () => {
    expect(sanitizeRichTextValue("<p><strong>bold</strong> and <em>italic</em></p>")).toBe(
      "<p><strong>bold</strong> and <em>italic</em></p>"
    );
  });

  it("keeps sub/sup tags (CO2, registered marks)", () => {
    expect(sanitizeRichTextValue("<p>CO<sub>2</sub> ORPIT<sup>®</sup></p>")).toBe(
      "<p>CO<sub>2</sub> ORPIT<sup>®</sup></p>"
    );
  });

  it("drops javascript: hrefs on anchors but keeps http(s) links with rel=noopener", () => {
    expect(sanitizeRichTextValue('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
    const safe = sanitizeRichTextValue('<a href="https://example.com">x</a>');
    expect(safe).toContain('href="https://example.com"');
    expect(safe).toContain("noopener");
  });
});

describe("safeLinkUrl", () => {
  it("allows http/https/mailto/tel and relative URLs", () => {
    expect(safeLinkUrl("https://example.com/x")).toBe("https://example.com/x");
    expect(safeLinkUrl("http://example.com")).toBe("http://example.com");
    expect(safeLinkUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeLinkUrl("tel:+41441234567")).toBe("tel:+41441234567");
    expect(safeLinkUrl("/about")).toBe("/about");
    expect(safeLinkUrl("#section")).toBe("#section");
    expect(safeLinkUrl("./relative?q=1")).toBe("./relative?q=1");
  });

  it("rejects javascript:, data:, vbscript:, file: → empty string", () => {
    expect(safeLinkUrl("javascript:alert(1)")).toBe("");
    expect(safeLinkUrl("data:text/html,<script>alert(1)</script>")).toBe("");
    expect(safeLinkUrl("vbscript:msgbox(1)")).toBe("");
    expect(safeLinkUrl("file:///etc/passwd")).toBe("");
  });

  it("defeats obfuscation: control chars, whitespace, and case in the scheme", () => {
    expect(safeLinkUrl("JaVaScRiPt:alert(1)")).toBe("");
    expect(safeLinkUrl("  javascript:alert(1)")).toBe("");
    expect(safeLinkUrl("java\tscript:alert(1)")).toBe("");
    expect(safeLinkUrl("java\nscript:alert(1)")).toBe("");
    expect(safeLinkUrl("javascript:alert(1)")).toBe("");
  });

  it("handles empty / non-string defensively", () => {
    expect(safeLinkUrl("")).toBe("");
    expect(safeLinkUrl("   ")).toBe("");
    expect(safeLinkUrl(undefined as unknown as string)).toBe("");
  });
});

describe("safeImageUrl", () => {
  it("allows http/https and relative; rejects data: and javascript:", () => {
    expect(safeImageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(safeImageUrl("/assets/demo/logo.png")).toBe("/assets/demo/logo.png");
    expect(safeImageUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe("");
    expect(safeImageUrl("javascript:alert(1)")).toBe("");
  });

  it("rejects mailto/tel for images (link-only schemes)", () => {
    expect(safeImageUrl("mailto:a@b.com")).toBe("");
  });
});

describe("sanitizeContentValue", () => {
  it("dispatches by type", () => {
    expect(sanitizeContentValue("<p>x</p><script>y</script>", "richtext")).toBe("<p>x</p>");
    expect(sanitizeContentValue("javascript:alert(1)", "link")).toBe("");
    expect(sanitizeContentValue("javascript:alert(1)", "image")).toBe("");
  });

  it("passes text and page through unchanged (rendered escaped / as references)", () => {
    expect(sanitizeContentValue("javascript:alert(1)", "text")).toBe("javascript:alert(1)");
    expect(sanitizeContentValue("home", "page")).toBe("home");
  });
});
