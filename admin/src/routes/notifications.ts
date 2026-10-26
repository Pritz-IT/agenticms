import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MailProvider, SiteNotificationSettings } from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { requireSite, type SiteParams } from "../services/sites.js";
import { encryptSecret } from "../services/mail/secret-box.js";
import { sendMail } from "../services/mail/mail-transport.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchAccountEmail,
  isOAuthProvider,
  oauthConfigured,
  type OAuthMailProvider,
} from "../services/mail/mail-oauth.js";

const STATE_AUDIENCE = "agenticms-mail-oauth";

interface NotificationsBody {
  enabled?: boolean;
  provider?: MailProvider | null;
  recipients?: string[];
  fromAddress?: string | null;
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpSecure?: boolean;
  smtpUser?: string | null;
  // Write-only. Omitted or "" keeps the stored password; null clears it.
  smtpPassword?: string | null;
}

const EMAIL = { type: "string", maxLength: 254, pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" };
const NULLABLE_STRING = { type: ["string", "null"], maxLength: 254 };

const updateSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" },
      provider: { type: ["string", "null"], enum: ["smtp", "microsoft", "google", null] },
      recipients: { type: "array", maxItems: 10, items: EMAIL },
      fromAddress: { anyOf: [EMAIL, { type: "null" }, { type: "string", maxLength: 0 }] },
      smtpHost: NULLABLE_STRING,
      smtpPort: { type: ["integer", "null"], minimum: 1, maximum: 65535 },
      smtpSecure: { type: "boolean" },
      smtpUser: NULLABLE_STRING,
      smtpPassword: { type: ["string", "null"], maxLength: 1024 },
    },
  },
};

function publicView(s: SiteNotificationSettings | null, counts: { pending: number; failed: number }) {
  return {
    enabled: s?.enabled ?? false,
    provider: s?.provider ?? null,
    recipients: s?.recipients ?? [],
    fromAddress: s?.fromAddress ?? null,
    smtpHost: s?.smtpHost ?? null,
    smtpPort: s?.smtpPort ?? null,
    smtpSecure: s?.smtpSecure ?? false,
    smtpUser: s?.smtpUser ?? null,
    hasSmtpPassword: Boolean(s?.smtpPasswordEnc),
    oauthAccount: s?.oauthAccount ?? null,
    oauthConnectedAt: s?.oauthConnectedAt ?? null,
    available: {
      microsoft: oauthConfigured("microsoft"),
      google: oauthConfigured("google"),
      secretsKey: config.SECRETS_KEY.length >= 32,
    },
    deliveries: counts,
  };
}

async function loadView(app: FastifyInstance, siteId: string) {
  const [settings, pending, failed] = await Promise.all([
    app.prisma.siteNotificationSettings.findUnique({ where: { siteId } }),
    app.prisma.submission.count({ where: { siteId, notifyStatus: { in: ["pending", "sending"] } } }),
    app.prisma.submission.count({ where: { siteId, notifyStatus: "failed" } }),
  ]);
  return publicView(settings, { pending, failed });
}

function adminBaseUrl(request: FastifyRequest): string {
  return (config.ADMIN_PUBLIC_URL || `${request.protocol}://${request.host}`).replace(/\/$/, "");
}

