import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";

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

  it("renders GFM tables and images as unwrapped figures", async () => {
    const { markdownToHtml } = await import("../src/posts.js");
    const html = markdownToHtml("| Route | Stops |\n| --- | --- |\n| A | 4 |\n\n![Sky](./sky.png \"Aerial view\")\n\n![Plain](./plain.png)");

    expect(html).toContain("<table>");
    expect(html).toContain("<th>Route</th>");
    expect(html).toContain('<figure><img src="./sky.png" alt="Sky"><figcaption>Aerial view</figcaption></figure>');
    expect(html).toContain('<figure><img src="./plain.png" alt="Plain"></figure>');
    expect(html).not.toContain("<p><figure>");
  });

  it("renders image-only paragraphs as figures without paragraph wrappers", async () => {
    const { markdownToHtml } = await import("../src/posts.js");
    const html = markdownToHtml("![One](./one.png) \n![Two](./two.png)");

    expect(html).toBe('<figure><img src="./one.png" alt="One"></figure><figure><img src="./two.png" alt="Two"></figure>');
    expect(markdownToHtml("![One](./one.png)  \n![Two](./two.png)")).toBe('<figure><img src="./one.png" alt="One"></figure><figure><img src="./two.png" alt="Two"></figure>');
    expect(markdownToHtml("Before ![Inline](./inline.png) after")).toBe('<p>Before <img src="./inline.png" alt="Inline"> after</p>\n');
  });

  it("contains a decodable PNG fixture", async () => {
    const fixture = new URL("./fixtures/posts/image.png", import.meta.url);
    const bytes = await readFile(fixture);
    const idat: Buffer[] = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
      const chunk = bytes.subarray(offset + 4, offset + 8 + length);
      let crc = 0xffffffff;
      for (const byte of chunk) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      expect(bytes.readUInt32BE(offset + 8 + length)).toBe((crc ^ 0xffffffff) >>> 0);
      if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    expect(inflateSync(Buffer.concat(idat))).toHaveLength(5);
  });

  it("refuses media outside the Markdown directory", async () => {
    const { collectMedia } = await import("../src/posts.js");
    const file = new URL("./fixtures/posts/example.md", import.meta.url).pathname;

    await expect(collectMedia(file, ["../outside.png"])).rejects.toThrow("escapes Markdown directory");
  });

  it("uploads a repeated image only once", async () => {
    const { collectMedia } = await import("../src/posts.js");
    const file = new URL("./fixtures/posts/example.md", import.meta.url).pathname;

    await expect(collectMedia(file, ["./image.png", "./image.png"])).resolves.toHaveLength(1);
  });

  it("refuses file and directory symlinks that escape the Markdown directory", async () => {
    const { collectMedia } = await import("../src/posts.js");
    const root = await mkdtemp(join(tmpdir(), "agenticms-post-media-"));
    const posts = join(root, "posts");
    const outside = join(root, "outside");
    const post = join(posts, "post.md");
    await Promise.all([
      mkdir(posts),
      mkdir(outside),
    ]);
    await Promise.all([
      writeFile(post, ""),
      writeFile(join(outside, "image.png"), "outside"),
    ]).catch(async (error) => {
      await rm(root, { recursive: true, force: true });
      throw error;
    });
    try {
      await symlink(join(outside, "image.png"), join(posts, "file-link.png"));
      await symlink(outside, join(posts, "directory-link"));
      await expect(collectMedia(post, ["./file-link.png"])).rejects.toThrow("escapes Markdown directory");
      await expect(collectMedia(post, ["./directory-link/image.png"])).rejects.toThrow("escapes Markdown directory");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
      cover: "agenticms-media-1",
    });
    expect(body.media).toHaveLength(1);
    expect(body.media[0]).toMatchObject({ ref: "agenticms-media-1", name: "image.png" });
    expect(body.files[0].html).toContain('src="agenticms-media-1"');
    expect(body.files[0].cover).toBe("agenticms-media-1");
  });

  it("gives different same-named images distinct refs across pushed files", async () => {
    const { pushPosts } = await import("../src/posts.js");
    const root = await mkdtemp(join(tmpdir(), "agenticms-post-push-"));
    const first = join(root, "a");
    const second = join(root, "b");
    const source = (key: string) => `---\nkey: ${key}\nlocale: de\ncategory: playbooks\ntitle: ${key}\nslug: ${key}\ncover: ./image.png\n---\n![${key}](./image.png)`;
    await Promise.all([
      mkdir(first),
      mkdir(second),
    ]);
    await Promise.all([
      writeFile(join(first, "post.md"), source("first")),
      writeFile(join(first, "second.md"), source("first-again")),
      writeFile(join(second, "post.md"), source("second")),
      writeFile(join(first, "image.png"), "first"),
      writeFile(join(second, "image.png"), "second"),
    ]).catch(async (error) => {
      await rm(root, { recursive: true, force: true });
      throw error;
    });
    try {
      await pushPosts("http://localhost:3001", "/project", "demo", [join(first, "post.md"), join(first, "second.md"), join(second, "post.md")], false);
      const body = JSON.parse(requestJson.mock.calls[0][2].body);
      expect(body.media).toHaveLength(2);
      expect(body.media.map((item: { ref: string }) => item.ref)).toEqual(["agenticms-media-1", "agenticms-media-2"]);
      expect(body.files[0]).toMatchObject({ cover: "agenticms-media-1" });
      expect(body.files[0].html).toContain('src="agenticms-media-1"');
      expect(body.files[1]).toMatchObject({ cover: "agenticms-media-1" });
      expect(body.files[1].html).toContain('src="agenticms-media-1"');
      expect(body.files[2]).toMatchObject({ cover: "agenticms-media-2" });
      expect(body.files[2].html).toContain('src="agenticms-media-2"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a generated ref colliding with a Markdown href", async () => {
    const { buildPushPayload } = await import("../src/posts.js");
    const root = await mkdtemp(join(tmpdir(), "agenticms-post-refs-"));
    const source = `---\nkey: refs\nlocale: de\ncategory: playbooks\ntitle: refs\nslug: refs\ncover: ./a&b.png\n---\n![Escaped](./a&b.png) [Collision](agenticms-media-1) ![Literal](./media-1.png) ![Second](./second.png)`;
    try {
      await Promise.all([
        writeFile(join(root, "post.md"), source),
        writeFile(join(root, "a&b.png"), "first"),
        writeFile(join(root, "agenticms-media-1"), "second"),
        writeFile(join(root, "media-1.png"), "third"),
        writeFile(join(root, "second.png"), "fourth"),
      ]);
      await expect(buildPushPayload([join(root, "post.md")], false)).rejects.toThrow("Generated media ref collides with Markdown href: agenticms-media-1");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
