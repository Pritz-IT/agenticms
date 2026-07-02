import type { FastifyInstance } from "fastify";
import { createTestUser } from "./auth.js";
import { approveDeviceChallenge, consumeApprovedChallenge, createDeviceChallenge } from "../../src/services/cli-auth.js";

let seq = 0; // self-contained unique email; helpers/auth.ts exports no uniqueEmail

export async function issueCliToken(app: FastifyInstance): Promise<string> {
  const { user: admin } = await createTestUser(app, { role: "admin", email: `cli-admin-${seq++}@example.com` });
  const challenge = await createDeviceChallenge(app.prisma, "test");
  await approveDeviceChallenge(app.prisma, challenge.deviceId, challenge.code, admin);
  const issued = await consumeApprovedChallenge(app.prisma, challenge.deviceId, challenge.deviceSecret);
  return issued!.token;
}
