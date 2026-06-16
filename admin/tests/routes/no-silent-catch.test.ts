import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// submission-guards.ts is an allowlisted pure helper: its catches return a
// typed {ok:false,reason} the calling route logs at WARN.
const ALLOWLIST = new Set(["lib/submission-guards.ts"]);

function walk(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) return walk(full, rel);
    return rel.endsWith(".ts") ? [rel] : [];
  });
}

describe("no bare silent catch in admin/src", () => {
  it("every catch binds the error", () => {
    const root = new URL("../../src", import.meta.url).pathname;
    const offenders: string[] = [];
    for (const rel of walk(root)) {
      if (ALLOWLIST.has(rel)) continue;
      const src = readFileSync(join(root, rel), "utf-8");
      if (/catch\s*\{/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
