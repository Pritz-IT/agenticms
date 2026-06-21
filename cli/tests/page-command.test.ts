import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const loadCredential = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveSiteSelection,
}));

describe("page command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCredential.mockResolvedValue({
      adminUrl: "http://localhost:3001",
      credential: { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    resolveSiteSelection.mockResolvedValue({
      siteKey: "demo",
      layoutsRoot: "/project/layouts",
      assetsRoot: "/project/assets",
    });
    requestJson.mockResolvedValue([]);
  });

  it("parses page create flags", async () => {
    const { parsePageCreateArgs } = await import("../src/pages.js");

    expect(parsePageCreateArgs([
      "--path", "/cms",
      "--layout", "agenticms/Home.tsx",
      "--sort-order", "5",
      "--published",
    ])).toEqual({
      path: "/cms",
      layout: "agenticms/Home.tsx",
      sortOrder: 5,
      isPublished: true,
    });
  });

  it("lists pages for the selected site", async () => {
    requestJson.mockResolvedValue([{ path: "/", layout: null }]);
    const { listPages } = await import("../src/pages.js");

    await listPages("http://localhost:3001", "/project", "demo");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/pages",
      {},
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("creates a page for the selected site", async () => {
    requestJson.mockResolvedValue({ id: "page_1", path: "/cms", isPublished: true });
    const { createPage, parsePageCreateArgs } = await import("../src/pages.js");

    await createPage("http://localhost:3001", "/project", "demo", parsePageCreateArgs([
      "--path", "/cms",
      "--layout", "agenticms/Home.tsx",
      "--published",
    ]));

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/pages",
      {
        method: "POST",
        body: JSON.stringify({
          path: "/cms",
          layout: "agenticms/Home.tsx",
          isPublished: true,
        }),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("updates a page and can clear the layout", async () => {
    requestJson.mockResolvedValue({ id: "page_1", path: "/cms", layoutId: null });
    const { parsePageUpdateArgs, updatePage } = await import("../src/pages.js");

    await updatePage("http://localhost:3001", "/project", "demo", parsePageUpdateArgs([
      "--id", "page_1",
      "--path", "/cms",
      "--layout", "",
      "--draft",
    ]));

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/pages/page_1",
      {
        method: "PATCH",
        body: JSON.stringify({
          path: "/cms",
          layout: null,
          isPublished: false,
        }),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("deletes a page by id", async () => {
    const { deletePage } = await import("../src/pages.js");

    await deletePage("http://localhost:3001", "/project", "demo", "page_1");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/pages/page_1",
      { method: "DELETE" },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("rejects missing create path before network access", async () => {
    const { parsePageCreateArgs } = await import("../src/pages.js");

    expect(() => parsePageCreateArgs(["--layout", "Home.tsx"])).toThrow("page create requires --path");
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("parses the delete id and rejects a flag consumed as the id", async () => {
    const { parsePageDeleteArgs } = await import("../src/pages.js");

    expect(parsePageDeleteArgs(["--id", "page_1"])).toEqual({ id: "page_1" });
    expect(() => parsePageDeleteArgs(["--id", "--site"])).toThrow("--id requires a value");
    expect(() => parsePageDeleteArgs([])).toThrow("page delete requires --id");
  });
});
