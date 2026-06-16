import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const loadCredential = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveSiteSelection,
}));

describe("migrateAssets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCredential.mockResolvedValue({
      adminUrl: "http://localhost:3001",
      credential: { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    resolveSiteSelection.mockResolvedValue({
      siteKey: "demo",
      layoutsRoot: "/project/.agenticms/layouts/demo",
      assetsRoot: "/project/.agenticms/assets/demo",
    });
    requestJson.mockResolvedValue({
      scanned: 2,
      migrated: 2,
      filesCopied: 1,
      filesAlreadyPresent: 1,
      missingFiles: [],
      contentUpdated: 3,
      layoutsUpdated: 1,
    });
  });

  it("posts to the site-scoped asset migration endpoint", async () => {
    const { migrateAssets } = await import("../src/migrate.js");

    await migrateAssets("http://localhost:3001", "/project", "demo");

    expect(resolveSiteSelection).toHaveBeenCalledWith("/project", "demo");
    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/assets/migrate-legacy",
      { method: "POST" },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });
});
