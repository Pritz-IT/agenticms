import assert from "node:assert/strict";
import { test } from "vitest";
import { detectLinkMode } from "../src/components/link-picker-model";

const pages = ["/", "/sample-template", "/about"];

test("detectLinkMode classifies blank, fragment, page, and custom links", () => {
  assert.deepEqual(detectLinkMode("", pages), { mode: "none", selectedPage: "", fragment: "", custom: "" });
  assert.deepEqual(detectLinkMode("#contact", pages), { mode: "fragment", selectedPage: "", fragment: "contact", custom: "" });
  assert.deepEqual(detectLinkMode("/sample-template", pages), { mode: "page", selectedPage: "/sample-template", fragment: "", custom: "" });
  assert.deepEqual(detectLinkMode("https://example.com", pages), { mode: "custom", selectedPage: "", fragment: "", custom: "https://example.com" });
});
