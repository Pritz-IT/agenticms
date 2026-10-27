import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileLayout } from "../../src/services/layout-compiler.js";
import { parseLayoutKeys, parseLayoutKind } from "../../src/services/layout-parser.js";

describe("example blog layouts", () => {
  it.each([
    ["ExamplePost", "post"],
    ["ExampleBlogOverview", "page"],
  ] as const)("parses and compiles %s as a %s layout", async (name, kind) => {
    const file = resolve("../examples/layouts", `${name}.tsx`);
    const source = await readFile(file, "utf-8");
    expect(parseLayoutKind(source)).toBe(kind);
    const keys = parseLayoutKeys(source);
    if (kind === "post") {
      expect(keys["header.title"]).toEqual({ type: "text", initial: "AgentiCMS Journal" });
      expect(keys["footer.tagline"]).toEqual({ type: "text", initial: "Ideas worth sharing." });
    } else {
      expect(keys["blog.list"]).toEqual({ type: "bloglist", initial: "" });
    }
    const compiled = await compileLayout(file);
    expect(compiled).toMatchObject({ ok: true });
    if (compiled.ok) expect(compiled.code).toContain("react/jsx-runtime");
  });
});
