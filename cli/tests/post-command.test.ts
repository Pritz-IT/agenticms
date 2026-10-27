import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const loadCredential = vi.fn();
const resolveSiteSelection = vi.fn();

vi.mock("../src/http.js", () => ({ requestJson }));
vi.mock("../src/config.js", () => ({
  loadCredential,
  resolveSiteSelection,
}));

describe("post command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadCredential.mockResolvedValue({
      adminUrl: "http://localhost:3001",
      credential: { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" },
    });
    resolveSiteSelection.mockResolvedValue({ siteKey: "demo" });
    requestJson.mockResolvedValue({ posts: [{ key: "routing", locale: "de", action: "created" }] });
  });

  it("parses flat frontmatter, preserving colons and inline tags", async () => {
    const { parsePostFile } = await import("../src/posts.js");

    expect(parsePostFile("post.md", "---\nkey: routing\nlocale: de\ncategory: playbooks\ntags: [industry, metaheuristics]\ntitle: Planning: faster\nslug: planning\n---\nBody").meta).toMatchObject({
      title: "Planning: faster",
      tags: ["industry", "metaheuristics"],
    });
  });

  it("names the source file when required frontmatter is missing", async () => {
    const { parsePostFile } = await import("../src/posts.js");

    expect(() => parsePostFile("missing-slug.md", "---\nkey: routing\nlocale: de\ncategory: playbooks\ntitle: Planning\n---\nBody"))
      .toThrow("missing-slug.md: missing required frontmatter: slug");
  });

  it("renders GFM tables and titled images as figures", async () => {
    const { markdownToHtml } = await import("../src/posts.js");
    const html = markdownToHtml("| Route | Stops |\n| --- | --- |\n| A | 4 |\n\n![Sky](./sky.png \"Aerial view\")");

    expect(html).toContain("<table>");
    expect(html).toContain("<th>Route</th>");
    expect(html).toContain('<figure><img src="./sky.png" alt="Sky"><figcaption>Aerial view</figcaption></figure>');
  });

  it("refuses media outside the Markdown directory", async () => {
    const { collectMedia } = await import("../src/posts.js");

    await expect(collectMedia("/project/posts/post.md", ["../outside.png"])).rejects.toThrow("escapes Markdown directory");
  });

  it("uploads a repeated image only once", async () => {
    const { collectMedia } = await import("../src/posts.js");
    const file = new URL("./fixtures/posts/example.md", import.meta.url).pathname;

    await expect(collectMedia(file, ["./image.png", "./image.png"])).resolves.toHaveLength(1);
  });

  it("pushes parsed files in the server request shape", async () => {
    const { pushPosts } = await import("../src/posts.js");
    const file = new URL("./fixtures/posts/example.md", import.meta.url).pathname;

    await pushPosts("http://localhost:3001", "/project", "demo", [file], true);

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/posts/push",
      {
        method: "POST",
        body: expect.stringMatching(/^\{"draft":true,"files":\[/),
      },
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
    const body = JSON.parse(requestJson.mock.calls[0][2].body);
    expect(body.files[0]).toMatchObject({
      source: file,
      key: "routing",
      locale: "de",
      category: "playbooks",
      tags: ["industry", "metaheuristics"],
      layout: null,
      title: "School bus routing: a practical guide",
      slug: "school-bus-routing",
      excerpt: "A short guide.",
      cover: "./image.png",
    });
    expect(body.media).toHaveLength(1);
    expect(body.media[0]).toMatchObject({ ref: "./image.png", name: "image.png" });
  });

  it("lists posts for the selected site", async () => {
    requestJson.mockResolvedValue([]);
    const { listPosts } = await import("../src/posts.js");

    await listPosts("http://localhost:3001", "/project", "demo");

    expect(requestJson).toHaveBeenCalledWith(
      "http://localhost:3001",
      "/api/sites/demo/cli/posts",
      {},
      { token: "token", expiresAt: "2099-01-01T00:00:00.000Z" }
    );
  });
});
