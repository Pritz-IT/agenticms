import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const loadCredential = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveSiteSelection,
}));

describe("parseFormArgs", () => {
  it("parses --form", async () => {
    const { parseFormArgs } = await import("../src/forms.js");
    expect(parseFormArgs(["--form", "contact"])).toEqual({ form: "contact" });
  });
  it("throws without --form", async () => {
    const { parseFormArgs } = await import("../src/forms.js");
    expect(() => parseFormArgs([])).toThrow(/requires --form/);
  });
  it("throws on unknown option", async () => {
    const { parseFormArgs } = await import("../src/forms.js");
    expect(() => parseFormArgs(["--nope", "x"])).toThrow(/Unknown/);
  });
});

describe("forms command", () => {
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
    requestJson.mockResolvedValue({ forms: [] });
  });

  it("lists forms for the selected site", async () => {
    requestJson.mockResolvedValue({ forms: ["contact"] });
    const { listForms } = await import("../src/forms.js");

    await listForms("http://localhost:3001", "/project", "demo");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/forms",
      {},
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("adds a form for the selected site", async () => {
    requestJson.mockResolvedValue({ forms: ["contact"] });
    const { addForm } = await import("../src/forms.js");

    await addForm("http://localhost:3001", "/project", "demo", "contact");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/forms",
      { method: "POST", body: JSON.stringify({ form: "contact" }) },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });

  it("removes a form by URL-encoded slug", async () => {
    requestJson.mockResolvedValue({ forms: [] });
    const { removeForm } = await import("../src/forms.js");

    await removeForm("http://localhost:3001", "/project", "demo", "a/b");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/forms/a%2Fb",
      { method: "DELETE" },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });
});
