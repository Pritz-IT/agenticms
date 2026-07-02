import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../../src/app.js";
import type { FastifyInstance } from "fastify";
import { seedDemoSite } from "../../prisma/seed.js";

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp({ logger: false }); await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await app.prisma.submission.deleteMany(); await app.prisma.site.deleteMany(); });

describe("seedDemoSite", () => {
  it("sets allowedForms to the generic demo defaults on CREATE", async () => {
    const { id } = await seedDemoSite(app.prisma);
    const site = await app.prisma.site.findUniqueOrThrow({ where: { id } });
    expect([...site.allowedForms].sort()).toEqual(["contact", "sample-template"]);
  });
  it("does NOT overwrite an existing site's allowedForms on re-seed (deliberate [] preserved)", async () => {
    await seedDemoSite(app.prisma);
    await app.prisma.site.update({ where: { key: "demo" }, data: { allowedForms: [] } });
    await seedDemoSite(app.prisma);
    const site = await app.prisma.site.findUniqueOrThrow({ where: { key: "demo" } });
    expect(site.allowedForms).toEqual([]);
  });
});

describe("migration backfill SQL", () => {
  it("backfills allowedForms from submitted forms, EXCLUDING non-slug values", async () => {
    const site = await app.prisma.site.create({ data: { key: "bf", name: "BF", domain: "bf.local", stagingDomain: "s.bf.local", defaultLocale: "de", allowedForms: [] } });
    await app.prisma.submission.create({ data: { siteId: site.id, form: "contact", data: {} } });
    await app.prisma.submission.create({ data: { siteId: site.id, form: "Legacy Form!", data: {} } }); // junk — must be excluded
    await app.prisma.$executeRawUnsafe(`
      UPDATE "sites" s SET "allowed_forms" = sub.forms
      FROM (SELECT "site_id", array_agg(DISTINCT "form") AS forms FROM "submissions"
            WHERE "form" ~ '^[a-z0-9-]+$' AND length("form") <= 64 GROUP BY "site_id") sub
      WHERE s.id = sub."site_id"`);
    const updated = await app.prisma.site.findUniqueOrThrow({ where: { id: site.id } });
    expect(updated.allowedForms).toEqual(["contact"]);
  });
});

describe("new-site default", () => {
  it("a site created without allowedForms defaults to [] (column default)", async () => {
    // createSite (site-management.ts) omits allowedForms, so a fresh site's value
    // IS this column default — spec's "fresh site created via createSite gets []".
    const s = await app.prisma.site.create({ data: { key: "fresh", name: "F", domain: "f.local", stagingDomain: "s.f.local", defaultLocale: "de" } });
    expect(s.allowedForms).toEqual([]);
  });
});
