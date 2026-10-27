import type { Extensions } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Figure, Figcaption } from "./FigureNode";
import { AuthedImageNodeView } from "./AuthedImage";

// Keep table layout in editor CSS, not colgroup/col/style markup stripped on save.
const RichTextTable = Table.extend({
  renderHTML: () => ["table", ["tbody", 0]],
});
const cellAttributes = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null, rendered: false },
  scope: { default: null },
};
const RichTextImage = Image.extend({
  addAttributes: () => ({
    src: { default: null },
    alt: { default: null },
    width: { default: null },
    height: { default: null },
  }),
  addNodeView: () => ReactNodeViewRenderer(AuthedImageNodeView),
});

export function richTextExtensions(opts?: { placeholder?: string; postMedia?: boolean }): Extensions {
  return [
    StarterKit.configure({ heading: { levels: [2, 3, 4] }, strike: false }),
    Link.configure({ openOnClick: false, HTMLAttributes: { rel: "noopener noreferrer" } }),
    RichTextImage,
    Figure,
    Figcaption,
    RichTextTable.configure({ resizable: false }),
    TableRow,
    TableHeader.extend({ addAttributes: () => cellAttributes }),
    TableCell.extend({ addAttributes: () => cellAttributes }),
    Placeholder.configure({ placeholder: opts?.placeholder ?? "Start typing…" }),
  ];
}
