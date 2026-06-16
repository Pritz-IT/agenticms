import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pino from "pino";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";

const records: any[] = [];
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: pino({ level: "debug" }, { write: (l: string) => records.push(JSON.parse(l)) }) });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  records.length = 0;
  await app.prisma.submission.deleteMany();
  await app.prisma.site.deleteMany();
  await app.prisma.site.create({
    data: {
      key: "demo",
      name: "S",
      domain: "example.com",
      stagingDomain: "staging.example.com",
      defaultLocale: "de",
      siteUrl: "https://example.com",
    },
  });
});

describe("submission guard rejection logging", () => {
  it("logs WARN with the reason when a data cap is exceeded", async () => {
    await app.inject({
      method: "POST", url: "/api/submissions",
      payload: { form: "sample-template", data: { blob: "x".repeat(3000) }, hp: "", t: 9000 },
    });
    const warn = records.find((r) => r.level === 40 && r.op === "submission.create");
    expect(warn).toBeTruthy();
    expect(typeof warn.reason).toBe("string");
  });
});
