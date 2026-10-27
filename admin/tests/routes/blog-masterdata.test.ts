import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { createBlogFixture } from "../helpers/blog.js";

let app: FastifyInstance;
let siteId: string;
let auth: string;
const records: { op?: string; level: number; msg: string }[] = [];
const categoryBody = { key: "playbooks", pagePath: "/insights", defaultLayout: "Post", names: { de: "Leitfäden", en: "Playbooks" } };
const tagBody = { key: "routing", names: { de: "Routen", en: "Routing" } };
const bodies = { categories: categoryBody, tags: tagBody };

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (line: string) => records.push(JSON.parse(line)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await app.prisma.blogPost.deleteMany();
  await app.prisma.blogCategory.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.user.deleteMany();
  const site = await app.prisma.site.create({ data: {
    key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de",
    locales: { create: [{ code: "de", label: "Deutsch" }, { code: "en", label: "English" }] },
  } });
  siteId = site.id;
  await app.prisma.page.createMany({ data: [{ siteId, path: "/" }, { siteId, path: "/insights" }, { siteId, path: "/other" }] });
  await app.prisma.layout.create({ data: { siteId, name: "Post", filePath: "Article.tsx", kind: "post" } });
  const { user } = await createTestUser(app, { role: "editor" });
  auth = `Bearer ${getAccessToken(user)}`;
  records.length = 0;
});

function request(method: "GET" | "POST" | "PATCH" | "DELETE", resource: string, payload?: object) {
  return app.inject({ method, url: `/api/sites/demo/blog/${resource}`, headers: { authorization: auth }, ...(payload && { payload }) });
}

async function addFilter(path: string, value: string, locale = "de", targetSite = siteId, type: "bloglist" | "text" = "bloglist") {
  const page = await app.prisma.page.upsert({ where: { siteId_path: { siteId: targetSite, path } }, create: { siteId: targetSite, path }, update: {} });
  await app.prisma.content.create({ data: { pageId: page.id, key: `list-${await app.prisma.content.count()}`, locale, type, value } });
}

