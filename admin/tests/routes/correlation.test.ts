import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

function captureLogger() {
  const records: any[] = [];
  const stream = { write: (line: string) => { records.push(JSON.parse(line)); } };
  return { logger: pino({ level: "debug" }, stream), records };
}

let app: FastifyInstance;
let records: any[];

beforeAll(async () => {
  const cap = captureLogger();
  records = cap.records;
  app = await buildApp({ logger: cap.logger });
  app.get("/__boom", async () => { throw new Error("kaboom"); });
  await app.ready();
});
afterAll(async () => { await app.close(); });

describe("request correlation", () => {
  it("honors an inbound X-Request-Id and echoes it on the response", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/refresh", headers: { "x-request-id": "trace-abc_1" } });
    expect(res.headers["x-request-id"]).toBe("trace-abc_1");
  });

  it("generates and echoes an X-Request-Id when none is supplied", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/refresh" });
    expect(typeof res.headers["x-request-id"]).toBe("string");
    expect((res.headers["x-request-id"] as string).length).toBeGreaterThan(0);
  });

  it("logs an ERROR with the reqId when a route throws, body/status unchanged", async () => {
    const res = await app.inject({ method: "GET", url: "/__boom", headers: { "x-request-id": "trace-err_1" } });
    expect(res.statusCode).toBe(500);
    // "reqId" is Fastify's default requestIdLogLabel (not overridden in loggerOptions)
    const errRec = records.find((r) => r.level === 50 && r.reqId === "trace-err_1");
    expect(errRec).toBeTruthy();
    expect(errRec.msg).toBe("request failed");
  });
});
