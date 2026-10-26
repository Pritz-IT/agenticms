import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env["SECRETS_KEY"] = "test-secrets-key-for-vitest-only-0123456789";
  process.env["MS_OAUTH_CLIENT_ID"] = "ms-client";
  process.env["MS_OAUTH_CLIENT_SECRET"] = "ms-secret";
});

const sendMail = vi.hoisted(() => vi.fn());
vi.mock("../../src/services/mail/mail-transport.js", async (orig) => ({
  ...(await orig<typeof import("../../src/services/mail/mail-transport.js")>()),
  sendMail,
}));

import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createTestUser, getAccessToken } from "../helpers/auth.js";
import { processPendingNotifications, buildSubmissionMessage } from "../../src/services/mail/submission-notifier.js";
import { decryptSecret } from "../../src/services/mail/secret-box.js";

let app: FastifyInstance;
let adminToken: string;
let editorToken: string;
let siteId: string;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  sendMail.mockReset();
  await app.prisma.submission.deleteMany();
  await app.prisma.siteNotificationSettings.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.refreshToken.deleteMany();
  await app.prisma.user.deleteMany();
  const site = await app.prisma.site.create({
    data: { key: "demo", name: "Demo Site", domain: "example.com", stagingDomain: "staging.example.com", defaultLocale: "de", allowedForms: ["contact"] },
  });
  siteId = site.id;
  adminToken = getAccessToken((await createTestUser(app, { role: "admin", email: "admin@example.com" })).user);
  editorToken = getAccessToken((await createTestUser(app, { role: "editor", email: "editor@example.com" })).user);
});

const auth = (token = adminToken) => ({ authorization: `Bearer ${token}` });

async function enable(over: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: "PUT",
    url: "/api/sites/demo/notifications",
    headers: auth(),
    payload: { enabled: true, provider: "smtp", recipients: ["owner@example.ch"], fromAddress: "cms@example.ch", smtpHost: "smtp.example.ch", smtpPort: 587, smtpUser: "cms", smtpPassword: "s3cret", ...over },
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function submit() {
  const res = await app.inject({
    method: "POST",
    url: "/api/submissions",
    payload: { form: "contact", email: "lead@firma.ch", data: { name: "Lea", message: "Hallo" }, hp: "", t: 9000 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("site notification settings", () => {
  it("is admin-only", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sites/demo/notifications", headers: auth(editorToken) });
    expect(res.statusCode).toBe(403);
  });

  it("stores the SMTP password encrypted and never returns it", async () => {
    const view = await enable();
    expect(view).toMatchObject({ enabled: true, provider: "smtp", hasSmtpPassword: true, available: { microsoft: true, google: false, secretsKey: true } });
    expect(JSON.stringify(view)).not.toContain("s3cret");
    const row = await app.prisma.siteNotificationSettings.findUniqueOrThrow({ where: { siteId } });
    expect(row.smtpPasswordEnc).not.toContain("s3cret");
    expect(decryptSecret(row.smtpPasswordEnc!)).toBe("s3cret");

    // Omitted password keeps the stored one; null clears it.
    expect((await enable({ smtpPassword: undefined })).hasSmtpPassword).toBe(true);
    expect((await enable({ smtpPassword: null })).hasSmtpPassword).toBe(false);
  });

  it("rejects invalid recipients", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/sites/demo/notifications", headers: auth(), payload: { recipients: ["not-an-email"] } });
    expect(res.statusCode).toBe(400);
  });
});

describe("submission notification delivery", () => {
  it("does not queue mail when notifications are off", async () => {
    const id = await submit();
    const row = await app.prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(row.notifyStatus).toBeNull();
  });

  it("mails a new submission once and marks it sent", async () => {
    await enable();
    sendMail.mockResolvedValue({});
    const id = await submit();
    await processPendingNotifications(app);
    await processPendingNotifications(app);

    const row = await app.prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(row.notifyStatus).toBe("sent");
    expect(row.notifiedAt).not.toBeNull();
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]![1];
    expect(message).toMatchObject({ to: ["owner@example.ch"], replyTo: "lead@firma.ch", subject: "Neue Anfrage über Demo Site (contact)" });
    expect(message.text).toContain("message: Hallo");
  });

  it("keeps the submission and retries with backoff when delivery fails, then gives up", async () => {
    await enable();
    sendMail.mockRejectedValue(new Error("535 auth failed"));
    const id = await submit();
    await processPendingNotifications(app);

    let row = await app.prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ notifyStatus: "pending", notifyAttempts: 1, notifyError: "535 auth failed" });
    expect(row.notifyNextAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);

    for (let i = 0; i < 10; i++) {
      await app.prisma.submission.update({ where: { id }, data: { notifyNextAt: new Date() } });
      await processPendingNotifications(app);
    }
    row = await app.prisma.submission.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ notifyStatus: "failed", notifyAttempts: 6 });
    expect(sendMail).toHaveBeenCalledTimes(6);

    const view = (await app.inject({ method: "GET", url: "/api/sites/demo/notifications", headers: auth() })).json();
    expect(view.deliveries).toEqual({ pending: 0, failed: 1 });
    const retry = await app.inject({ method: "POST", url: "/api/sites/demo/notifications/retry-failed", headers: auth(), payload: {} });
    expect(retry.json()).toEqual({ requeued: 1 });
  });

  it("test endpoint reports the provider error", async () => {
    await enable();
    sendMail.mockRejectedValue(new Error("Connection refused"));
    const res = await app.inject({ method: "POST", url: "/api/sites/demo/notifications/test", headers: auth() });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toBe("Connection refused");
  });
});

describe("mail OAuth", () => {
  it("start returns a provider URL carrying a signed state", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sites/demo/notifications/oauth/microsoft/start", headers: auth() });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json().url);
    expect(url.host).toBe("login.microsoftonline.com");
    expect(url.searchParams.get("client_id")).toBe("ms-client");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/oauth\/mail\/microsoft\/callback$/);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("refuses an unconfigured provider", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sites/demo/notifications/oauth/google/start", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("callback rejects a forged state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/oauth/mail/microsoft/callback?code=x&state=forged" });
    expect(res.statusCode).toBe(400);
  });
});

describe("buildSubmissionMessage", () => {
  it("falls back to an email field in the data for reply-to and uses English for non-German sites", () => {
    const msg = buildSubmissionMessage(
      { key: "x", name: "X", defaultLocale: "en" },
      { form: "contact", email: null, score: null, data: { email: "a@b.ch", topic: { id: 1 } } } as never,
      ["o@x.ch"],
    );
    expect(msg.subject).toBe("New submission on X (contact)");
    expect(msg.replyTo).toBe("a@b.ch");
    expect(msg.text).toContain('topic: {"id":1}');
  });
});
