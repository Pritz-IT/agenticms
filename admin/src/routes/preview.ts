import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { PreviewSnapshot } from "../services/blog/preview-store.js";
import { sendPostMedia } from "./post-media-response.js";

// Blog post previews at /preview/<token>. Admin API auth is a Bearer header, which a
// plain navigation never carries, so these routes use their own cookie: minted by the
// Bearer-authenticated preview POST, scoped to /preview, 15 minutes. The token alone
// opens nothing without it, and the cookie alone names no preview.
const PREVIEW_COOKIE = "agenticms_preview";
const PREVIEW_AUDIENCE = "preview";
const COOKIE_TTL_SECONDS = 15 * 60;

const PREVIEW_CSP = [
  "default-src 'self'", "img-src 'self' data: https:", "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:", "script-src 'self'", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'none'",
].join("; ");

// Reloads the tab when the editor publishes a new version, keeping the scroll position.
// Inert inside the editor's srcdoc iframe, which does not allow scripts.
const LIVE_SCRIPT = `(() => {
  const key = "agenticms-preview-scroll:" + location.pathname;
  const saved = sessionStorage.getItem(key);
  if (saved !== null) {
    sessionStorage.removeItem(key);
    addEventListener("load", () => scrollTo(0, Number(saved)));
  }
  let version = null;
  const events = new EventSource(location.pathname.replace(/\\/$/, "") + "/events");
  events.onmessage = (event) => {
    const next = JSON.parse(event.data).version;
    if (version !== null && next !== version) {
      sessionStorage.setItem(key, String(scrollY));
      location.reload();
    }
    version = next;
  };
})();
`;

export function issuePreviewCookie(reply: FastifyReply, userId: string): void {
  // No email/role claims: this JWT can never pass app.authenticate as a Bearer token.
  const token = jwt.sign({}, config.JWT_SECRET, { algorithm: "HS256", audience: PREVIEW_AUDIENCE, subject: userId, expiresIn: COOKIE_TTL_SECONDS });
  reply.setCookie(PREVIEW_COOKIE, token, {
    httpOnly: true, sameSite: "strict", secure: process.env["NODE_ENV"] === "production",
    path: "/preview", maxAge: COOKIE_TTL_SECONDS,
  });
}

function messagePage(reply: FastifyReply, status: number, message: string) {
  return reply.status(status).header("Cache-Control", "no-store").header("Content-Security-Policy", PREVIEW_CSP)
    .type("text/html; charset=utf-8")
    .send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Preview</title></head><body style="font-family:system-ui,sans-serif;padding:48px"><p>${message}</p></body></html>`);
}

export default async function previewRoutes(app: FastifyInstance) {
  app.get("/live.js", async (_request, reply) =>
    reply.header("Cache-Control", "no-store").type("text/javascript; charset=utf-8").send(LIVE_SCRIPT));

  async function requirePreviewSession(request: FastifyRequest, reply: FastifyReply) {
    const context = { op: "blog.preview.auth", token: (request.params as { token?: string }).token?.slice(0, 6) };
    const raw = request.cookies[PREVIEW_COOKIE];
    let userId: string | undefined;
    try {
      const payload = raw ? jwt.verify(raw, config.JWT_SECRET, { algorithms: ["HS256"], audience: PREVIEW_AUDIENCE }) : null;
      userId = typeof payload === "object" && payload !== null && typeof payload.sub === "string" ? payload.sub : undefined;
    } catch (error) {
      request.log.warn({ ...context, err: error }, "blog.preview.auth rejected — invalid or expired preview cookie");
    }
    const user = userId ? await app.prisma.user.findUnique({ where: { id: userId } }) : null;
    if (!user) {
      if (!raw) request.log.warn(context, "blog.preview.auth rejected — no preview cookie");
      else if (userId) request.log.warn({ ...context, userId }, "blog.preview.auth rejected — user no longer exists");
      return messagePage(reply, 401, "This preview only opens in a browser that is signed in to the admin. Sign in, then open the preview again from the post editor.");
    }
    request.user = { id: user.id, email: user.email, role: user.role };
  }

  function snapshotOr404(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply): PreviewSnapshot | null {
    const snapshot = app.previewStore.get(request.params.token);
    if (snapshot?.html) return snapshot;
    request.log.warn({ op: "blog.preview.open", token: request.params.token.slice(0, 6) }, "blog.preview.open NO-OP — unknown or expired preview");
    messagePage(reply, 404, "This preview has expired. Open it again from the post editor.");
    return null;
  }

  app.get<{ Params: { token: string } }>("/:token", { preHandler: requirePreviewSession }, async (request, reply) => {
    const snapshot = snapshotOr404(request, reply);
    if (!snapshot) return reply;
    request.log.info({ op: "blog.preview.open", siteKey: snapshot.siteKey, postKey: snapshot.postKey, version: snapshot.version, userId: request.user?.id }, "blog.preview.open served");
    return reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex").header("Content-Security-Policy", PREVIEW_CSP)
      .type("text/html; charset=utf-8").send(snapshot.html);
  });

  app.get<{ Params: { token: string } }>("/:token/events", { preHandler: requirePreviewSession }, async (request, reply) => {
    const snapshot = snapshotOr404(request, reply);
    if (!snapshot) return reply;
    const { token } = request.params;
    const context = { op: "blog.preview.events", siteKey: snapshot.siteKey, postKey: snapshot.postKey, userId: request.user?.id };
    request.log.info(context, "blog.preview.events connected");
    reply.hijack();
    // X-Accel-Buffering tells the website nginx to pass events through unbuffered.
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    const send = (version: number) => reply.raw.write(`data: ${JSON.stringify({ version })}\n\n`);
    send(snapshot.version);
    const unsubscribe = app.previewStore.subscribe(token, send);
    // Under nginx's 30 s proxy_read_timeout; also ends the stream once the preview expires.
    const heartbeat = setInterval(() => {
      if (app.previewStore.get(token)) reply.raw.write(": keep-alive\n\n");
      else reply.raw.end();
    }, 25_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      request.log.info(context, "blog.preview.events closed");
    });
  });

  app.get<{ Params: { token: string; "*": string } }>("/:token/media/*", { preHandler: requirePreviewSession }, async (request, reply) => {
    const snapshot = snapshotOr404(request, reply);
    if (!snapshot) return reply;
    return sendPostMedia(request, reply, snapshot.siteKey, `/media/${request.params["*"]}`);
  });
}
