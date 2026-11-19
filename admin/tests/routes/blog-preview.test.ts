import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { Site, User } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { cleanupPreviewFixture, createPreviewFixture, previewInput } from "../helpers/blog-preview.js";

// Smallest valid PNG (1×1).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

let app: FastifyInstance;
let tempDir: string;
let site: Site;
let user: User;

beforeAll(async () => { app = await buildApp({ logger: false }); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  ({ site, tempDir } = await createPreviewFixture(app));
  await app.prisma.user.deleteMany();
  ({ user } = await createTestUser(app, { role: "editor" }));
});
afterEach(async () => { await cleanupPreviewFixture(tempDir); });

async function createPreview(body: unknown = { locale: "en", post: previewInput() }, key = "hello") {
  return app.inject({
    method: "POST", url: `/api/sites/${site.key}/blog/posts/${key}/preview`,
    headers: { authorization: `Bearer ${getAccessToken(user)}` }, payload: body as Record<string, unknown>,
  });
}

function previewCookie(response: Awaited<ReturnType<typeof createPreview>>) {
  const cookie = response.cookies.find((entry) => entry.name === "agenticms_preview");
  if (!cookie) throw new Error("preview cookie missing");
  return cookie;
}

describe("POST /api/sites/:siteKey/blog/posts/:key/preview", () => {
  it("requires the admin session", async () => {
    const response = await app.inject({ method: "POST", url: `/api/sites/${site.key}/blog/posts/hello/preview`, payload: { locale: "en", post: previewInput() } });
    expect(response.statusCode).toBe(401);
  });

  it("renders the unsaved post, returns a stable link and a scoped preview cookie", async () => {
    const first = await createPreview();
    expect(first.statusCode, first.body).toBe(200);
    const body = first.json();
    expect(body).toMatchObject({ url: expect.stringMatching(/^\/preview\/[A-Za-z0-9_-]{43}$/), version: 1 });
    expect(body.html).toContain("<h1>Hello preview</h1>");
    expect(previewCookie(first)).toMatchObject({ path: "/preview", httpOnly: true, sameSite: "Strict", maxAge: 900 });

    const second = await createPreview({ locale: "en", post: previewInput({ title: "Edited" }) });
    expect(second.json()).toMatchObject({ url: body.url, version: 2 });
    expect(second.json().html).toContain("<h1>Edited</h1>");
    expect(await app.prisma.blogPost.count()).toBe(0);
  });

  it("rejects a body whose post key does not match the URL, and invalid content", async () => {
    expect((await createPreview({ locale: "en", post: previewInput() }, "other")).statusCode).toBe(400);
    expect((await createPreview({ post: previewInput() })).statusCode).toBe(400);
    const invalid = await createPreview({ locale: "en", post: previewInput({ body: `<img src="/media/hello/a.png">` }) });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatch(/alt text/);
  });

  it("reports a layout that fails to render as 422", async () => {
    await writeFile(join(config.LAYOUTS_DIR, site.key, "ExamplePost.tsx"), `export const layoutKind = "post";\nexport default function Broken() { throw new Error("kaputt"); }\n`);
    const response = await createPreview();
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain("kaputt");
  });
});

describe("GET /preview/:token", () => {
  it("serves the latest version only to a browser holding the preview cookie", async () => {
    const created = await createPreview();
    const { url } = created.json();
    const cookie = previewCookie(created);

    const opened = await app.inject({ method: "GET", url, cookies: { agenticms_preview: cookie.value } });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers["content-type"]).toContain("text/html");
    expect(opened.headers["cache-control"]).toBe("no-store");
    expect(opened.headers["x-robots-tag"]).toBe("noindex");
    expect(opened.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(opened.body).toContain("<h1>Hello preview</h1>");

    const withoutCookie = await app.inject({ method: "GET", url });
    expect(withoutCookie.statusCode).toBe(401);
    expect(withoutCookie.body).toContain("signed in to the admin");
  });

  it("does not accept an access token as preview cookie, nor the preview cookie as a Bearer token", async () => {
    const created = await createPreview();
    const { url } = created.json();
    expect((await app.inject({ method: "GET", url, cookies: { agenticms_preview: getAccessToken(user) } })).statusCode).toBe(401);
    const asBearer = await app.inject({
      method: "GET", url: `/api/sites/${site.key}/blog/posts`, headers: { authorization: `Bearer ${previewCookie(created).value}` },
    });
    expect(asBearer.statusCode).toBe(401);
  });

  it("refuses a deleted user and an unknown token", async () => {
    const created = await createPreview();
    const cookie = previewCookie(created).value;
    expect((await app.inject({ method: "GET", url: "/preview/unknown-token", cookies: { agenticms_preview: cookie } })).statusCode).toBe(404);
    await app.prisma.user.delete({ where: { id: user.id } });
    expect((await app.inject({ method: "GET", url: created.json().url, cookies: { agenticms_preview: cookie } })).statusCode).toBe(401);
  });

  it("serves the post's media through the token and nothing outside the media dir", async () => {
    await mkdir(join(config.POST_MEDIA_DIR, site.key, "hello"), { recursive: true });
    await writeFile(join(config.POST_MEDIA_DIR, site.key, "hello", "a.png"), PNG);
    const created = await createPreview({ locale: "en", post: previewInput({ body: `<p><img src="/media/hello/a.png" alt="A"></p>` }) });
    const { url } = created.json();
    expect(created.json().html).toContain(`src="${url}/media/hello/a.png"`);
    const cookies = { agenticms_preview: previewCookie(created).value };

    const image = await app.inject({ method: "GET", url: `${url}/media/hello/a.png`, cookies });
    expect(image.statusCode).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect((await app.inject({ method: "GET", url: `${url}/media/hello/a.png` })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `${url}/media/..%2F..%2Fsecret/x.png`, cookies })).statusCode).toBe(404);
  });

  it("guards the event stream and serves the live script", async () => {
    const created = await createPreview();
    expect((await app.inject({ method: "GET", url: `${created.json().url}/events` })).statusCode).toBe(401);
    const live = await app.inject({ method: "GET", url: "/preview/live.js" });
    expect(live.statusCode).toBe(200);
    expect(live.headers["content-type"]).toContain("text/javascript");
    expect(live.body).toContain("EventSource");
  });
});