function redirectUri(request: FastifyRequest, provider: OAuthMailProvider): string {
  return `${adminBaseUrl(request)}/api/oauth/mail/${provider}/callback`;
}

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export async function registerSiteNotificationRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("admin"));

  app.get<{ Params: SiteParams }>("/:siteKey/notifications", async (request) => {
    const site = await requireSite(app, request.params.siteKey);
    return loadView(app, site.id);
  });

  app.put<{ Params: SiteParams; Body: NotificationsBody }>("/:siteKey/notifications", { schema: updateSchema }, async (request) => {
    const site = await requireSite(app, request.params.siteKey);
    const { smtpPassword, fromAddress, ...rest } = request.body;
    request.log.info({ op: "notifications.update", siteKey: site.key, provider: rest.provider, enabled: rest.enabled, recipients: rest.recipients?.length, passwordChange: smtpPassword === undefined || smtpPassword === "" ? "keep" : smtpPassword === null ? "clear" : "set" }, "notifications.update requested");

    const data = {
      ...rest,
      ...(fromAddress !== undefined && { fromAddress: fromAddress || null }),
      ...(smtpPassword === null && { smtpPasswordEnc: null }),
      ...(smtpPassword && { smtpPasswordEnc: encryptSecret(smtpPassword) }),
    };
    await app.prisma.siteNotificationSettings.upsert({
      where: { siteId: site.id },
      create: { siteId: site.id, ...data },
      update: data,
    });
    request.log.info({ op: "notifications.update", siteKey: site.key }, "notifications.update done");
    return loadView(app, site.id);
  });

  app.post<{ Params: SiteParams }>("/:siteKey/notifications/test", async (request, reply) => {
    const site = await requireSite(app, request.params.siteKey);
    const settings = await app.prisma.siteNotificationSettings.findUnique({ where: { siteId: site.id } });
    if (!settings) throw badRequest("Save the notification settings first");
    request.log.info({ op: "notifications.test", siteKey: site.key, provider: settings.provider }, "notifications.test requested");
    try {
      const outcome = await sendMail(settings, {
        to: settings.recipients,
        subject: `AgentiCMS test: ${site.name}`,
        text: `This test message confirms that submission notifications for ${site.name} can be delivered.`,
      });
      if (outcome.oauthRefreshEnc) {
        await app.prisma.siteNotificationSettings.update({ where: { siteId: site.id }, data: { oauthRefreshEnc: outcome.oauthRefreshEnc } });
      }
      request.log.info({ op: "notifications.test", siteKey: site.key }, "notifications.test done");
      return { ok: true, recipients: settings.recipients.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      request.log.warn({ op: "notifications.test", siteKey: site.key, error: message }, "notifications.test failed");
      return reply.status(502).send({ error: message });
    }
  });

  app.post<{ Params: SiteParams; Body: Record<string, never> }>("/:siteKey/notifications/retry-failed", async (request) => {
    const site = await requireSite(app, request.params.siteKey);
    const res = await app.prisma.submission.updateMany({
      where: { siteId: site.id, notifyStatus: "failed" },
      data: { notifyStatus: "pending", notifyNextAt: new Date(), notifyAttempts: 0 },
    });
    request.log.info({ op: "notifications.retry", siteKey: site.key, count: res.count }, res.count ? "notifications.retry done" : "notifications.retry NO-OP — nothing failed");
    return { requeued: res.count };
  });

  app.post<{ Params: SiteParams & { provider: string } }>("/:siteKey/notifications/oauth/:provider/start", async (request) => {
    const { siteKey, provider } = request.params;
    const site = await requireSite(app, siteKey);
    if (!isOAuthProvider(provider)) throw badRequest("Unknown provider");
    if (!oauthConfigured(provider)) throw badRequest(`${provider} OAuth is not configured on this server`);
    if (config.SECRETS_KEY.length < 32) throw badRequest("SECRETS_KEY must be set to store the connected account");
    const state = jwt.sign({ siteKey: site.key, provider, sub: request.user?.id }, config.JWT_SECRET, { audience: STATE_AUDIENCE, expiresIn: "10m" });
    request.log.info({ op: "notifications.oauth.start", siteKey: site.key, provider }, "notifications.oauth.start done");
    return { url: buildAuthorizeUrl(provider, redirectUri(request, provider), state) };
  });

  app.delete<{ Params: SiteParams }>("/:siteKey/notifications/oauth", async (request) => {
    const site = await requireSite(app, request.params.siteKey);
    const res = await app.prisma.siteNotificationSettings.updateMany({
      where: { siteId: site.id },
      data: { oauthAccount: null, oauthRefreshEnc: null, oauthConnectedAt: null },
    });
    request.log.info({ op: "notifications.oauth.disconnect", siteKey: site.key, count: res.count }, res.count ? "notifications.oauth.disconnect done" : "notifications.oauth.disconnect NO-OP — no settings");
    return loadView(app, site.id);
  });
}

// Public: the provider redirects the admin's browser here. Trust comes from
// the signed, short-lived state minted by the authenticated start endpoint.
export default async function mailOAuthCallbackRoutes(app: FastifyInstance) {
  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    "/mail/:provider/callback",
    async (request, reply) => {
      const { provider } = request.params;
      const { code, state, error, error_description } = request.query;
      const back = (siteKey: string, result: string, reason?: string) =>
        reply.redirect(`${adminBaseUrl(request)}/sites/${encodeURIComponent(siteKey)}/settings?mail=${result}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}#notifications`);

      let claims: { siteKey: string; provider: string };
      try {
        claims = jwt.verify(state ?? "", config.JWT_SECRET, { audience: STATE_AUDIENCE }) as typeof claims;
      } catch (err) {
        request.log.warn({ op: "notifications.oauth.callback", provider, err: (err as Error).message }, "notifications.oauth.callback rejected — bad state");
        return reply.status(400).send({ error: "Invalid or expired OAuth state" });
      }
      if (!isOAuthProvider(provider) || claims.provider !== provider) {
        return reply.status(400).send({ error: "Provider mismatch" });
      }
      if (error || !code) {
        request.log.warn({ op: "notifications.oauth.callback", siteKey: claims.siteKey, provider, error }, "notifications.oauth.callback denied by provider");
        return back(claims.siteKey, "error", error_description ?? error ?? "No authorization code");
      }

      try {
        const site = await requireSite(app, claims.siteKey);
        const tokens = await exchangeCode(provider, code, redirectUri(request, provider));
        if (!tokens.refresh_token) throw new Error("The provider returned no refresh token");
        const account = await fetchAccountEmail(provider, tokens.access_token);
        const data = { provider, oauthAccount: account, oauthRefreshEnc: encryptSecret(tokens.refresh_token), oauthConnectedAt: new Date() };
        await app.prisma.siteNotificationSettings.upsert({ where: { siteId: site.id }, create: { siteId: site.id, ...data }, update: data });
        request.log.info({ op: "notifications.oauth.callback", siteKey: site.key, provider }, "notifications.oauth.callback done — account connected");
        return back(site.key, "connected");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        request.log.error({ op: "notifications.oauth.callback", siteKey: claims.siteKey, provider, error: message }, "notifications.oauth.callback failed");
        return back(claims.siteKey, "error", message);
      }
    },
  );
}
