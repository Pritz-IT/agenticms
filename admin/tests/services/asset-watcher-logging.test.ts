import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("asset-watcher logging", () => {
  it("uses the module logger and no console.*", () => {
    const src = readFileSync(new URL("../../src/services/asset-watcher.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/console\./);
    expect(src).toMatch(/from "\.\.\/logging\.js"/);
  });
});
