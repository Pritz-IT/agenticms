import { describe, expect, it } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/html";
import type { JSONContent } from "@tiptap/core";
import { richTextExtensions } from "../src/components/rich-text-extensions";
import { sanitizeRichTextValue } from "../../src/lib/content-sanitize";

describe("rich text schema", () => {
  it("figure and table survive load → edit → save", () => {
    const json = generateJSON(
      '<figure><img src="/media/post/photo.png" alt="A mountain" width="640" height="480"><figcaption>A <em>caption</em></figcaption></figure>' +
      '<table><thead><tr><th scope="col" colspan="2">Heading</th></tr></thead><tbody><tr><td>Before</td><td rowspan="2">Other</td></tr><tr><td>Last</td></tr></tbody></table>',
      richTextExtensions()
    );
    function edit(node: JSONContent) {
      if (node.text === "Before") node.text = "After";
      node.content?.forEach(edit);
    }
    edit(json);
    const html = generateHTML(json, richTextExtensions());
    expect(html).toContain("<figure>");
    expect(html).toContain('src="/media/post/photo.png"');
    expect(html).toContain('alt="A mountain"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="480"');
    expect(html).toContain("<figcaption>A <em>caption</em></figcaption>");
    expect(html).toContain("<table>");
    expect(html).toMatch(/<th[^>]*scope="col"/);
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toMatch(/<td[^>]*><p>After<\/p><\/td>/);
    expect(html).not.toContain("Before");
    expect(html).not.toMatch(/colgroup|colwidth|style=|min-width/);
    expect(sanitizeRichTextValue(html)).toBe(html.replace(/<img([^>]+)>/g, "<img$1 />"));
  });

  it("preserves captionless figures and existing page images", () => {
    const html = generateHTML(generateJSON(
      '<figure><img src="/assets/site/photo.png" alt="Photo"></figure><p>Text</p><img src="/assets/site/old.png" alt="Old">',
      richTextExtensions()
    ), richTextExtensions());
    expect(html).toContain('<figure><img src="/assets/site/photo.png" alt="Photo"></figure>');
    expect(html).toContain('<img src="/assets/site/old.png" alt="Old">');
    expect(html).not.toContain("figcaption");
  });

  it("only offers supported headings and excludes strike", () => {
    const json = generateJSON('<h1>Title</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><p><s>Plain</s></p>', richTextExtensions());
    const html = generateHTML(json, richTextExtensions());
    expect(html).not.toMatch(/<h1|<s>/);
    expect(html).toContain("<h2>Two</h2><h3>Three</h3><h4>Four</h4>");
    expect(html).toContain("Plain");
  });
});
