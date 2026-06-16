import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import type { FastifyInstance } from "fastify";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

// Mock the build service to avoid real HTTP calls
vi.mock("../../src/services/build.service.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/services/build.service.js")>()),
  triggerBuild: vi.fn().mockResolvedValue(undefined),
  triggerRollback: vi.fn().mockResolvedValue(undefined),
}));

import * as buildService from "../../src/services/build.service.js";

let app: FastifyInstance;
let editorToken: string;
let defaultSite: { id: string; key: string };

const INTERNAL_KEY = "test-internal-api-key";

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.build.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();

  defaultSite = await app.prisma.site.create({
    data: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });

  const { user: editor } = await createTestUser(app, { role: "editor" });
  editorToken = getAccessToken(editor);

  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// POST /api/builds
// ---------------------------------------------------------------------------
describe("POST /api/builds", () => {
  it("creates a pending build and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.target).toBe("staging");
    expect(body.status).toBe("pending");
  });

  it("calls triggerBuild asynchronously after creating the record", async () => {
    await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "production" },
    });

    // Give the fire-and-forget a tick to invoke
    await new Promise((resolve) => setImmediate(resolve));

    expect(buildService.triggerBuild).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(buildService.triggerBuild).mock.calls[0];
    // signature: (prisma, buildId, siteKey, target)
    expect(callArgs![0]).toBeDefined(); // prisma client
    expect(typeof callArgs![1]).toBe("string"); // buildId
    expect(callArgs![2]).toBe("demo");
    expect(callArgs![3]).toBe("production");
  });

  it("coalesces duplicate pending builds for the same site and target", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });

    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({
      id: first.json().id,
      target: "staging",
      status: "pending",
      coalesced: true,
    });
    await expect(
      app.prisma.build.count({ where: { siteId: defaultSite.id, target: "staging", status: { in: ["pending", "building"] } } })
    ).resolves.toBe(1);

    await new Promise((resolve) => setImmediate(resolve));
    expect(buildService.triggerBuild).toHaveBeenCalledOnce();
  });

  it("rejects build admission when the active build queue is full", async () => {
    for (let i = 0; i < 20; i += 1) {
      const site = await app.prisma.site.create({
        data: {
          key: `queue-site-${i}`,
          name: `Queue Site ${i}`,
          domain: `queue-${i}.local`,
          stagingDomain: `staging-queue-${i}.local`,
          defaultLocale: "en",
        },
      });
      await app.prisma.build.create({
        data: { siteId: site.id, target: i % 2 === 0 ? "staging" : "production", status: "pending" },
      });
    }

    const res = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain("Build queue is full");
    expect(buildService.triggerBuild).not.toHaveBeenCalled();
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds",
      payload: { target: "staging" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("rate-limits build trigger requests by bearer token before auth work", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/builds",
        headers: { authorization: "Bearer synthetic.header.signature" },
        payload: { target: "staging" },
      });
      lastStatus = res.statusCode;
    }

    expect(lastStatus).toBe(429);
  });

  it("rate-limits rotated invalid bearer strings by client IP", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/api/builds",
        headers: { authorization: `Bearer invalid-build-rate-token-${i}` },
        payload: { target: "staging" },
      });
      lastStatus = res.statusCode;
    }

    expect(lastStatus).toBe(429);
  });

  it("marks build as failed if triggerBuild throws", async () => {
    vi.mocked(buildService.triggerBuild).mockRejectedValueOnce(new Error("Connection refused"));

    const res = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });

    expect(res.statusCode).toBe(201);
    const { id } = res.json();

    // Wait for the async error handler to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const build = await app.prisma.build.findUnique({ where: { id } });
    expect(build!.status).toBe("failed");
    expect(build!.errorLog).toContain("Connection refused");
    expect(build!.finishedAt).not.toBeNull();
  });

  it("returns 400 for invalid target", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "invalid" },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sites/:siteKey/builds
