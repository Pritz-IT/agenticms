import { randomUUID } from "crypto";
import pino, { type Logger, type LoggerOptions } from "pino";

const REQ_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

function resolveLevel(): string {
  return (
    process.env["LOG_LEVEL"] ??
    (process.env["NODE_ENV"] === "production" ? "info" : "debug")
  );
}

function genReqId(req: { headers: Record<string, unknown> }): string {
  const hdr = req.headers["x-request-id"];
  const value = Array.isArray(hdr) ? hdr[0] : hdr;
  if (typeof value === "string" && REQ_ID_RE.test(value)) return value;
  return randomUUID();
}

const isDev = process.env["NODE_ENV"] !== "production" && process.env["NODE_ENV"] !== "test";

// A pino transport spawns a worker and cannot coexist with an injected
// stream, so it is omitted under test. Level is the only behavioral dial.
export const loggerOptions: LoggerOptions & {
  genReqId: (req: { headers: Record<string, unknown> }) => string;
} = {
  level: resolveLevel(),
  base: { service: "admin" },
  redact: {
    // fast-redact: "*.x" matches one level deep only, not arbitrary nesting
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-api-key"]',
      "*.password",
      "*.passwordHash",
      "*.token",
      "*.refreshToken",
    ],
    censor: "[redacted]",
  },
  genReqId,
  ...(isDev ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } } : {}),
};

// `log` is lazy: importing this module must not construct a pino-pretty
// transport (a worker thread). The first property access (in the running
// server) builds the real logger; unit tests that only read `loggerOptions`
// never trigger it.
let _log: Logger | null = null;
export const log: Logger = new Proxy({} as Logger, {
  get(_t, prop) {
    _log ??= pino(loggerOptions);
    const v = (_log as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(_log) : v;
  },
}) as Logger;
