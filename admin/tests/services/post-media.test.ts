import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { detectImageType, PostMediaError, postMediaDiskPath, referencedMediaUrls, storePostMedia } from "../../src/services/blog/post-media.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const images = [
  ["png", png],
  ["jpeg", Buffer.from("ffd8ffe000104a464946", "hex")],
  ["webp", Buffer.from("52494646100000005745425056503820", "hex")],
  ["gif", Buffer.from("GIF89a")],
] as const;
const records: { op?: string; level: number; msg: string }[] = [];
const logger = pino({ level: "debug" }, { write: (line: string) => records.push(JSON.parse(line)) });
let app: FastifyInstance;
let auth: string;
let postId: string;

beforeAll(async () => {
  app = await buildApp({ logger });
  await app.ready();
  const site = await app.prisma.site.create({ data: { key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de" } });
  await app.prisma.site.create({ data: { key: "other", name: "Other", domain: "other.test", stagingDomain: "staging.other.test", defaultLocale: "de" } });
  const page = await app.prisma.page.create({ data: { siteId: site.id, path: "/news" } });
  const layout = await app.prisma.layout.create({ data: { siteId: site.id, name: "Post", filePath: "Post.tsx", kind: "post" } });
  const category = await app.prisma.blogCategory.create({ data: { siteId: site.id, key: "news", pageId: page.id, defaultLayoutId: layout.id } });
  const post = await app.prisma.blogPost.create({ data: { siteId: site.id, key: "first-post", categoryId: category.id } });
  postId = post.id;
  const { user } = await createTestUser(app, { role: "editor" });
  auth = `Bearer ${getAccessToken(user)}`;
});
beforeEach(async () => {
  await fs.rm(config.POST_MEDIA_DIR, { recursive: true, force: true });
  records.length = 0;
});
afterAll(async () => {
  await app?.close();
  await fs.rm(config.POST_MEDIA_DIR, { recursive: true, force: true });
});

function upload(buf: Buffer, filename = "Screenshot.PNG", site = "demo", key = "first-post", authenticated = true) {
  const boundary = "post-media-test-boundary";
  return app.inject({
    method: "POST", url: `/api/sites/${site}/blog/posts/${key}/media`,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}`, ...(authenticated ? { authorization: auth } : {}) },
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/html\r\n\r\n`),
      buf, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
}

describe("private post media", () => {
  it.each(images)("detects %s by magic bytes", (type, bytes) => {
    expect(detectImageType(bytes)).toBe(type);
  });
  it("rejects SVG, PNG-named text and truncated signatures", async () => {
    for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.from("not a PNG"), png.subarray(0, 7), Buffer.from("RIFF")]) {
      expect(detectImageType(bytes)).toBeNull();
      await expect(storePostMedia("demo", "first-post", "fake.png", bytes, logger)).rejects.toBeInstanceOf(PostMediaError);
    }
    expect(detectImageType(Buffer.from("GIF87a"))).toBe("gif");
  });
  it("reuses the immutable content address without rewriting the file", async () => {
    const url = await storePostMedia("demo", "first-post", "Screen Shot.SVG", png, logger);
    const hash = createHash("sha256").update(png).digest("hex").slice(0, 12);
    expect(url).toBe(`/media/first-post/${hash}-screen-shot.png`);
    const diskPath = postMediaDiskPath("demo", url)!;
    await fs.utimes(diskPath, new Date(0), new Date(0));
    expect(await storePostMedia("demo", "first-post", "Screen Shot.SVG", png, logger)).toBe(url);
    expect((await fs.stat(diskPath)).mtimeMs).toBe(0);
    expect(await fs.readdir(path.dirname(diskPath))).toEqual([path.basename(url)]);
    expect(await fs.readFile(diskPath)).toEqual(png);
    expect(records.some((r) => r.level === 30 && r.msg.includes("NO-OP"))).toBe(true);
  });
  it("stores changed bytes separately and isolates sites", async () => {
    const first = await storePostMedia("demo", "first-post", "photo.png", png, logger);
    const second = await storePostMedia("demo", "first-post", "photo.png", Buffer.concat([png, Buffer.from("changed")]), logger);
    expect(first).not.toBe(second);
    expect(await fs.readdir(path.dirname(postMediaDiskPath("demo", first)!))).toHaveLength(2);
    expect(postMediaDiskPath("other", first)).not.toBe(postMediaDiskPath("demo", first));
  });
  it("rejects a truncated file at an existing content address without overwriting it", async () => {
    const hash = createHash("sha256").update(png).digest("hex").slice(0, 12);
    const diskPath = postMediaDiskPath("demo", `/media/first-post/${hash}-photo.png`)!;
    await fs.mkdir(path.dirname(diskPath), { recursive: true });
    await fs.writeFile(diskPath, png.subarray(0, 8));
    await expect(storePostMedia("demo", "first-post", "photo.png", png, logger)).rejects.toThrow("hash mismatch");
    expect(await fs.readFile(diskPath)).toEqual(png.subarray(0, 8));
    expect(await fs.readdir(path.dirname(diskPath))).toEqual([path.basename(diskPath)]);
    expect(records.some((r) => r.level === 40 && r.op === "blog.media.store" && r.msg.includes("hash mismatch"))).toBe(true);
  });
  it("does not publish a partial write and removes its temporary file", async () => {
    const writeFile = fs.writeFile.bind(fs);
    const failure = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const write = vi.spyOn(fs, "writeFile").mockImplementationOnce(async (file, _data, options) => {
      await writeFile(file, png.subarray(0, 8), options);
      throw failure;
    });
    try {
      await expect(storePostMedia("demo", "first-post", "photo.png", png, logger)).rejects.toBe(failure);
    } finally {
      write.mockRestore();
    }
    expect(await fs.readdir(path.resolve(config.POST_MEDIA_DIR, "demo/first-post"))).toEqual([]);
    const url = await storePostMedia("demo", "first-post", "photo.png", png, logger);
    expect(await fs.readFile(postMediaDiskPath("demo", url)!)).toEqual(png);
  });
  it("publishes full content for concurrent identical uploads", async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(1024 * 1024, 42)]);
    const urls = await Promise.all([
      storePostMedia("demo", "first-post", "photo.png", bytes, logger),
      storePostMedia("demo", "first-post", "photo.png", bytes, logger),
    ]);
    expect(urls[0]).toBe(urls[1]);
    const diskPath = postMediaDiskPath("demo", urls[0])!;
    expect(await fs.readFile(diskPath)).toEqual(bytes);
    expect(await fs.readdir(path.dirname(diskPath))).toEqual([path.basename(diskPath)]);
  });
  it("caps a long multipart filename stem at 60 characters", async () => {
    const response = await upload(png, `${"A".repeat(300)}.svg`);
    expect(response.statusCode).toBe(201);
    const { url } = response.json();
    expect(url).toMatch(new RegExp(`^/media/first-post/[a-f0-9]{12}-${"a".repeat(60)}\\.png$`));
    expect(await fs.readFile(postMediaDiskPath("demo", url)!)).toEqual(png);
  });
  it("confines paths to the site and rejects traversal including encoded paths", async () => {
    for (const url of ["/media/../../etc/passwd", "/media/../demo-other/file.png", "/media/%2e%2e/secret.png", "/media/post/../../secret.png", "/media/post/..\\secret.png", "/media/post/a.png\0", "/assets/post/a.png", "/media//etc/passwd"]) {
      expect(postMediaDiskPath("demo", url)).toBeNull();
    }
    expect(postMediaDiskPath("../demo", "/media/post/a.png")).toBeNull();
    expect(postMediaDiskPath("demo", "/media/post/a.png")).toBe(path.resolve(config.POST_MEDIA_DIR, "demo/post/a.png"));
    expect(postMediaDiskPath("demo--", "/media/post/a.png")).toBe(path.resolve(config.POST_MEDIA_DIR, "demo--/post/a.png"));
    await expect(storePostMedia("demo", "../escape", "x.png", png, logger)).rejects.toBeInstanceOf(PostMediaError);
  });
  it.each(["/media/post/.x.tmp", "/media/post/.keep", "/media/.hidden/a.png", "/media/post/.hidden/a.png"])("rejects dot-prefixed path segments: %s", (url) => {
    expect(postMediaDiskPath("demo", url)).toBeNull();
  });
  it("collects unique body image and cover media references using HTML parsing", () => {
    expect(referencedMediaUrls('<img src="/media/post/a.png"><IMG SRC=/media/post/b.png><img src="/media/post/a.png"><img src="/assets/a.png"><a href="/media/post/link.png">Link</a><!-- <img src="/media/post/comment.png"> -->', "/media/post/cover.png"))
      .toEqual(["/media/post/a.png", "/media/post/b.png", "/media/post/cover.png"]);
    expect(referencedMediaUrls('<img src="/media/post/a.png">', "/media/post/a.png")).toEqual(["/media/post/a.png"]);
    expect(referencedMediaUrls("", null)).toEqual([]);
    expect(referencedMediaUrls("", "/assets/cover.png")).toEqual([]);
  });
  it("rejects encoded and double-encoded traversal through the HTTP route", async () => {
    for (const traversal of ["..%2f..%2fetc%2fpasswd", "%252e%252e%252f%252e%252e%252fetc%252fpasswd"]) {
      const response = await app.inject({ method: "GET", url: `/api/sites/demo/blog/media/${traversal}`, headers: { authorization: auth } });
      expect([400, 404]).toContain(response.statusCode);
    }
  });
  it.each(images)("uploads and serves %s only through authenticated media routes", async (type, bytes) => {
    const response = await upload(bytes);
    expect(response.statusCode).toBe(201);
    const { url } = response.json();
    expect(url).toMatch(new RegExp(`^/media/first-post/[a-f0-9]{12}-screenshot\\.${type}$`));
    const endpoint = `/api/sites/demo/blog${url}`;
    expect((await app.inject({ method: "GET", url: endpoint })).statusCode).toBe(401);
    const media = await app.inject({ method: "GET", url: endpoint, headers: { authorization: auth } });
    expect(media.statusCode).toBe(200);
    expect(media.headers["content-type"]).toBe(`image/${type}`);
    expect(media.headers["x-content-type-options"]).toBe("nosniff");
    expect(media.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(media.headers["cache-control"]).toBe("private, no-store");
    expect(media.rawPayload).toEqual(bytes);
    expect((await app.inject({ method: "GET", url })).rawPayload).not.toEqual(bytes);
    expect((await app.inject({ method: "GET", url: `/assets/demo${url}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/api/sites/other/blog${url}`, headers: { authorization: auth } })).statusCode).toBe(404);
  });
  it("rejects missing/foreign posts, ids instead of keys and unauthenticated uploads", async () => {
    expect((await upload(png, "x.png", "demo", "missing")).statusCode).toBe(404);
    expect((await upload(png, "x.png", "other")).statusCode).toBe(404);
    expect((await upload(png, "x.png", "missing")).statusCode).toBe(404);
    expect((await upload(png, "x.png", "demo", postId)).statusCode).toBe(404);
    expect((await upload(png, "x.png", "demo", "first-post", false)).statusCode).toBe(401);
    await expect(fs.stat(config.POST_MEDIA_DIR)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rejects unsupported and oversized uploads before writing", async () => {
    expect((await upload(Buffer.from("<svg/>"), "fake.png")).statusCode).toBe(415);
    expect((await upload(Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]))).statusCode).toBe(413);
    await expect(fs.stat(config.POST_MEDIA_DIR)).rejects.toMatchObject({ code: "ENOENT" });
    expect(records.some((r) => r.level === 40 && r.op === "blog.media.upload")).toBe(true);
  });
  it("rejects a multipart request with no file", async () => {
    const response = await app.inject({ method: "POST", url: "/api/sites/demo/blog/posts/first-post/media", headers: { authorization: auth, "content-type": "multipart/form-data; boundary=empty" }, payload: "--empty--\r\n" });
    expect(response.statusCode).toBe(400);
  });
});
