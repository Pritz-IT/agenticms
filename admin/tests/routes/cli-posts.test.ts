import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import type { Site } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { sha256 } from "../../src/services/cli-auth.js";
import * as posts from "../../src/services/blog/posts.js";
import * as mediaService from "../../src/services/blog/post-media.js";
import { createTestUser } from "../helpers/auth.js";

let app: FastifyInstance;
let site: Site;
const records: { op?: string; level: number; msg: string; issues?: unknown[] }[] = [];
const token = "sfcli_post-push-test";
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const media = [{ ref: "./img/a.png", name: "Screen Shot.PNG", base64: png.toString("base64") }];
const file = (overrides = {}) => ({ source: "routing.de.md", key: "routing", locale: "de", category: "news", tags: ["transport"], layout: null,
  title: "Routing", slug: "routing", excerpt: "", cover: null, metaTitle: null, metaDescription: null, html: "<p>Text</p>", ...overrides });
const imageFile = (overrides = {}) => file({ html: '<figure><img src="./img/a.png" alt="Map"><figcaption>Map</figcaption></figure>', cover: "./img/a.png", ...overrides });

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (line: string) => records.push(JSON.parse(line)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); await fs.rm(config.POST_MEDIA_DIR, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
  await app.prisma.blogPost.deleteMany();
  await app.prisma.blogCategory.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.user.deleteMany();
  await fs.rm(config.POST_MEDIA_DIR, { recursive: true, force: true });
  site = await app.prisma.site.create({ data: {
    key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de",
    locales: { create: [{ code: "de", label: "Deutsch" }, { code: "en", label: "English" }] },
  } });
  const layout = await app.prisma.layout.create({ data: { siteId: site.id, name: "Post", filePath: "Post.tsx", kind: "post" } });
  for (const key of ["news", "insights"]) {
    const page = await app.prisma.page.create({ data: { siteId: site.id, path: `/${key}` } });
    await app.prisma.blogCategory.create({ data: { siteId: site.id, key, pageId: page.id, defaultLayoutId: layout.id } });
  }
  await app.prisma.blogTag.create({ data: { siteId: site.id, key: "transport" } });
  const { user } = await createTestUser(app, { role: "admin" });
  await app.prisma.cliToken.create({ data: { tokenHash: sha256(token), userId: user.id, label: "Post tests", scopes: ["posts:write", "status:read"], expiresAt: new Date(Date.now() + 60_000) } });
  records.length = 0;
});
function push(files = [file()], draft = false, uploads = [] as typeof media) {
  return app.inject({ method: "POST", url: "/api/sites/demo/cli/posts/push", headers: { authorization: `Bearer ${token}` }, payload: { files, draft, media: uploads } });
}
async function getPost(key = "routing") { return posts.getPost(app.prisma, site, key); }
async function publish(locale = "de") { await posts.setPostTranslationStatus(app.prisma, site, "routing", locale, "published", app.log); }
async function expectNoWrites() {
  expect(await app.prisma.blogPost.count()).toBe(0);
  await expect(fs.stat(config.POST_MEDIA_DIR)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("CLI posts", () => {
  it("creates draft translations and lists only the site's keys, category and locale statuses", async () => {
    const response = await push([file(), file({ source: "routing.en.md", locale: "en" })]);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ posts: [{ key: "routing", locale: "de", action: "created" }, { key: "routing", locale: "en", action: "created" }] });
    expect((await getPost()).translations.de.status).toBe("draft");
    const list = await app.inject({ method: "GET", url: "/api/sites/demo/cli/posts", headers: { authorization: `Bearer ${token}` } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([{ key: "routing", category: "news", locales: [{ locale: "de", status: "draft" }, { locale: "en", status: "draft" }] }]);
    await app.prisma.site.create({ data: { key: "other", name: "Other", domain: "other.test", stagingDomain: "staging.other.test", defaultLocale: "de" } });
    const other = await app.inject({ method: "GET", url: "/api/sites/other/cli/posts", headers: { authorization: `Bearer ${token}` } });
    expect(other.json()).toEqual([]);
  });
  it("reports unchanged and updated without rewriting an unchanged post", async () => {
    expect((await push()).statusCode).toBe(200);
    const before = await getPost();
    expect((await push()).json().posts[0].action).toBe("unchanged");
    expect(await getPost()).toEqual(before);
    expect(records.some((r) => r.op === "blog.push" && r.level === 30 && r.msg.includes("NO-OP"))).toBe(true);
    expect((await push([file({ title: "Changed" })])).json().posts[0].action).toBe("updated");
  });
  it("refuses update of published translation without draft; explicit draft demotes it", async () => {
    await push(); await publish();
    expect((await push([file({ title: "Changed" })])).statusCode).toBe(422);
    expect((await getPost()).translations.de.title).toBe("Routing");
    expect((await push([file({ title: "Changed" })], true)).statusCode).toBe(200);
    expect((await getPost()).translations.de).toMatchObject({ title: "Changed", status: "draft" });
  });
  it("refuses shared-field change on a live post and drafts every published translation with draft", async () => {
    await push([file(), file({ locale: "en", source: "routing.en.md" })]); await publish(); await publish("en");
    const change = file({ category: "insights" });
    expect((await push([change])).statusCode).toBe(422);
    expect((await getPost()).category).toBe("news");
    expect((await push([change], true)).statusCode).toBe(200);
    const post = await getPost();
    expect(post.category).toBe("insights");
    expect(Object.values(post.translations).map((t) => t.status)).toEqual(["draft", "draft"]);
  });
  it("guards shared changes when the pushed translation is draft", async () => {
    await push([file(), file({ locale: "en" })]); await publish();
    expect((await push([file({ locale: "en", tags: [] })])).statusCode).toBe(422);
    expect((await push([file({ locale: "en", tags: [] })], true)).statusCode).toBe(200);
    expect((await getPost()).translations.de.status).toBe("draft");
  });
  it.each(["script", "div"])("rejects raw html that the sanitizer strips: %s before storing media", async (tag) => {
    const response = await push([imageFile({ html: `<${tag}>Oops</${tag}><img src="./img/a.png" alt="Map">` })], false, media);
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json().issues)).toContain(tag);
    expect(response.json().issues[0].source).toBe("routing.de.md");
    await expectNoWrites();
  });
  it("refuses conflicting category across two files of one push", async () => {
    const response = await push([file(), file({ source: "routing.en.md", locale: "en", category: "insights" })]);
    expect(response.statusCode).toBe(422);
    expect(JSON.stringify(response.json().issues)).toContain("category");
    await expectNoWrites();
  });
  it("dedupes one image referenced from two files of one post", async () => {
    const store = vi.spyOn(mediaService, "storePostMedia");
    expect((await push([imageFile(), imageFile({ locale: "en" })], false, media)).statusCode).toBe(200);
    expect(store).toHaveBeenCalledTimes(1);
    const post = await getPost();
    const url = post.translations.de.coverImage!;
    expect(url).toMatch(/^\/media\/routing\/[a-f0-9]{12}-screen-shot.png$/);
    expect(post.translations.de.body).toContain(`src="${url}"`);
    expect(post.translations.en.coverImage).toBe(url);
    expect(await fs.readdir(path.join(config.POST_MEDIA_DIR, "demo", "routing"))).toHaveLength(1);
  });
  it("stores a shared media ref separately for each post key", async () => {
    const store = vi.spyOn(mediaService, "storePostMedia");
    expect((await push([imageFile(), imageFile({ key: "other", slug: "other" })], false, media)).statusCode).toBe(200);
    expect(store).toHaveBeenCalledTimes(2);
    expect((await getPost("other")).translations.de.coverImage).toMatch(/^\/media\/other\//);
  });
  it("rewrites encoded, uppercase and unquoted image attributes without touching text or links", async () => {
    const ref = "./img/a&b.png";
    const html = '<p>./img/a&amp;b.png</p><a href="./img/a&amp;b.png">Link</a><IMG SRC=./img/a&amp;b.png ALT=Map><img alt="Map" src=\'./img/a&amp;b.png\'>';
    expect((await push([file({ html, cover: ref })], false, [{ ...media[0], ref }])).statusCode).toBe(200);
    const translation = (await getPost()).translations.de;
    expect(translation.body).toContain('<p>./img/a&amp;b.png</p>');
    expect(translation.body).toContain('href="./img/a&amp;b.png"');
    expect(translation.body.match(/src="\/media\/routing\//g)).toHaveLength(2);
  });
  it("accepts existing asset/media URLs and GFM table markup", async () => {
    const html = '<figure><img src="/assets/map.png" alt="Map"><figcaption>Map</figcaption></figure><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td colspan="2">Cell</td></tr></tbody></table>';
    expect((await push([file({ html, cover: "/media/routing/existing.png" })])).statusCode).toBe(200);
    expect((await getPost()).translations.de.body).toContain('<td colspan="2">Cell</td>');
    await expect(fs.stat(config.POST_MEDIA_DIR)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("rechecks published guards after media storage and under the transaction lock", async () => {
    await push();
    const store = mediaService.storePostMedia;
    vi.spyOn(mediaService, "storePostMedia").mockImplementation(async (...args) => {
      await publish();
      return store(...args);
    });
    expect((await push([imageFile({ title: "Unreviewed" })], false, media)).statusCode).toBe(422);
    expect((await getPost()).translations.de).toMatchObject({ title: "Routing", body: "<p>Text</p>", status: "published" });
  });
  it("logs a committed outcome when draft demotes an omitted published translation", async () => {
    await push([file(), file({ locale: "en" })]); await publish();
    records.length = 0;
    expect((await push([file({ locale: "en" })], true)).statusCode).toBe(200);
    expect((await getPost()).translations.de.status).toBe("draft");
    expect(records.some((r) => r.op === "blog.push" && r.msg === "blog.push committed")).toBe(true);
    expect(records.some((r) => r.op === "blog.push" && r.msg.includes("NO-OP"))).toBe(false);
  });
  it("rejects svg upload", async () => {
    expect((await push([imageFile()], false, [{ ...media[0], base64: Buffer.from("<svg/>").toString("base64") }])).statusCode).toBe(422);
    await expectNoWrites();
  });
  it("accepts a 10 MB image within the push body limit", async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await push([imageFile()], false, [{ ...media[0], base64: bytes.toString("base64") }])).statusCode).toBe(200);
    const url = (await getPost()).translations.de.coverImage!;
    expect((await fs.readFile(mediaService.postMediaDiskPath("demo", url)!)).equals(bytes)).toBe(true);
  });
  it("is atomic: a bad tag in the second file prevents all post and media writes", async () => {
    const response = await push([imageFile(), file({ source: "other.md", key: "other", slug: "other", tags: ["missing"] })], false, media);
    expect(response.statusCode).toBe(422);
    expect(response.json().issues).toEqual(expect.arrayContaining([expect.objectContaining({ source: "other.md" })]));
    await expectNoWrites();
  });
  it("identifies the offending source when the second translation has an invalid slug", async () => {
    const response = await push([file(), file({ source: "routing.en.md", locale: "en", slug: "bad/slug" })]);
    expect(response.statusCode).toBe(422);
    expect(response.json().issues[0].source).toBe("routing.en.md");
    await expectNoWrites();
  });
  it("rolls back the first save after a real database error in the second save", async () => {
    const save = posts.savePostInTx;
    vi.spyOn(posts, "savePostInTx").mockImplementation(async (tx, currentSite, input, log) => {
      if (input.key === "other") {
        const first = await tx.blogPost.findUniqueOrThrow({ where: { siteId_key: { siteId: site.id, key: "routing" } } });
        await tx.blogPost.create({ data: { siteId: site.id, key: first.key, categoryId: first.categoryId } });
      }
      return save(tx, currentSite, input, log);
    });
    const response = await push([file(), file({ key: "other", slug: "other" })]);
    expect(response.statusCode).toBe(422);
    expect(await app.prisma.blogPost.count()).toBe(0);
  });
  it("rejects a token without posts:write and requires status:read for listing", async () => {
    await app.prisma.cliToken.updateMany({ data: { scopes: ["status:read"] } });
    expect((await push()).statusCode).toBe(403);
    await app.prisma.cliToken.updateMany({ data: { scopes: ["posts:write"] } });
    expect((await app.inject({ method: "GET", url: "/api/sites/demo/cli/posts", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
  });
  it("logs WARN with issues on a refused push", async () => {
    expect((await push([file({ tags: ["missing"] })])).statusCode).toBe(422);
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ op: "blog.push", level: 40, issues: expect.any(Array) })]));
  });
  it.each([
    { locale: "fr" }, { locale: "__proto__" }, { slug: "bad/slug" }, { key: "../escape" }, { layout: "Missing" },
    { html: '<img src="./img/a.png">', cover: "./img/a.png" },
    { html: '<img src="./missing.png" alt="Map">' },
    { html: '<img src="https://example.com/a.png" alt="Map">' },
    { html: '<a href="javascript:evil()">link</a>' },
  ])("rejects invalid file %j before media writes", async (override) => {
    expect((await push([imageFile(override)], false, media)).statusCode).toBe(422);
    await expectNoWrites();
  });
  it("preflights page and intra-push slug collisions before storing media", async () => {
    await app.prisma.page.create({ data: { siteId: site.id, path: "/news/routing" } });
    expect((await push([imageFile()], false, media)).statusCode).toBe(422);
    await expectNoWrites();
    await app.prisma.page.deleteMany({ where: { siteId: site.id, path: "/news/routing" } });
    expect((await push([imageFile(), file({ key: "other" })], false, media)).statusCode).toBe(422);
    await expectNoWrites();
  });
  it("rejects malformed bodies, duplicate translations and media refs", async () => {
    for (const payload of [{}, { draft: "false", files: [], media: [] }, { draft: false, files: [null], media: [] }, { draft: false, files: [file()], media: [{ ...media[0], base64: "%%%" }] }]) {
      expect((await app.inject({ method: "POST", url: "/api/sites/demo/cli/posts/push", headers: { authorization: `Bearer ${token}` }, payload })).statusCode).toBe(422);
    }
    expect((await push([file(), file()])).statusCode).toBe(422);
    expect((await push([imageFile()], false, [...media, ...media])).statusCode).toBe(422);
    await expectNoWrites();
  });
});
