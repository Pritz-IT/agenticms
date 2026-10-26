import { describe, it, expect, vi, afterEach } from "vitest";

vi.hoisted(() => {
  process.env["SECRETS_KEY"] = "test-secrets-key-for-vitest-only-0123456789";
  process.env["MS_OAUTH_CLIENT_ID"] = "ms-client";
  process.env["MS_OAUTH_CLIENT_SECRET"] = "ms-secret";
});

import type { SiteNotificationSettings } from "@prisma/client";
import { sendMail, microsoftFrom } from "../../../src/services/mail/mail-transport.js";
import { encryptSecret } from "../../../src/services/mail/secret-box.js";

afterEach(() => vi.unstubAllGlobals());

function msSettings(over: Partial<SiteNotificationSettings> = {}): SiteNotificationSettings {
  return {
    siteId: "s", enabled: true, provider: "microsoft", recipients: ["owner@example.ch"], fromAddress: null,
    smtpHost: null, smtpPort: null, smtpSecure: false, smtpUser: null, smtpPasswordEnc: null,
    oauthAccount: "manuel@pritz-it.com", oauthRefreshEnc: encryptSecret("refresh-1"), oauthConnectedAt: new Date(), updatedAt: new Date(),
    ...over,
  };
}

function stubGraph(sendStatus = 202, sendBody: unknown = {}) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: String(init.body) });
    if (String(url).includes("/oauth2/v2.0/token")) {
      return new Response(JSON.stringify({ access_token: "at", refresh_token: "refresh-2" }), { status: 200 });
    }
    return new Response(sendStatus === 202 ? null : JSON.stringify(sendBody), { status: sendStatus });
  }));
  return calls;
}

describe("microsoft send-as", () => {
  it("sends from the connected account when no other sender is set", async () => {
    expect(microsoftFrom({ fromAddress: null, oauthAccount: "a@x.ch" })).toEqual({});
    expect(microsoftFrom({ fromAddress: "A@x.ch", oauthAccount: "a@x.ch" })).toEqual({});
    const calls = stubGraph();
    const outcome = await sendMail(msSettings(), { to: ["owner@example.ch"], subject: "s", text: "t" });
    const message = JSON.parse(calls[1]!.body).message;
    expect(calls[1]!.url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(message.from).toBeUndefined();
    expect(outcome.oauthRefreshEnc).toBeTruthy();
  });

  it("puts a shared mailbox in message.from", async () => {
    const calls = stubGraph();
    await sendMail(msSettings({ fromAddress: "submissions@pritz-it.com" }), { to: ["owner@example.ch"], subject: "s", text: "t" });
    expect(JSON.parse(calls[1]!.body).message.from).toEqual({ emailAddress: { address: "submissions@pritz-it.com" } });
  });

  it("explains a missing Send As right", async () => {
    stubGraph(403, { error: { code: "ErrorSendAsDenied", message: "denied" } });
    await expect(sendMail(msSettings({ fromAddress: "submissions@pritz-it.com" }), { to: ["o@x.ch"], subject: "s", text: "t" }))
      .rejects.toThrow(/Send As" rights on submissions@pritz-it.com/);
  });
});
