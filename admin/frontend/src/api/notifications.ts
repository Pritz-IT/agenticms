import { api } from "./client";

export type MailProvider = "smtp" | "microsoft" | "google";

export interface NotificationSettings {
  enabled: boolean;
  provider: MailProvider | null;
  recipients: string[];
  fromAddress: string | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean;
  smtpUser: string | null;
  hasSmtpPassword: boolean;
  oauthAccount: string | null;
  oauthConnectedAt: string | null;
  available: { microsoft: boolean; google: boolean; secretsKey: boolean };
  deliveries: { pending: number; failed: number };
}

export type NotificationSettingsUpdate = Partial<Omit<NotificationSettings, "hasSmtpPassword" | "oauthAccount" | "oauthConnectedAt" | "available" | "deliveries">> & {
  smtpPassword?: string | null;
};

const base = (siteKey: string) => `/api/sites/${siteKey}/notifications`;

export function fetchNotificationSettings(siteKey: string): Promise<NotificationSettings> {
  return api<NotificationSettings>(base(siteKey));
}

export function updateNotificationSettings(siteKey: string, data: NotificationSettingsUpdate): Promise<NotificationSettings> {
  return api<NotificationSettings>(base(siteKey), { method: "PUT", body: JSON.stringify(data) });
}

export function sendTestNotification(siteKey: string): Promise<{ ok: true; recipients: number }> {
  return api(`${base(siteKey)}/test`, { method: "POST" });
}

export function retryFailedNotifications(siteKey: string): Promise<{ requeued: number }> {
  return api(`${base(siteKey)}/retry-failed`, { method: "POST", body: "{}" });
}

export function startMailOAuth(siteKey: string, provider: "microsoft" | "google"): Promise<{ url: string }> {
  return api(`${base(siteKey)}/oauth/${provider}/start`, { method: "POST" });
}

export function disconnectMailOAuth(siteKey: string): Promise<NotificationSettings> {
  return api<NotificationSettings>(`${base(siteKey)}/oauth`, { method: "DELETE" });
}
