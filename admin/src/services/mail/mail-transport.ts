import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { SiteNotificationSettings } from "@prisma/client";
import { decryptSecret, encryptSecret } from "./secret-box.js";
import { refreshAccessToken } from "./mail-oauth.js";

export interface MailMessage {
  to: string[];
  replyTo?: string | null;
  subject: string;
  text: string;
}

// What a send changed in the stored settings (Microsoft rotates refresh tokens).
export interface SendOutcome {
  oauthRefreshEnc?: string;
}

const TIMEOUT_MS = 20_000;

export function missingSettings(s: SiteNotificationSettings): string | null {
  if (!s.provider) return "No mail provider selected";
  if (s.recipients.length === 0) return "No recipients configured";
  if (s.provider === "smtp") {
    if (!s.smtpHost || !s.smtpPort) return "SMTP host and port are required";
    if (!s.fromAddress) return "A sender address is required for SMTP";
    return null;
  }
  if (!s.oauthRefreshEnc) return `The ${s.provider === "microsoft" ? "Microsoft 365" : "Google"} account is not connected`;
  return null;
}

async function sendSmtp(s: SiteNotificationSettings, msg: MailMessage): Promise<SendOutcome> {
  const transport = createTransport({
    host: s.smtpHost!,
    port: s.smtpPort!,
    secure: s.smtpSecure,
    ...(s.smtpUser ? { auth: { user: s.smtpUser, pass: s.smtpPasswordEnc ? decryptSecret(s.smtpPasswordEnc) : "" } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  });
  try {
    await transport.sendMail({ from: s.fromAddress!, to: msg.to, replyTo: msg.replyTo ?? undefined, subject: msg.subject, text: msg.text });
  } finally {
    transport.close();
  }
  return {};
}

async function accessToken(s: SiteNotificationSettings, provider: "microsoft" | "google"): Promise<{ token: string; outcome: SendOutcome }> {
  const tokens = await refreshAccessToken(provider, decryptSecret(s.oauthRefreshEnc!));
  return {
    token: tokens.access_token,
    outcome: tokens.refresh_token ? { oauthRefreshEnc: encryptSecret(tokens.refresh_token) } : {},
  };
}

// A sender other than the connected account (e.g. a shared mailbox) goes in
// message.from; Exchange then requires Send As (or Send on Behalf) rights for
// the connected user on that mailbox.
export function microsoftFrom(s: Pick<SiteNotificationSettings, "fromAddress" | "oauthAccount">) {
  const from = s.fromAddress?.trim();
  if (!from || from.toLowerCase() === s.oauthAccount?.toLowerCase()) return {};
  return { from: { emailAddress: { address: from } } };
}

async function sendMicrosoft(s: SiteNotificationSettings, msg: MailMessage): Promise<SendOutcome> {
  const { token, outcome } = await accessToken(s, "microsoft");
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        ...microsoftFrom(s),
        subject: msg.subject,
        body: { contentType: "Text", content: msg.text },
        toRecipients: msg.to.map((address) => ({ emailAddress: { address } })),
        ...(msg.replyTo ? { replyTo: [{ emailAddress: { address: msg.replyTo } }] } : {}),
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 202) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const hint = body.error?.code === "ErrorSendAsDenied" ? ` - give ${s.oauthAccount} "Send As" rights on ${s.fromAddress} in Exchange` : "";
    throw new Error(`Microsoft Graph sendMail failed (${res.status}): ${body.error?.code ?? ""} ${body.error?.message ?? ""}`.trim() + hint);
  }
  return outcome;
}

async function sendGoogle(s: SiteNotificationSettings, msg: MailMessage): Promise<SendOutcome> {
  const { token, outcome } = await accessToken(s, "google");
  const raw = await new MailComposer({
    from: s.fromAddress || s.oauthAccount || undefined,
    to: msg.to,
    replyTo: msg.replyTo ?? undefined,
    subject: msg.subject,
    text: msg.text,
  }).compile().build();
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: raw.toString("base64url") }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string } };
    throw new Error(`Gmail send failed (${res.status}): ${body.error?.status ?? ""} ${body.error?.message ?? ""}`.trim());
  }
  return outcome;
}

export async function sendMail(s: SiteNotificationSettings, msg: MailMessage): Promise<SendOutcome> {
  const missing = missingSettings(s);
  if (missing) throw new Error(missing);
  switch (s.provider) {
    case "smtp":
      return sendSmtp(s, msg);
    case "microsoft":
      return sendMicrosoft(s, msg);
    case "google":
      return sendGoogle(s, msg);
    default:
      throw new Error("No mail provider selected");
  }
}
