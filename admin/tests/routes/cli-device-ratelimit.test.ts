import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { createDeviceChallenge } from "../../src/services/cli-auth.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await app.prisma.cliDeviceChallenge.deleteMany();
});

describe("POST /api/cli/device/:id/token rate limit", () => {
  const poll = (deviceId: string, deviceSecret: string) =>
    app.inject({
      method: "POST",
      url: `/api/cli/device/${deviceId}/token`,
      payload: { deviceSecret },
    });

  it("tolerates a full device-lifetime of polling without a lockout", async () => {
    const challenge = await createDeviceChallenge(app.prisma, "ratelimit test");

    // A 10-minute device polled at the 5s client cadence is ~120 requests.
    // Under the old shared IP limit (30 / 10 min) this would 429 at #31.
    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      const res = await poll(challenge.deviceId, challenge.deviceSecret);
      statuses.push(res.statusCode);
    }

    expect(statuses.every((code) => code === 202)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  it("keeps each device's poll budget independent (keyed by deviceId)", async () => {
    const a = await createDeviceChallenge(app.prisma, "device a");
    const b = await createDeviceChallenge(app.prisma, "device b");

    // Spend a chunk of device A's budget; device B must be unaffected.
    for (let i = 0; i < 40; i += 1) {
      expect((await poll(a.deviceId, a.deviceSecret)).statusCode).toBe(202);
    }
    expect((await poll(b.deviceId, b.deviceSecret)).statusCode).toBe(202);
  });
});
