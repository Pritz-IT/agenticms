import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { User } from "@prisma/client";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";

let app: FastifyInstance;
let adminToken: string;
let editorToken: string;
let adminUser: User;

async function createChallenge() {
  const res = await app.inject({
    method: "POST",
    url: "/api/cli/device",
    payload: { label: "Test CLI" },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as {
    deviceId: string;
    deviceSecret: string;
    code: string;
    approveUrl: string;
  };
}

async function approve(deviceId: string, code: string, token = adminToken) {
  return app.inject({
    method: "POST",
    url: `/api/cli/device/${deviceId}/approve`,
    headers: { authorization: `Bearer ${token}` },
    payload: { code },
  });
}

async function poll(deviceId: string, deviceSecret: string) {
  return app.inject({
    method: "POST",
    url: `/api/cli/device/${deviceId}/token`,
    payload: { deviceSecret },
  });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.prisma.cliToken.deleteMany();
  await app.prisma.cliDeviceChallenge.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  await app.prisma.site.upsert({
    where: { key: "demo" },
    update: {},
    create: {
      key: "demo",
      name: "Demo Site",
      domain: "demo.local",
      stagingDomain: "staging.demo.local",
      defaultLocale: "de",
    },
  });

  const { user: admin } = await createTestUser(app, { role: "admin", email: `admin-${Date.now()}@example.com` });
  const { user: editor } = await createTestUser(app, { role: "editor", email: `editor-${Date.now()}@example.com` });
  adminUser = admin;
  adminToken = getAccessToken(admin);
  editorToken = getAccessToken(editor);
});

describe("CLI device auth", () => {
  it("creates a device challenge with a separate approval URL and code", async () => {
    const challenge = await createChallenge();

    expect(challenge.deviceId).toBeTruthy();
    expect(challenge.deviceSecret).toMatch(/^sfdev_/);
    expect(challenge.code).toMatch(/^\d{6}$/);
    expect(challenge.approveUrl).toBe(`/cli/approve/${challenge.deviceId}`);
    expect(challenge.approveUrl).not.toContain(challenge.code);
  });

  it("requires an admin user to approve a CLI challenge", async () => {
    const challenge = await createChallenge();

    const editor = await approve(challenge.deviceId, challenge.code, editorToken);
    expect(editor.statusCode).toBe(403);

    const admin = await approve(challenge.deviceId, challenge.code, adminToken);
    expect(admin.statusCode).toBe(200);
    expect(admin.json()).toEqual({ ok: true });
  });

  it("issues a scoped CLI token once after approval", async () => {
    const challenge = await createChallenge();
    const pending = await poll(challenge.deviceId, challenge.deviceSecret);
    expect(pending.statusCode).toBe(202);
    expect(pending.json()).toEqual({ status: "pending" });

    expect((await approve(challenge.deviceId, challenge.code)).statusCode).toBe(200);

    const tokenRes = await poll(challenge.deviceId, challenge.deviceSecret);
    expect(tokenRes.statusCode).toBe(200);
    const body = tokenRes.json() as { token: string; scopes: string[] };
    expect(body.token).toMatch(/^sfcli_/);
    expect(body.scopes).toEqual(["layouts:write", "assets:write", "builds:write", "status:read", "sites:write", "pages:write", "forms:write"]);

    const second = await poll(challenge.deviceId, challenge.deviceSecret);
    expect(second.statusCode).toBe(202);
  });

  it("rejects wrong and expired approval codes", async () => {
    const wrong = await createChallenge();
    expect((await approve(wrong.deviceId, "000000")).statusCode).toBe(400);

    const expired = await createChallenge();
    await app.prisma.cliDeviceChallenge.update({
      where: { id: expired.deviceId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await approve(expired.deviceId, expired.code)).statusCode).toBe(400);
  });

  it("revokes a CLI token", async () => {
    const challenge = await createChallenge();
    expect((await approve(challenge.deviceId, challenge.code)).statusCode).toBe(200);
    const token = (await poll(challenge.deviceId, challenge.deviceSecret)).json().token as string;

    const before = await app.inject({
      method: "GET",
      url: "/api/cli/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(before.statusCode).toBe(200);

    const revoke = await app.inject({
      method: "DELETE",
      url: "/api/cli/token",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(revoke.statusCode).toBe(200);

    const after = await app.inject({
      method: "GET",
      url: "/api/cli/status",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(after.statusCode).toBe(401);
  });

  it("rejects CLI tokens after the approving admin is demoted", async () => {
    const challenge = await createChallenge();
    expect((await approve(challenge.deviceId, challenge.code)).statusCode).toBe(200);
    const token = (await poll(challenge.deviceId, challenge.deviceSecret)).json().token as string;

    await app.prisma.user.update({
      where: { id: adminUser.id },
      data: { role: "editor" },
    });

    const afterDemotion = await app.inject({
      method: "GET",
      url: "/api/cli/status",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(afterDemotion.statusCode).toBe(403);
  });
});
