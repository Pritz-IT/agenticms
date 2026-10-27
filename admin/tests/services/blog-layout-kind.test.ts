import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { createBlogFixture } from "../helpers/blog.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { assertLayoutChangesAllowed, LayoutInUseError, LayoutKindError, requireLayoutOfKind } from "../../src/services/blog/layout-kind.js";
import { syncLayoutBatch } from "../../src/services/cli-sync.js";

let app: FastifyInstance;
let siteId: string;
let token: string;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "blog-layout-kind-"));
  config.LAYOUTS_DIR = root;
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  await app.prisma.blogPost.deleteMany();
  await app.prisma.blogCategory.deleteMany();
  await app.prisma.page.deleteMany();
  await app.prisma.layout.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  const site = await app.prisma.site.create({ data: { key: "demo", name: "Demo", domain: "demo.test", stagingDomain: "staging.demo.test", defaultLocale: "de" } });
  siteId = site.id;
  const { user } = await createTestUser(app, { role: "admin" });
  token = getAccessToken(user);
});

describe("layout kind enforcement", () => {
  it("names category and post keys when a post layout is changed or pruned", async () => {
    const { layout, post } = await createBlogFixture(app, siteId);
    await app.prisma.blogPost.update({ where: { id: post.id }, data: { layoutId: layout.id } });
    for (const nextKind of ["page", null] as const) {
      const operation = assertLayoutChangesAllowed(app.prisma, siteId, [{ filePath: layout.filePath, nextKind }]);
      await expect(operation).rejects.toBeInstanceOf(LayoutInUseError);
      await expect(operation).rejects.toThrow(/category news.*post school-bus-routing/);
    }
    await expect(assertLayoutChangesAllowed(app.prisma, siteId, [{ filePath: layout.filePath, nextKind: "post" }])).resolves.toBeUndefined();
  });

  it("protects an override even when no category uses that layout", async () => {
    const { post } = await createBlogFixture(app, siteId);
    const override = await app.prisma.layout.create({ data: { siteId, name: "Special", filePath: "Special.tsx", kind: "post" } });
    await app.prisma.blogPost.update({ where: { id: post.id }, data: { layoutId: override.id } });
    await expect(assertLayoutChangesAllowed(app.prisma, siteId, [{ filePath: override.filePath, nextKind: null }])).rejects.toThrow("post school-bus-routing");
  });

  it("names pages on page-to-post changes, allows unused changes, and scopes to the site", async () => {
    const layout = await app.prisma.layout.create({ data: { siteId, name: "Home", filePath: "Home.tsx" } });
    await expect(assertLayoutChangesAllowed(app.prisma, siteId, [{ filePath: layout.filePath, nextKind: "post" }])).resolves.toBeUndefined();
    await app.prisma.page.create({ data: { siteId, path: "/home", layoutId: layout.id } });
    await expect(assertLayoutChangesAllowed(app.prisma, siteId, [{ filePath: layout.filePath, nextKind: "post" }])).rejects.toThrow("page /home");
    await expect(assertLayoutChangesAllowed(app.prisma, "other-site", [{ filePath: layout.filePath, nextKind: "post" }])).resolves.toBeUndefined();
  });

  it("requires the requested kind and site, including missing layouts", async () => {
    const { layout } = await createBlogFixture(app, siteId);
    await expect(requireLayoutOfKind(app.prisma, siteId, layout.id, "post")).resolves.toMatchObject({ id: layout.id });
    for (const [site, id, kind] of [[siteId, layout.id, "page"], ["other-site", layout.id, "post"], [siteId, "missing", "post"]] as const) {
      await expect(requireLayoutOfKind(app.prisma, site, id, kind)).rejects.toBeInstanceOf(LayoutKindError);
    }
  });

  it.each(["/api/sites/demo/layouts", "/api/layouts"])("filters layout kinds at %s and rejects invalid filters", async (url) => {
    const { layout } = await createBlogFixture(app, siteId);
    const page = await app.prisma.layout.create({ data: { siteId, name: "Home", filePath: "Home.tsx" } });
    for (const [kind, id] of [["post", layout.id], ["page", page.id]]) {
      const response = await app.inject({ method: "GET", url: `${url}?kind=${kind}`, headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(200);
      expect(response.json().map((item: { id: string }) => item.id)).toEqual([id]);
    }
    const invalid = await app.inject({ method: "GET", url: `${url}?kind=invalid`, headers: { authorization: `Bearer ${token}` } });
    expect(invalid.statusCode).toBe(400);
  });

  it.each(["/api/sites/demo/pages", "/api/pages"])("rejects post layout assignments on page create and update at %s", async (url) => {
    const { layout, page } = await createBlogFixture(app, siteId);
    for (const method of ["POST", "PUT", "PATCH"] as const) {
      const response = await app.inject({ method, url: method === "POST" ? url : `${url}/${page.id}`, headers: { authorization: `Bearer ${token}` }, payload: { path: "/other", layoutId: layout.id } });
      expect(response.statusCode).toBe(400);
    }
    expect((await app.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).layoutId).toBeNull();
    expect(await app.prisma.page.count()).toBe(1);
  });

  it.each(["change", "prune"])("guards legacy service %s before any write", async (operation) => {
    const { layout } = await createBlogFixture(app, siteId);
    const original = 'export const layoutKind = "post";';
    await writeFile(join(root, layout.filePath), original);
    await expect(syncLayoutBatch(app, [{ path: operation === "change" ? layout.filePath : "Other.tsx", content: 'export const keys = { "title": { type: "text", initial: "Page" } };' }])).rejects.toBeInstanceOf(LayoutInUseError);
    expect(await readFile(join(root, layout.filePath), "utf8")).toBe(original);
  });
});
