import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseLayoutKeys, extractLayoutName } from "../../src/services/layout-parser.js";

const sampleFixturePath = join(process.cwd(), "tests/fixtures/sample-layout.tsx");
const sampleContent = readFileSync(sampleFixturePath, "utf-8");

describe("parseLayoutKeys", () => {
  it("extracts all 7 keys from the fixture", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(Object.keys(keys)).toHaveLength(7);
  });

  it("extracts text keys correctly", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(keys["hero.title"]).toEqual({ type: "text", initial: "Welcome to Our Company" });
    expect(keys["hero.subtitle"]).toEqual({ type: "text", initial: "We build great software" });
  });

  it("extracts richtext type correctly", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(keys["body.text"]).toEqual({ type: "richtext", initial: "Lorem ipsum dolor sit amet..." });
  });

  it("extracts image type correctly", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(keys["sidebar.image"]).toEqual({ type: "image", initial: "/images/default.jpg" });
  });

  it("extracts link type correctly", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(keys["cta.link"]).toEqual({ type: "link", initial: "/contact" });
  });

  it("extracts navigation editor keys without treating them as unknown", () => {
    const content = `
      export const keys = {
        "header.navigation": { type: "navigation", initial: "" },
      };
    `;
    const keys = parseLayoutKeys(content);
    expect(keys["header.navigation"]).toEqual({ type: "navigation", initial: "" });
  });

  it("extracts _meta reserved keys", () => {
    const keys = parseLayoutKeys(sampleContent);
    expect(keys["_meta.title"]).toEqual({ type: "text", initial: "Home — My Company" });
    expect(keys["_meta.description"]).toEqual({ type: "text", initial: "Welcome to our website" });
  });

  it("returns empty object for file without keys export", () => {
    const content = `
      import React from "react";
      export default function Layout() { return <div />; }
    `;
    expect(parseLayoutKeys(content)).toEqual({});
  });

  it("handles single-quoted strings", () => {
    const content = `
      export const keys = {
        'hero.title': { type: 'text', initial: 'Hello World' },
      };
    `;
    const keys = parseLayoutKeys(content);
    expect(keys["hero.title"]).toEqual({ type: "text", initial: "Hello World" });
  });

  it("rejects entries with mismatched quotes on initial value", () => {
    // "foo' and 'foo" should NOT be parsed — opening and closing quote must match
    const content = `
      export const keys = {
        "valid.key": { type: "text", initial: "ok" },
        "bad.key1": { type: "text", initial: "mismatched' },
        'bad.key2': { type: 'text', initial: 'mismatched" },
      };
    `;
    const keys = parseLayoutKeys(content);
    expect(Object.keys(keys)).toHaveLength(1);
    expect(keys["valid.key"]).toBeDefined();
    expect(keys["bad.key1"]).toBeUndefined();
    expect(keys["bad.key2"]).toBeUndefined();
  });

  it("ignores entries with unknown types", () => {
    const content = `
      export const keys = {
        "valid.key": { type: "text", initial: "ok" },
        "bad.key": { type: "unknown", initial: "ignored" },
      };
    `;
    const keys = parseLayoutKeys(content);
    expect(Object.keys(keys)).toHaveLength(1);
    expect(keys["valid.key"]).toBeDefined();
    expect(keys["bad.key"]).toBeUndefined();
  });
});

describe("extractLayoutName", () => {
  it("extracts filename without extension from absolute path", () => {
    expect(extractLayoutName("/layouts/hero-layout.tsx")).toBe("hero-layout");
  });

  it("extracts filename without extension from relative path", () => {
    expect(extractLayoutName("./layouts/home.tsx")).toBe("home");
  });

  it("handles nested paths", () => {
    expect(extractLayoutName("/some/deep/path/about-us.tsx")).toBe("about-us");
  });
});
