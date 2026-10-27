import { Node } from "@tiptap/core";

export const Figure = Node.create({
  name: "figure",
  group: "block",
  content: "image figcaption?",
  defining: true,
  isolating: true,
  parseHTML: () => [{ tag: "figure" }],
  renderHTML: () => ["figure", 0],
});

export const Figcaption = Node.create({
  name: "figcaption",
  content: "inline*",
  defining: true,
  parseHTML: () => [{ tag: "figcaption" }],
  renderHTML: () => ["figcaption", 0],
});
