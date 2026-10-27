import { describe, expect, it } from "vitest";
import { sanitizeRichTextValue } from "../../src/lib/content-sanitize.js";
import { sanitizeRichText as sanitizePreviewRichText } from "../../frontend/src/components/visual-editor/content-safety";
import { sanitizeRichText as sanitizeWebsiteRichText } from "../../../website/src/components/RichText";
import { RICH_TEXT_FIXTURES } from "../fixtures/rich-text-fixtures";

describe("rich text sanitizer parity", () => {
  it.each(RICH_TEXT_FIXTURES)("keeps all copies identical for $name", ({ html }) => {
    const server = sanitizeRichTextValue(html);
    expect(sanitizePreviewRichText(html)).toBe(server);
    expect(sanitizeWebsiteRichText(html)).toBe(server);
  });
});
