import type { FastifyInstance } from "fastify";
import type { Site, Submission } from "@prisma/client";
import { config } from "../../config.js";
import { log } from "../../logging.js";
import { sendMail, type MailMessage } from "./mail-transport.js";

// Delay before attempt n+1 (index = attempts so far). After the last one the row is `failed`.
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
// A `sending` row older than this belongs to a crashed process and is retried.
const STALE_SENDING_MS = 10 * 60_000;
const BATCH = 20;

const COPY = {
  de: { subject: (site: string, form: string) => `Neue Anfrage über ${site} (${form})`, intro: "Über das Formular ist eine neue Anfrage eingegangen.", open: "Im Admin ansehen" },
  en: { subject: (site: string, form: string) => `New submission on ${site} (${form})`, intro: "A new form submission has arrived.", open: "View in admin" },
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function buildSubmissionMessage(site: Pick<Site, "key" | "name" | "defaultLocale">, submission: Submission, recipients: string[]): MailMessage {
  const copy = site.defaultLocale.toLowerCase().startsWith("de") ? COPY.de : COPY.en;
  const data = (submission.data ?? {}) as Record<string, unknown>;
  const lines = [copy.intro, ""];
  for (const [key, value] of Object.entries(data)) {
    lines.push(`${key}: ${formatValue(value)}`);
  }
  if (submission.email && !Object.values(data).includes(submission.email)) lines.push(`email: ${submission.email}`);
  if (submission.score !== null) lines.push(`score: ${submission.score}`);
  if (config.ADMIN_PUBLIC_URL) {
    lines.push("", `${copy.open}: ${config.ADMIN_PUBLIC_URL.replace(/\/$/, "")}/sites/${site.key}/submissions`);
  }
  const dataEmail = typeof data.email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email) ? data.email : null;
  return {
    to: recipients,
    replyTo: submission.email ?? dataEmail,
    subject: copy.subject(site.name, submission.form),
    text: lines.join("\n"),
  };
}

// Called right after a submission row is written. Marks it for delivery when
// the site has notifications on, then kicks the worker so mail goes out now
// instead of on the next poll.
export async function enqueueSubmissionNotification(app: FastifyInstance, submissionId: string, siteId: string): Promise<void> {
  const settings = await app.prisma.siteNotificationSettings.findUnique({ where: { siteId }, select: { enabled: true } });
  if (!settings?.enabled) {
    log.debug({ op: "notify.enqueue", submissionId }, "notify.enqueue NO-OP — notifications disabled for site");
    return;
  }
  await app.prisma.submission.update({
    where: { id: submissionId },
    data: { notifyStatus: "pending", notifyNextAt: new Date(), notifyError: null },
  });
  log.info({ op: "notify.enqueue", submissionId }, "notify.enqueue done");
  setImmediate(() => {
    processPendingNotifications(app).catch((err) => log.error({ op: "notify.process", err }, "notify.process failed"));
  });
}

async function deliverOne(app: FastifyInstance, id: string): Promise<void> {
  // Claim: only one process may move pending -> sending, so a row is never mailed twice concurrently.
  const claimed = await app.prisma.submission.updateMany({
    where: { id, notifyStatus: "pending" },
    data: { notifyStatus: "sending", notifyNextAt: new Date() },
  });
  if (claimed.count === 0) return;

  const submission = await app.prisma.submission.findUniqueOrThrow({
    where: { id },
    include: { site: { include: { notifications: true } } },
  });
  const settings = submission.site.notifications;
  const attempt = submission.notifyAttempts + 1;
  const ctx = { op: "notify.send", submissionId: id, siteKey: submission.site.key, provider: settings?.provider, attempt };

  try {
    if (!settings?.enabled) throw new Error("Notifications were disabled before delivery");
    log.info({ ...ctx, recipients: settings.recipients.length }, "notify.send requested");
    const outcome = await sendMail(settings, buildSubmissionMessage(submission.site, submission, settings.recipients));
    if (outcome.oauthRefreshEnc) {
      await app.prisma.siteNotificationSettings.update({ where: { siteId: settings.siteId }, data: { oauthRefreshEnc: outcome.oauthRefreshEnc } });
    }
    await app.prisma.submission.update({
      where: { id },
      data: { notifyStatus: "sent", notifiedAt: new Date(), notifyAttempts: attempt, notifyError: null, notifyNextAt: null },
    });
    log.info(ctx, "notify.send done");
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const failed = attempt >= MAX_ATTEMPTS || !settings?.enabled;
    await app.prisma.submission.update({
      where: { id },
      data: {
        notifyStatus: failed ? "failed" : "pending",
        notifyAttempts: attempt,
        notifyError: message,
        notifyNextAt: failed ? null : new Date(Date.now() + RETRY_DELAYS_MS[attempt - 1]!),
      },
    });
    if (failed) log.error({ ...ctx, error: message }, "notify.send failed permanently");
    else log.warn({ ...ctx, error: message }, "notify.send failed — will retry");
  }
}

let running = false;

export async function processPendingNotifications(app: FastifyInstance): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const recovered = await app.prisma.submission.updateMany({
      where: { notifyStatus: "sending", notifyNextAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
      data: { notifyStatus: "pending" },
    });
    if (recovered.count > 0) log.warn({ op: "notify.process", count: recovered.count }, "notify.process recovered stale sending rows");

    const due = await app.prisma.submission.findMany({
      where: { notifyStatus: "pending", notifyNextAt: { lte: new Date() } },
      orderBy: { notifyNextAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    for (const { id } of due) {
      await deliverOne(app, id);
    }
    if (due.length > 0) log.debug({ op: "notify.process", count: due.length }, "notify.process batch done");
    return due.length;
  } finally {
    running = false;
  }
}

export function startNotificationWorker(app: FastifyInstance): () => void {
  const timer = setInterval(() => {
    processPendingNotifications(app).catch((err) => log.error({ op: "notify.process", err }, "notify.process failed"));
  }, config.NOTIFY_POLL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
