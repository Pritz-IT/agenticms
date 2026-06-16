import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { LayoutModuleCache } from "../../src/services/layout-module-cache.js";

async function fixtureDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("LayoutModuleCache", () => {
  it("round-trips a fresh module entry", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const input = join(dir, "Home.tsx");
    await writeFile(input, "export default function Home() { return null; }");
    const cache = new LayoutModuleCache(join(dir, "cache"));
    const hash = await cache.computeInputHash([input]);

    await cache.set("layout-1", hash, "export default function Home() {}", [input]);
    const entry = await cache.get("layout-1");

    expect(entry?.code).toBe("export default function Home() {}");
    expect(entry?.inputHash).toBe(hash);
    expect(entry?.inputs).toEqual([input]);
  });

  it("misses when an input file changes but keeps last-good code available", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const input = join(dir, "Home.tsx");
    await writeFile(input, "one");
    const cache = new LayoutModuleCache(join(dir, "cache"));
    const hash = await cache.computeInputHash([input]);
    await cache.set("layout-1", hash, "compiled-one", [input]);

    await writeFile(input, "two");

    expect(await cache.get("layout-1")).toBeNull();
    expect(await cache.getLastGood("layout-1")).toBe("compiled-one");
  });

  it("misses when a bundled sibling input changes", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const entry = join(dir, "Home.tsx");
    const sibling = join(dir, "Hero.tsx");
    await writeFile(entry, "entry");
    await writeFile(sibling, "sibling-one");
    const cache = new LayoutModuleCache(join(dir, "cache"));
    const hash = await cache.computeInputHash([entry, sibling]);
    await cache.set("layout-1", hash, "compiled", [entry, sibling]);

    await writeFile(sibling, "sibling-two");

    expect(await cache.get("layout-1")).toBeNull();
  });

  it("evicts module and sidecar", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const input = join(dir, "Home.tsx");
    await writeFile(input, "entry");
    const cache = new LayoutModuleCache(join(dir, "cache"));
    const hash = await cache.computeInputHash([input]);
    await cache.set("layout-1", hash, "compiled", [input]);

    await cache.evict("layout-1");

    expect(await cache.get("layout-1")).toBeNull();
    expect(await cache.getLastGood("layout-1")).toBeNull();
  });

  it("rejects layout ids that are not safe cache filenames", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const input = join(dir, "Home.tsx");
    await writeFile(input, "entry");
    const cache = new LayoutModuleCache(join(dir, "cache"));
    const hash = await cache.computeInputHash([input]);

    await expect(cache.set("../escape", hash, "compiled", [input])).rejects.toThrow(
      "Invalid layout id"
    );
  });

  it("misses when the cached module no longer matches the sidecar code hash", async () => {
    const dir = await fixtureDir("sf-layout-cache-");
    const input = join(dir, "Home.tsx");
    await writeFile(input, "entry");
    const cacheDir = join(dir, "cache");
    const cache = new LayoutModuleCache(cacheDir);
    const hash = await cache.computeInputHash([input]);
    await cache.set("layout-1", hash, "compiled-one", [input]);

    const sidecar = await readFile(join(cacheDir, "layout-1.json"), "utf-8");
    await writeFile(join(cacheDir, "layout-1.mjs"), "compiled-two");

    expect(await cache.get("layout-1")).toBeNull();
    expect(await cache.getLastGood("layout-1")).toBeNull();
    expect(await readFile(join(cacheDir, "layout-1.json"), "utf-8")).toBe(sidecar);
  });
});
