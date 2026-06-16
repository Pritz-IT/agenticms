import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const discoverLayoutFiles = vi.fn();
const loadCredential = vi.fn();
const resolveGlobalLayoutSelection = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/discover.js", () => ({
  discoverLayoutFiles,
  discoverAssetFiles: vi.fn(),
}));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveGlobalLayoutSelection,
  resolveSiteSelection,
}));

describe("syncLayouts global mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCredential.mockResolvedValue({
      adminUrl: "http://localhost:3001",
      credential: { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    resolveGlobalLayoutSelection.mockResolvedValue({
      globalLayoutsRoot: "/project/.agenticms/layouts/_global",
    });
    resolveSiteSelection.mockResolvedValue({
      siteKey: "demo",
      layoutsRoot: "/project/.agenticms/layouts/demo",
      assetsRoot: "/project/.agenticms/assets/demo",
    });
    discoverLayoutFiles.mockResolvedValue([{ path: "Home.tsx", content: "home" }]);
    requestJson.mockResolvedValue({ templates: [{ key: "sample-template/Home.tsx", status: "registered" }] });
  });

  it("posts template-scoped files to the global layout sync endpoint", async () => {
    const { syncLayouts } = await import("../src/sync.js");

    await syncLayouts("http://localhost:3001", "/project", "demo", {
      global: true,
      template: "sample-template",
    });

    expect(resolveSiteSelection).not.toHaveBeenCalled();
    expect(discoverLayoutFiles).toHaveBeenCalledWith("/project/.agenticms/layouts/_global/sample-template");
    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/cli/sync/global-layouts",
      {
        method: "POST",
        body: JSON.stringify({ files: [{ path: "sample-template/Home.tsx", content: "home" }] }),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("rejects traversal template keys before discovering or posting global layouts", async () => {
    const { syncLayouts } = await import("../src/sync.js");

    await expect(
      syncLayouts(undefined, "/project", undefined, {
        global: true,
        template: "../../outside",
      })
    ).rejects.toThrow(/Invalid global layout template key/);

    expect(discoverLayoutFiles).not.toHaveBeenCalled();
    expect(requestJson).not.toHaveBeenCalled();
  });
});
