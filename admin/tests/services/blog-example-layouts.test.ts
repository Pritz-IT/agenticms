import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compileLayout } from "../../src/services/layout-compiler.js";
import { parseLayoutKeys, parseLayoutKind } from "../../src/services/layout-parser.js";

describe("example blog layouts", () => {
  it("formats dates per locale with safe invalid-date and invalid-locale fallbacks", async () => {
    const { formatPostDate } = await import("../../../examples/layouts/lib/format-post-date.js");
    expect(formatPostDate("2026-10-27", "de")).toBe("27. Oktober 2026");
    expect(formatPostDate("2026-10-27T00:00:00.000Z", "en")).toBe("October 27, 2026");
    expect(formatPostDate("invalid", "de")).toBe("invalid");
    expect(formatPostDate("2026-10-27", "bad_locale")).toBe("2026-10-27");
  });

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
