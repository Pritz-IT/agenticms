import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverAssetFiles, discoverLayoutFiles } from "../src/discover";

describe("file discovery", () => {
  it("discovers layout TSX and helper TS files from the selected root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-discover-"));
    const layoutsRoot = join(root, ".agenticms", "layouts", "demo");
    await mkdir(join(layoutsRoot, "components"), { recursive: true });
    await writeFile(join(layoutsRoot, "Home.tsx"), "home");
    await writeFile(join(layoutsRoot, "components", "tokens.ts"), "tokens");
    await writeFile(join(layoutsRoot, "notes.md"), "ignored");

    const files = await discoverLayoutFiles(layoutsRoot);

    expect(files.map((file) => file.path)).toEqual(["Home.tsx", "components/tokens.ts"]);
    expect(files[0].content).toBe("home");
  });

  it("discovers global template files from _global", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-global-discover-"));
    const globalRoot = join(root, ".agenticms", "layouts", "_global");
    await mkdir(join(globalRoot, "sample-template", "components"), { recursive: true });
    await writeFile(join(globalRoot, "sample-template", "Home.tsx"), "home");
    await writeFile(join(globalRoot, "sample-template", "components", "tokens.ts"), "tokens");

    const files = await discoverLayoutFiles(globalRoot);

    expect(files.map((file) => file.path)).toEqual([
      "sample-template/Home.tsx",
      "sample-template/components/tokens.ts",
    ]);
  });

  it("discovers assets as base64 from the selected root", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-discover-"));
    const assetsRoot = join(root, ".agenticms", "assets", "demo");
    await mkdir(join(assetsRoot, "nested"), { recursive: true });
    await writeFile(join(assetsRoot, "nested", "demo.png"), "png");

    const files = await discoverAssetFiles(assetsRoot);

    expect(files).toEqual([{ path: "nested/demo.png", base64: Buffer.from("png").toString("base64") }]);
  });

  it("skips hidden paths and unsupported asset files before reading uploads", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-cli-discover-"));
    const assetsRoot = join(root, ".agenticms", "assets", "demo");
    await mkdir(join(assetsRoot, ".secret"), { recursive: true });
    await mkdir(join(assetsRoot, "nested"), { recursive: true });
    await writeFile(join(assetsRoot, ".env"), "secret");
    await writeFile(join(assetsRoot, ".secret", "demo.png"), "secret png");
    await writeFile(join(assetsRoot, "nested", "notes.txt"), "ignored text");
    await writeFile(join(assetsRoot, "nested", "demo.png"), "png");

    const files = await discoverAssetFiles(assetsRoot);

    expect(files).toEqual([{ path: "nested/demo.png", base64: Buffer.from("png").toString("base64") }]);
  });
});