describe.each(["categories", "tags"] as const)("blog %s", (resource) => {
  const body = bodies[resource];
  const kind = resource === "categories" ? "category" : "tag";

  it("creates per-locale names, lists without ids, updates and deletes as an editor", async () => {
    const created = await request("POST", resource, body);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ ...body, sortOrder: 0 });
    expect((await request("GET", resource)).json()).toEqual([created.json()]);
    const updated = await request("PATCH", `${resource}/${body.key}`, { names: { de: "Neu" }, sortOrder: 3 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual({ ...body, names: { de: "Neu" }, sortOrder: 3 });
    expect((await request("PATCH", `${resource}/${body.key}`, { sortOrder: 4 })).json()).toEqual({ ...body, names: { de: "Neu" }, sortOrder: 4 });
    expect((await request("PATCH", `${resource}/${body.key}`, {})).statusCode).toBe(200);
    expect((await request("DELETE", `${resource}/${body.key}`)).statusCode).toBe(200);
    expect((await request("GET", resource)).json()).toEqual([]);
  });

  it("rejects duplicate keys with 409", async () => {
    expect((await request("POST", resource, body)).statusCode).toBe(201);
    expect((await request("POST", resource, body)).statusCode).toBe(409);
  });

  it("validates names, order, stable keys and unknown fields", async () => {
    for (const override of [{ names: { fr: "Autre" } }, { names: [] }, { names: { de: 3 } }, { names: { de: " " } }, { sortOrder: 1.5 }, { sortOrder: 2147483648 }, { key: "" }, { siteId: "foreign" }]) {
      expect((await request("POST", resource, { ...body, ...override })).statusCode).toBe(400);
    }
    expect((await request("POST", resource, body)).statusCode).toBe(201);
    expect((await request("PATCH", `${resource}/${body.key}`, { key: "renamed" })).statusCode).toBe(400);
    expect((await request("PATCH", `${resource}/${body.key}`, { names: { fr: "Autre" } })).statusCode).toBe(400);
    expect((await request("GET", resource)).json()[0].names).toEqual(body.names);
  });

  it("refuses deletion used by a post and names its key", async () => {
    const fixture = await createBlogFixture(app, siteId);
    let key = fixture.category.key;
    if (resource === "tags") {
      const tag = await app.prisma.blogTag.create({ data: { siteId, key: body.key, posts: { create: { postId: fixture.post.id } } } });
      key = tag.key;
    }
    const response = await request("DELETE", `${resource}/${key}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain(fixture.post.key);
  });

  it("refuses deletion referenced by a bloglist and names its page path", async () => {
    expect((await request("POST", resource, body)).statusCode).toBe(201);
    await addFilter("/overview", JSON.stringify({ [resource]: [body.key] }));
    const response = await request("DELETE", `${resource}/${body.key}`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain("/overview");
  });

  it("finds unique default-locale page references defensively and only within the site", async () => {
    const { findBloglistReferences } = await import("../../src/services/blog/masterdata.js");
    await addFilter("/overview", JSON.stringify({ [resource]: [body.key] }));
    await addFilter("/overview", JSON.stringify({ [resource]: [body.key] }));
    for (const value of ["", "{broken", "null", "[]", '"text"', "3", JSON.stringify({ [resource]: body.key }), JSON.stringify({ [resource]: ["other"] })]) {
      await addFilter("/ignored", value);
    }
    await addFilter("/ignored", JSON.stringify({ [resource]: [body.key] }), "en");
    await addFilter("/ignored", JSON.stringify({ [resource]: [body.key] }), "de", siteId, "text");
    const foreign = await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "de" } });
    await addFilter("/foreign", JSON.stringify({ [resource]: [body.key] }), "de", foreign.id);
    await expect(findBloglistReferences(app.prisma, siteId, kind, body.key)).resolves.toEqual(["/overview"]);
  });

  it("logs INFO entry and outcomes including unchanged, rejected and missing NO-OPs", async () => {
    await request("POST", resource, body);
    await request("PATCH", `${resource}/${body.key}`, { sortOrder: 2 });
    await request("DELETE", `${resource}/${body.key}`);
    for (const action of ["create", "update", "delete"]) {
      const logs = records.filter((record) => record.op === `blog.${kind}.${action}` && record.level === 30);
      expect(logs.some((record) => record.msg.includes("requested"))).toBe(true);
      expect(logs.some((record) => record.msg.includes("done"))).toBe(true);
    }
    await request("POST", resource, body);
    records.length = 0;
    await request("PATCH", `${resource}/${body.key}`, body);
    await request("POST", resource, body);
    await request("DELETE", `${resource}/missing`);
    for (const action of ["create", "update", "delete"]) {
      expect(records.some((record) => record.op === `blog.${kind}.${action}` && record.level === 30 && record.msg.includes("NO-OP"))).toBe(true);
    }
    expect(records.some((record) => record.level === 40 && record.msg.includes("rejected"))).toBe(true);
  });

  it("requires authentication for every method and scopes list/update/delete to the site", async () => {
    for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
      const suffix = method === "PATCH" || method === "DELETE" ? `/${body.key}` : "";
      const response = await app.inject({ method, url: `/api/sites/demo/blog/${resource}${suffix}`, ...(method === "POST" || method === "PATCH" ? { payload: body } : {}) });
      expect(response.statusCode).toBe(401);
    }
    const foreign = await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "de" } });
    const fixture = await createBlogFixture(app, foreign.id);
    const key = resource === "categories" ? fixture.category.key : body.key;
    if (resource === "tags") await app.prisma.blogTag.create({ data: { siteId: foreign.id, key } });
    expect((await request("GET", resource)).json()).toEqual([]);
    expect((await request("PATCH", `${resource}/${key}`, { sortOrder: 1 })).statusCode).toBe(404);
    expect((await request("DELETE", `${resource}/${key}`)).statusCode).toBe(404);
  });
});

describe("category page and layout validation", () => {
  it("serializes competing category creates and rolls back the losing names", async () => {
    const responses = await Promise.all([
      request("POST", "categories", categoryBody),
      request("POST", "categories", { ...categoryBody, key: "competing" }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    expect(await app.prisma.blogCategory.count({ where: { siteId } })).toBe(1);
    expect(await app.prisma.blogCategoryName.count()).toBe(2);
  });

  it("rejects a page already used by another category", async () => {
    expect((await request("POST", "categories", categoryBody)).statusCode).toBe(201);
    expect((await request("POST", "categories", { ...categoryBody, key: "another" })).statusCode).toBe(409);
    expect((await request("POST", "categories", { ...categoryBody, key: "another", pagePath: "/other" })).statusCode).toBe(201);
    expect((await request("PATCH", "categories/another", { pagePath: "/insights" })).statusCode).toBe(409);
    expect((await request("GET", "categories")).json().find((category: { key: string }) => category.key === "another").pagePath).toBe("/other");
  });

  it("rejects the root, unknown/foreign pages, foreign locales and foreign layouts on create and update", async () => {
    const foreign = await app.prisma.site.create({ data: { key: "foreign", name: "Foreign", domain: "foreign.test", stagingDomain: "staging.foreign.test", defaultLocale: "fr", locales: { create: { code: "fr", label: "French" } } } });
    await app.prisma.page.create({ data: { siteId: foreign.id, path: "/foreign" } });
    await app.prisma.layout.create({ data: { siteId: foreign.id, name: "Foreign", filePath: "Foreign.tsx", kind: "post" } });
    expect((await request("POST", "categories", categoryBody)).statusCode).toBe(201);
    for (const override of [{ pagePath: "/" }, { pagePath: "/foreign" }, { pagePath: "/missing" }, { defaultLayout: "Foreign" }, { defaultLayout: "Missing" }, { names: { fr: "French" } }]) {
      expect((await request("POST", "categories", { ...categoryBody, key: "invalid", ...override })).statusCode).toBe(400);
      expect((await request("PATCH", `categories/${categoryBody.key}`, override)).statusCode).toBe(400);
    }
  });

  it("resolves by site, name AND post kind and rejects ambiguous post names", async () => {
    await app.prisma.layout.createMany({ data: [
      { siteId, name: "Page", filePath: "Page.tsx" },
      { siteId, name: "Post", filePath: "PageAlsoNamedPost.tsx" },
    ] });
    expect((await request("POST", "categories", { ...categoryBody, defaultLayout: "Page" })).statusCode).toBe(400);
    expect((await request("POST", "categories", categoryBody)).statusCode).toBe(201);
    await app.prisma.layout.create({ data: { siteId, name: "Post", filePath: "AnotherPost.tsx", kind: "post" } });
    expect((await request("PATCH", `categories/${categoryBody.key}`, { defaultLayout: "Post" })).statusCode).toBe(400);
    expect((await request("POST", "categories", { ...categoryBody, key: "other", pagePath: "/other" })).statusCode).toBe(400);
  });

  it("rolls back page and names changes when a post URL collides", async () => {
    const fixture = await createBlogFixture(app, siteId);
    await app.prisma.page.create({ data: { siteId, path: "/other/x" } });
    const response = await request("PATCH", `categories/${fixture.category.key}`, { pagePath: "/other", names: { de: "Changed" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().conflicts).toEqual(expect.arrayContaining([expect.objectContaining({ url: "/other/x/" })]));
    const category = await app.prisma.blogCategory.findUniqueOrThrow({ where: { id: fixture.category.id }, include: { names: true } });
    expect(category.pageId).toBe(fixture.page.id);
    expect(category.names).toEqual([]);
  });

  it("moves post routes when the new page has no collision", async () => {
    const fixture = await createBlogFixture(app, siteId);
    const response = await request("PATCH", `categories/${fixture.category.key}`, { pagePath: "/other" });
    expect(response.statusCode).toBe(200);
    expect(response.json().pagePath).toBe("/other");
  });
});
