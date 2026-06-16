import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const discoverAssetFiles = vi.fn();
const loadCredential = vi.fn();
const resolveGlobalAssetSelection = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/discover.js", () => ({
  discoverLayoutFiles: vi.fn(),
  discoverAssetFiles,
}));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveGlobalAssetSelection,
  resolveGlobalLayoutSelection: vi.fn(),
  resolveSiteSelection,
}));

describe("syncAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCredential.mockResolvedValue({
      adminUrl: "http://localhost:3001",
      credential: { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    resolveSiteSelection.mockResolvedValue({
      siteKey: "demo",
      layoutsRoot: "/project/.agenticms/layouts/demo",
      assetsRoot: "/project/.agenticms/assets",
    });
    resolveGlobalAssetSelection.mockResolvedValue({
      globalAssetsRoot: "/project/.agenticms/assets/_global",
    });
    discoverAssetFiles.mockResolvedValue([]);
    requestJson.mockResolvedValue({
      files: [{ path: "asset.png", status: "written" }],
      assetSync: { scanned: 1, created: 1, already: 0, skipped: 0 },
    });
  });

  it("splits large asset uploads into multiple site-scoped requests", async () => {
    const largeBase64 = "x".repeat(18 * 1024 * 1024);
    discoverAssetFiles.mockResolvedValue([
      { path: "one.png", base64: largeBase64 },
      { path: "two.png", base64: largeBase64 },
    ]);
    const { syncAssets } = await import("../src/sync.js");

    await syncAssets("http://localhost:3001", "/project", "demo");

    expect(resolveGlobalAssetSelection).not.toHaveBeenCalled();
    expect(requestJson).toHaveBeenCalledTimes(2);
    expect(requestJson).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001",
      "/api/sites/demo/cli/sync/assets",
      { method: "POST", body: JSON.stringify({ files: [{ path: "one.png", base64: largeBase64 }] }) },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001",
      "/api/sites/demo/cli/sync/assets",
      { method: "POST", body: JSON.stringify({ files: [{ path: "two.png", base64: largeBase64 }] }) },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("posts global asset files to the global asset sync endpoint", async () => {
    discoverAssetFiles.mockResolvedValue([
      { path: "shared/logo.svg", base64: "logo" },
      { path: "templates/sample-template/hero.webp", base64: "hero" },
    ]);
    requestJson.mockResolvedValue({
      files: [
        { path: "shared/logo.svg", status: "written" },
        { path: "templates/sample-template/hero.webp", status: "written" },
      ],
      assetSync: { scanned: 2, created: 2, already: 0, skipped: 0 },
    });
    const { syncAssets } = await import("../src/sync.js");

    await syncAssets("http://localhost:3001", "/project", "demo", { global: true });

    expect(resolveSiteSelection).not.toHaveBeenCalled();
    expect(discoverAssetFiles).toHaveBeenCalledWith("/project/.agenticms/assets/_global");
    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/cli/sync/global-assets",
      {
        method: "POST",
        body: JSON.stringify({
          files: [
            { path: "shared/logo.svg", base64: "logo" },
            { path: "templates/sample-template/hero.webp", base64: "hero" },
          ],
        }),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("prefixes template-scoped global asset files with the template path", async () => {
    discoverAssetFiles.mockResolvedValue([{ path: "hero.webp", base64: "hero" }]);
    const { syncAssets } = await import("../src/sync.js");

    await syncAssets("http://localhost:3001", "/project", "demo", {
      global: true,
      template: "sample-template",
    });

    expect(resolveSiteSelection).not.toHaveBeenCalled();
    expect(discoverAssetFiles).toHaveBeenCalledWith("/project/.agenticms/assets/_global/templates/sample-template");
    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/cli/sync/global-assets",
      {
        method: "POST",
        body: JSON.stringify({ files: [{ path: "templates/sample-template/hero.webp", base64: "hero" }] }),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("rejects unsafe global asset template keys before discovery or upload", async () => {
    const { syncAssets } = await import("../src/sync.js");

    await expect(syncAssets("http://localhost:3001", "/project", "demo", {
      global: true,
      template: "../shared",
    })).rejects.toThrow("Invalid global asset template key");

    expect(loadCredential).not.toHaveBeenCalled();
    expect(discoverAssetFiles).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("keeps normal asset sync site-scoped", async () => {
    discoverAssetFiles.mockResolvedValue([{ path: "asset.png", base64: "asset" }]);
    const { syncAssets } = await import("../src/sync.js");

    await syncAssets("http://localhost:3001", "/project", "demo");

    expect(resolveSiteSelection).toHaveBeenCalledWith("/project", "demo");
    expect(discoverAssetFiles).toHaveBeenCalledWith("/project/.agenticms/assets");
    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/sync/assets",
      { method: "POST", body: JSON.stringify({ files: [{ path: "asset.png", base64: "asset" }] }) },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });
});
