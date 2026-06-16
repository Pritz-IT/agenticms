import { describe, it, expect } from "vitest";
import {
  sanitizeRichText,
  safeLinkUrl,
  safeImageUrl,
} from "../src/components/visual-editor/content-safety";

describe("visual-editor content-safety (preview defence-in-depth)", () => {
  it("sanitizeRichText strips scripts and event handlers (was a no-op)", () => {
    expect(sanitizeRichText("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
    const out = sanitizeRichText('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("<img");
  });

  it("sanitizeRichText keeps allow-listed formatting and drops javascript: hrefs", () => {
    expect(sanitizeRichText("<p><strong>x</strong></p>")).toBe("<p><strong>x</strong></p>");
    expect(sanitizeRichText('<a href="javascript:alert(1)">x</a>')).not.toContain("javascript:");
  });

  it("sanitizeRichText tolerates empty/undefined input", () => {
    expect(sanitizeRichText("")).toBe("");
    expect(sanitizeRichText(undefined as unknown as string)).toBe("");
  });

  it("safeLinkUrl allows safe schemes/relative and drops dangerous ones", () => {
    expect(safeLinkUrl("https://x.com")).toBe("https://x.com");
    expect(safeLinkUrl("/about")).toBe("/about");
    expect(safeLinkUrl("javascript:alert(1)")).toBe("");
    expect(safeLinkUrl("  JAVAScript:alert(1)")).toBe("");
    expect(safeLinkUrl("java\tscript:alert(1)")).toBe("");
    expect(safeLinkUrl(undefined)).toBe("");
  });

  it("safeImageUrl allows http/https/relative and drops data:/javascript:", () => {
    expect(safeImageUrl("/assets/logo.png")).toBe("/assets/logo.png");
    expect(safeImageUrl("https://cdn/x.png")).toBe("https://cdn/x.png");
    expect(safeImageUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe("");
    expect(safeImageUrl("javascript:alert(1)")).toBe("");
  });
});
