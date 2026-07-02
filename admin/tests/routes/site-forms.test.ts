import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { issueCliToken } from "../helpers/cli.js";

let app: FastifyInstance;
let adminToken: string;
let editorToken: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  const { user: admin } = await createTestUser(app, { role: "admin" });
  adminToken = getAccessToken(admin);

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);

  await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Test Site",
      domain: "https://example.com",
      stagingDomain: "https://staging.example.com",
      defaultLocale: "en",
      allowedForms: [],
    },
  });
});

describe("GET/POST/DELETE /api/sites/:siteKey/forms", () => {
  it("admin adds a form and gets the updated array (200)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/forms",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { form: "Contact" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: ["contact"] });
  });

  it("rejects an invalid slug (400)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/forms",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { form: "bad form!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "Invalid form name" });
  });

  it("returns 409 at the cap", async () => {
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.prisma.site.update({
      where: { id: demo.id },
      data: { allowedForms: Array.from({ length: 50 }, (_, i) => `f-${i}`) },
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/sites/demo/forms",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { form: "one-more" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "form limit reached" });
  });

  it("admin removes a form (200)", async () => {
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.prisma.site.update({ where: { id: demo.id }, data: { allowedForms: ["contact"] } });
    const res = await app.inject({
      method: "DELETE",
      url: "/api/sites/demo/forms/contact",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: [] });
  });

  it("admin lists forms (200)", async () => {
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.prisma.site.update({ where: { id: demo.id }, data: { allowedForms: ["contact", "quiz"] } });
    const res = await app.inject({
      method: "GET",
      url: "/api/sites/demo/forms",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: ["contact", "quiz"] });
  });

  it("returns 404 for an unknown site", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sites/does-not-exist/forms",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("rejects an editor (403) and unauthenticated (401)", async () => {
    expect(
      (await app.inject({
        method: "GET",
        url: "/api/sites/demo/forms",
        headers: { authorization: `Bearer ${editorToken}` },
      })).statusCode
    ).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/sites/demo/forms" })).statusCode).toBe(401);
  });

  it("CLI token with forms:write adds a form (200)", async () => {
    const token = await issueCliToken(app); // all scopes incl. forms:write (after Step 1)
    const res = await app.inject({ method: "POST", url: "/api/sites/demo/cli/forms", headers: { authorization: `Bearer ${token}` }, payload: { form: "contact" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: ["contact"] });
  });
  it("CLI token WITHOUT forms:write is rejected (403)", async () => {
    const token = await issueCliToken(app);
    await app.prisma.cliToken.updateMany({ data: { scopes: ["status:read"] } }); // strip forms:write
    const res = await app.inject({ method: "POST", url: "/api/sites/demo/cli/forms", headers: { authorization: `Bearer ${token}` }, payload: { form: "contact" } });
    expect(res.statusCode).toBe(403);
  });

  it("CLI GET lists a site's allowed forms (200)", async () => {
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.prisma.site.update({ where: { id: demo.id }, data: { allowedForms: ["contact", "quiz"] } });
    const token = await issueCliToken(app);
    const res = await app.inject({ method: "GET", url: "/api/sites/demo/cli/forms", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: ["contact", "quiz"] });
  });
  it("CLI DELETE removes a form and returns the updated array (200)", async () => {
    const demo = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    await app.prisma.site.update({ where: { id: demo.id }, data: { allowedForms: ["contact", "quiz"] } });
    const token = await issueCliToken(app);
    const res = await app.inject({ method: "DELETE", url: "/api/sites/demo/cli/forms/contact", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ forms: ["quiz"] });
  });
});
