import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("admin entrypoint", () => {
  it("uses the module logger, not console, for startup", () => {
    const src = readFileSync(new URL("../../src/index.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/console\./);
    expect(src).toMatch(/from "\.\/logging\.js"/);
  });
});