// ---------------------------------------------------------------------------
describe("POST /api/sites/:siteKey/builds", () => {
  it("creates a build for the selected site and triggers it with site context", async () => {
    const site = await app.prisma.site.upsert({
      where: { key: "agenticms-build-route" },
      update: {},
      create: {
        key: "agenticms-build-route",
        name: "AgentiCMS Build Route",
        domain: "agenticms.local",
        stagingDomain: "staging.agenticms.local",
        defaultLocale: "en",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/sites/agenticms-build-route/builds",
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { target: "staging" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.siteId).toBe(site.id);
    expect(body.target).toBe("staging");

    await new Promise((resolve) => setImmediate(resolve));

    expect(buildService.triggerBuild).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(buildService.triggerBuild).mock.calls[0];
    expect(callArgs![0]).toBeDefined();
    expect(callArgs![1]).toBe(body.id);
    expect(callArgs![2]).toBe("agenticms-build-route");
    expect(callArgs![3]).toBe("staging");
  });

  it("rolls back only builds that belong to the selected site", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "agenticms-scoped-rollback",
        name: "AgentiCMS Scoped Rollback",
        domain: "agenticms-scoped-rollback.local",
        stagingDomain: "staging.agenticms-scoped-rollback.local",
        defaultLocale: "en",
      },
    });
    const siteBuild = await app.prisma.build.create({
      data: {
        siteId: site.id,
        target: "staging",
        status: "success",
        outputPath: `${config.BUILDS_DIR}/agenticms-scoped-rollback/staging-old`,
        finishedAt: new Date(),
      },
    });
    const defaultBuild = await app.prisma.build.create({
      data: {
        siteId: defaultSite.id,
        target: "staging",
        status: "success",
        outputPath: `${config.BUILDS_DIR}/demo/staging-old`,
        finishedAt: new Date(),
      },
    });

    const crossSite = await app.inject({
      method: "POST",
      url: `/api/sites/agenticms-scoped-rollback/builds/${defaultBuild.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });
    expect(crossSite.statusCode).toBe(404);
    expect(buildService.triggerRollback).not.toHaveBeenCalled();

    const ownSite = await app.inject({
      method: "POST",
      url: `/api/sites/agenticms-scoped-rollback/builds/${siteBuild.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(ownSite.statusCode).toBe(200);
    expect(ownSite.json()).toEqual({ ok: true });

    await new Promise((resolve) => setImmediate(resolve));
    expect(buildService.triggerRollback).toHaveBeenCalledOnce();
    const [, calledId, calledPath, calledSiteKey, calledTarget] = vi.mocked(buildService.triggerRollback).mock.calls[0]!;
    expect(calledId).toBe(siteBuild.id);
    expect(calledPath).toBe(`${config.BUILDS_DIR}/agenticms-scoped-rollback/staging-old`);
    expect(calledSiteKey).toBe("agenticms-scoped-rollback");
    expect(calledTarget).toBe("staging");
  });
});

// ---------------------------------------------------------------------------
// GET /api/builds
// ---------------------------------------------------------------------------
describe("GET /api/builds", () => {
  it("returns all builds ordered by startedAt desc", async () => {
    // Create builds with different startedAt to ensure ordering
    const first = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "success" } });
    await new Promise((r) => setTimeout(r, 5));
    const second = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "production", status: "pending" } });

    const res = await app.inject({
      method: "GET",
      url: "/api/builds",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    // Most recent first
    expect(body[0].id).toBe(second.id);
    expect(body[1].id).toBe(first.id);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/api/builds" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/builds/:id/status
// ---------------------------------------------------------------------------
describe("POST /api/builds/:id/status", () => {
  it("updates build status with internal API key", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "pending" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "building" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("building");
    expect(body.finishedAt).toBeNull();
  });

  it("sets finishedAt and outputPath on success", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "building" } });
    const outputPath = `${config.BUILDS_DIR}/demo/staging-2024-01-01`;

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "success", outputPath },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("success");
    expect(body.outputPath).toBe(outputPath);
    expect(body.finishedAt).not.toBeNull();
  });

  it("rejects output paths outside the default site build directory", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "building" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "success", outputPath: `${config.BUILDS_DIR}/agenticms/staging-2024-01-01` },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("output path");
  });

  it("does not update non-demo builds through the legacy status route", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "agenticms-status",
        name: "AgentiCMS Status",
        domain: "agenticms-status.local",
        stagingDomain: "staging.agenticms-status.local",
        defaultLocale: "en",
      },
    });
    const build = await app.prisma.build.create({ data: { siteId: site.id, target: "staging", status: "building" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "success", outputPath: `${config.BUILDS_DIR}/agenticms-status/staging-2024-01-01` },
    });

    expect(res.statusCode).toBe(404);
    await expect(app.prisma.build.findUnique({ where: { id: build.id } })).resolves.toMatchObject({ status: "building" });
  });

  it("sets finishedAt and errorLog on failure", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "building" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "failed", errorLog: "Out of memory" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("failed");
    expect(body.errorLog).toBe("Out of memory");
    expect(body.finishedAt).not.toBeNull();
  });

  it("returns 404 for unknown build", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds/nonexistent-id/status",
      headers: { "x-api-key": INTERNAL_KEY },
      payload: { status: "success" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without internal API key", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "pending" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      payload: { status: "success" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with wrong internal API key", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "pending" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { "x-api-key": "wrong-key" },
      payload: { status: "success" },
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 using JWT token instead of internal key", async () => {
    const build = await app.prisma.build.create({ data: { siteId: defaultSite.id, target: "staging", status: "pending" } });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/status`,
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { status: "success" },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/builds/:id/rollback
// ---------------------------------------------------------------------------
describe("POST /api/builds/:id/rollback", () => {
  it("triggers rollback for a successful build with outputPath", async () => {
    const build = await app.prisma.build.create({
      data: {
        target: "staging",
        status: "success",
        siteId: defaultSite.id,
        outputPath: `${config.BUILDS_DIR}/demo/staging-old`,
        finishedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    await new Promise((resolve) => setImmediate(resolve));
    expect(buildService.triggerRollback).toHaveBeenCalledOnce();
    // signature: (prisma, buildId, outputPath, siteKey, target)
    const [calledPrisma, calledId, calledPath, calledSiteKey, calledTarget] = vi.mocked(buildService.triggerRollback).mock.calls[0]!;
    expect(calledPrisma).toBeDefined();
    expect(calledId).toBe(build.id);
    expect(calledPath).toBe(`${config.BUILDS_DIR}/demo/staging-old`);
    expect(calledSiteKey).toBe("demo");
    expect(calledTarget).toBe("staging");
  });

  it("rejects migrated root-level output paths before triggering rollback", async () => {
    const build = await app.prisma.build.create({
      data: {
        siteId: defaultSite.id,
        target: "staging",
        status: "success",
        outputPath: `${config.BUILDS_DIR}/staging-old`,
        finishedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(410);
    expect(buildService.triggerRollback).not.toHaveBeenCalled();
  });

  it("does not rollback non-demo builds through the legacy route", async () => {
    const site = await app.prisma.site.create({
      data: {
        key: "agenticms-rollback",
        name: "AgentiCMS Rollback",
        domain: "agenticms-rollback.local",
        stagingDomain: "staging.agenticms-rollback.local",
        defaultLocale: "en",
      },
    });
    const build = await app.prisma.build.create({
      data: {
        siteId: site.id,
        target: "staging",
        status: "success",
        outputPath: "/builds/agenticms-rollback/staging-2024-01-01",
        finishedAt: new Date(),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(buildService.triggerRollback).not.toHaveBeenCalled();
  });

  it("returns 400 for a failed build", async () => {
    const build = await app.prisma.build.create({
      data: { siteId: defaultSite.id, target: "staging", status: "failed" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for a successful build without outputPath", async () => {
    const build = await app.prisma.build.create({
      data: { siteId: defaultSite.id, target: "staging", status: "success", finishedAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/builds/${build.id}/rollback`,
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for unknown build", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds/nonexistent-id/rollback",
      headers: { authorization: `Bearer ${editorToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/builds/some-id/rollback",
    });

    expect(res.statusCode).toBe(401);
  });
});
