import assert from "node:assert/strict";
import { resolveContent } from "../src/lib/content.ts";
import type { Page } from "../src/lib/site-config-types.ts";

const page = {
  id: "page-home",
  path: "/",
  layoutId: "layout-home",
  sortOrder: 0,
  isPublished: true,
  layout: {
    id: "layout-home",
    name: "home",
    filePath: "home.tsx",
    detectedKeys: {
      "hero.title": { type: "text", initial: "Welcome from layout" },
    },
    registeredAt: "2026-04-30T00:00:00.000Z",
    updatedAt: "2026-04-30T00:00:00.000Z",
  },
  contents: [],
} as unknown as Page;

assert.deepEqual(resolveContent(page, "en", "en"), {
  "hero.title": "Welcome from layout",
});
