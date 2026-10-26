import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2, Mail, RotateCw, Save, Send, Unlink } from "lucide-react";
import { toastError } from "../lib/toast-error";
import {
  disconnectMailOAuth,
  fetchNotificationSettings,
  retryFailedNotifications,
  sendTestNotification,
  startMailOAuth,
  updateNotificationSettings,
  type MailProvider,
  type NotificationSettings,
} from "../api/notifications";

const PROVIDER_LABELS: Record<MailProvider, string> = {
  smtp: "SMTP server",
  microsoft: "Microsoft 365 (OAuth)",
  google: "Google Workspace / Gmail (OAuth)",
};

function parseRecipients(value: string): string[] {
  return value.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean);
}

export function NotificationSettingsCard({ siteKey }: { siteKey: string }) {
  const qc = useQueryClient();
  const queryKey = ["notifications", siteKey];
  const query = useQuery({ queryKey, queryFn: () => fetchNotificationSettings(siteKey) });

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<MailProvider | "">("");
  const [recipients, setRecipients] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");

  useEffect(() => {
    const s = query.data;
    if (!s) return;
    setEnabled(s.enabled);
    setProvider(s.provider ?? "");
    setRecipients(s.recipients.join(", "));
    setFromAddress(s.fromAddress ?? "");
    setSmtpHost(s.smtpHost ?? "");
    setSmtpPort(s.smtpPort ? String(s.smtpPort) : "587");
    setSmtpSecure(s.smtpSecure);
    setSmtpUser(s.smtpUser ?? "");
    setSmtpPassword("");
  }, [query.data]);

  // Back from the provider's consent screen: ?mail=connected|error&reason=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("mail");
    if (!result) return;
    if (result === "connected") toast.success("Mail account connected");
    else toast.error(`Connecting the mail account failed: ${params.get("reason") ?? "unknown error"}`);
    params.delete("mail");
    params.delete("reason");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }, []);

  const onSaved = (data: NotificationSettings) => qc.setQueryData(queryKey, data);

  const save = useMutation({
    mutationFn: () =>
      updateNotificationSettings(siteKey, {
        enabled,
        provider: provider || null,
        recipients: parseRecipients(recipients),
        fromAddress: fromAddress.trim() || null,
        ...(provider === "smtp" && {
          smtpHost: smtpHost.trim() || null,
          smtpPort: smtpPort ? Number(smtpPort) : null,
          smtpSecure,
          smtpUser: smtpUser.trim() || null,
          ...(smtpPassword && { smtpPassword }),
        }),
      }),
    onSuccess: (data) => {
      onSaved(data);
      toast.success("Notification settings saved");
    },
    onError: (err) => toastError("Failed to save notification settings", err),
  });

  const test = useMutation({
    mutationFn: () => sendTestNotification(siteKey),
    onSuccess: (r) => toast.success(`Test email sent to ${r.recipients} recipient${r.recipients === 1 ? "" : "s"}`),
    onError: (err) => toastError("Test email failed", err),
  });

  const connect = useMutation({
    mutationFn: (p: "microsoft" | "google") => startMailOAuth(siteKey, p),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (err) => toastError("Could not start the account connection", err),
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectMailOAuth(siteKey),
    onSuccess: (data) => {
      onSaved(data);
      toast.success("Mail account disconnected");
    },
    onError: (err) => toastError("Failed to disconnect", err),
  });

  const retry = useMutation({
    mutationFn: () => retryFailedNotifications(siteKey),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey });
      toast.success(`${r.requeued} notification${r.requeued === 1 ? "" : "s"} queued again`);
    },
    onError: (err) => toastError("Failed to retry", err),
  });

  const s = query.data;
  const isOAuth = provider === "microsoft" || provider === "google";
  const connectedHere = isOAuth && s?.provider === provider && Boolean(s.oauthAccount);
  const oauthAvailable = isOAuth && Boolean(s?.available[provider]);

  return (
    <div id="notifications" className="surface mt-6 flex max-w-2xl flex-col gap-5 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Mail className="h-4 w-4" /> Email Notifications
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          Send an email for every new form submission. Submissions are always stored here, even when delivery fails.
        </p>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <div className="skeleton-line w-1/3" />
          <div className="skeleton-line w-2/3" />
        </div>
      ) : query.isError || !s ? (
        <p className="text-sm text-red-300">Failed to load notification settings.</p>
      ) : (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!s.available.secretsKey && (
            <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              SECRETS_KEY is not set on the server, so SMTP passwords and connected accounts cannot be stored.
            </p>
          )}

          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Email me about new submissions
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="ui-label">Recipients</label>
            <input
              type="text"
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder="info@example.com, team@example.com"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="ui-label">Send With</label>
            <select value={provider} onChange={(e) => setProvider(e.target.value as MailProvider | "")}>
              <option value="">Choose a mail provider</option>
              {(Object.keys(PROVIDER_LABELS) as MailProvider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </select>
          </div>

          {provider === "smtp" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="ui-label">Sender Address</label>
                <input type="email" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="cms@example.com" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="ui-label">SMTP Host</label>
                <input type="text" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="ui-label">Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={smtpPort}
                  onChange={(e) => {
                    setSmtpPort(e.target.value);
                    setSmtpSecure(e.target.value === "465");
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="ui-label">Username</label>
                <input type="text" autoComplete="off" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="ui-label">Password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={smtpPassword}
                  onChange={(e) => setSmtpPassword(e.target.value)}
                  placeholder={s.hasSmtpPassword ? "Stored — leave empty to keep" : ""}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-zinc-300 sm:col-span-2">
                <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
                Use TLS from the start (port 465). Leave off for STARTTLS on 587.
              </label>
            </div>
          )}

          {isOAuth && (
            <div className="flex flex-col gap-3 rounded border border-zinc-800 p-4">
              {!oauthAvailable ? (
                <p className="text-sm text-amber-200">
                  {provider === "microsoft" ? "MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET" : "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET"} are
                  not set on the server.
                </p>
              ) : connectedHere ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-zinc-300">
                    Sending as <span className="font-medium text-zinc-100">{s.oauthAccount}</span>
                  </p>
                  <button type="button" className="ui-button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
                    <Unlink className="h-4 w-4" /> Disconnect
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-zinc-400">Sign in with the mailbox that should send the notifications.</p>
                  <button
                    type="button"
                    className="ui-button ui-button-primary"
                    onClick={() => connect.mutate(provider)}
                    disabled={connect.isPending}
                  >
                    <Link2 className="h-4 w-4" />
                    Connect {provider === "microsoft" ? "Microsoft 365" : "Google"}
                  </button>
                </div>
              )}
            </div>
          )}

          {(s.deliveries.pending > 0 || s.deliveries.failed > 0) && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-800 px-3 py-2 text-xs text-zinc-400">
              <span>
                {s.deliveries.pending} waiting · <span className={s.deliveries.failed ? "text-red-300" : ""}>{s.deliveries.failed} failed</span>
              </span>
              {s.deliveries.failed > 0 && (
                <button type="button" className="ui-button" onClick={() => retry.mutate()} disabled={retry.isPending}>
                  <RotateCw className="h-4 w-4" /> Retry failed
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button type="submit" disabled={save.isPending} className="ui-button ui-button-primary">
              <Save className="h-4 w-4" />
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="ui-button" onClick={() => test.mutate()} disabled={test.isPending || !s.provider}>
              <Send className="h-4 w-4" />
              {test.isPending ? "Sending…" : "Send test email"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
