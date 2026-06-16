import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const FILES = ["build-runner.ts", "cleanup.ts", "symlink.ts"];

describe("website-build services logging", () => {
  for (const f of FILES) {
    it(`${f} has no console.* and no bare catch`, () => {
      const src = readFileSync(new URL(`../../src/services/website-build/${f}`, import.meta.url), "utf-8");
      expect(src).not.toMatch(/console\./);
      expect(src).not.toMatch(/catch\s*\{/);
    });
  }
});
