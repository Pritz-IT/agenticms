import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveGlobalAssetSelection, resolveGlobalLayoutSelection, resolveSiteSelection } from "../src/config";

describe("resolveSiteSelection", () => {
  it("uses explicit --site before site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(join(root, ".agenticms", "site.json"), JSON.stringify({ site: "demo" }));

    await expect(resolveSiteSelection(root, "agenticms")).resolves.toMatchObject({
      siteKey: "agenticms",
    });
  });

  it("reads per-site roots from site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(
      join(root, ".agenticms", "site.json"),
      JSON.stringify({
        site: "demo",
        sites: { demo: { layouts: "layouts/demo", assets: "assets/demo" } },
      })
    );

    await expect(resolveSiteSelection(root)).resolves.toEqual({
      siteKey: "demo",
      layoutsRoot: join(root, ".agenticms", "layouts", "demo"),
      assetsRoot: join(root, ".agenticms", "assets", "demo"),
    });
  });

  it("supports a root-level AgentiCMS workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await writeFile(
      join(root, "site.json"),
      JSON.stringify({
        site: "acme",
        sites: { acme: { layouts: "layouts/acme", assets: "assets" } },
      })
    );

    await expect(resolveSiteSelection(root)).resolves.toEqual({
      siteKey: "acme",
      layoutsRoot: join(root, "layouts", "acme"),
      assetsRoot: join(root, "assets"),
    });
  });

  it("prefers root-level site.json over legacy .agenticms/site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(join(root, ".agenticms", "site.json"), JSON.stringify({ site: "legacy" }));
    await writeFile(join(root, "site.json"), JSON.stringify({ site: "root" }));

    await expect(resolveSiteSelection(root)).resolves.toMatchObject({
      siteKey: "root",
      layoutsRoot: join(root, "layouts"),
      assetsRoot: join(root, "assets"),
    });
  });

  it("rejects configured roots that escape .agenticms", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(
      join(root, ".agenticms", "site.json"),
      JSON.stringify({
        site: "demo",
        sites: { demo: { layouts: "../../../", assets: "assets/demo" } },
      })
    );

    await expect(resolveSiteSelection(root)).rejects.toThrow("root escapes AgentiCMS workspace");
  });
});

describe("resolveGlobalLayoutSelection", () => {
  it("uses .agenticms/layouts/_global by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));

    await expect(resolveGlobalLayoutSelection(root)).resolves.toEqual({
      globalLayoutsRoot: join(root, ".agenticms", "layouts", "_global"),
    });
  });

  it("reads global layout root from site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(
      join(root, ".agenticms", "site.json"),
      JSON.stringify({ site: "demo", globalLayouts: "templates/global" })
    );

    await expect(resolveGlobalLayoutSelection(root)).resolves.toEqual({
      globalLayoutsRoot: join(root, ".agenticms", "templates", "global"),
    });
  });

  it("reads root-level global layout root from site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await writeFile(join(root, "site.json"), JSON.stringify({ site: "demo", globalLayouts: "layouts/_global" }));

    await expect(resolveGlobalLayoutSelection(root)).resolves.toEqual({
      globalLayoutsRoot: join(root, "layouts", "_global"),
    });
  });

  it("rejects global layout roots that escape .agenticms", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(join(root, ".agenticms", "site.json"), JSON.stringify({ globalLayouts: "../outside" }));

    await expect(resolveGlobalLayoutSelection(root)).rejects.toThrow("global layouts root escapes AgentiCMS workspace");
  });
});

describe("resolveGlobalAssetSelection", () => {
  it("uses .agenticms/assets/_global by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));

    await expect(resolveGlobalAssetSelection(root)).resolves.toEqual({
      globalAssetsRoot: join(root, ".agenticms", "assets", "_global"),
    });
  });

  it("reads global asset root from site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(
      join(root, ".agenticms", "site.json"),
      JSON.stringify({ site: "demo", globalAssets: "assets/shared-global" })
    );

    await expect(resolveGlobalAssetSelection(root)).resolves.toEqual({
      globalAssetsRoot: join(root, ".agenticms", "assets", "shared-global"),
    });
  });

  it("reads root-level global asset root from site.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await writeFile(join(root, "site.json"), JSON.stringify({ site: "demo", globalAssets: "assets/_global" }));

    await expect(resolveGlobalAssetSelection(root)).resolves.toEqual({
      globalAssetsRoot: join(root, "assets", "_global"),
    });
  });

  it("rejects global asset roots that escape .agenticms", async () => {
    const root = await mkdtemp(join(tmpdir(), "sf-site-"));
    await mkdir(join(root, ".agenticms"), { recursive: true });
    await writeFile(join(root, ".agenticms", "site.json"), JSON.stringify({ globalAssets: "../outside" }));

    await expect(resolveGlobalAssetSelection(root)).rejects.toThrow("global assets root escapes AgentiCMS workspace");
  });
});
