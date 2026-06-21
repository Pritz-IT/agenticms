import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient, User } from "@prisma/client";

export const CLI_SCOPES = ["layouts:write", "assets:write", "builds:write", "status:read", "sites:write", "pages:write"] as const;
export type CliScope = (typeof CLI_SCOPES)[number];

const DEVICE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface DeviceChallenge {
  deviceId: string;
  deviceSecret: string;
  code: string;
  expiresAt: Date;
  label: string;
}

export interface IssuedCliToken {
  token: string;
  expiresAt: Date;
  scopes: CliScope[];
}

export interface VerifiedCliToken {
  id: string;
  scopes: CliScope[];
  user: Pick<User, "id" | "email" | "role">;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function secretsMatch(provided: string, expectedHash: string): boolean {
  const providedHash = Buffer.from(sha256(provided), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return providedHash.length === expected.length && timingSafeEqual(providedHash, expected);
}

export function makeOtp(): string {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

export function makeSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export async function pruneOldDeviceChallenges(prisma: PrismaClient): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_AFTER_MS);
  await prisma.cliDeviceChallenge.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: cutoff } },
        { consumedAt: { lt: cutoff } },
      ],
    },
  });
}

export async function createDeviceChallenge(
  prisma: PrismaClient,
  label = "AgentiCMS CLI"
): Promise<DeviceChallenge> {
  await pruneOldDeviceChallenges(prisma);

  const code = makeOtp();
  const deviceSecret = makeSecret("sfdev");
  const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);
  const cleanLabel = label.trim().slice(0, 80) || "AgentiCMS CLI";

  const challenge = await prisma.cliDeviceChallenge.create({
    data: {
      label: cleanLabel,
      codeHash: sha256(code),
      deviceHash: sha256(deviceSecret),
      expiresAt,
    },
  });

  return {
    deviceId: challenge.id,
    deviceSecret,
    code,
    expiresAt,
    label: cleanLabel,
  };
}

export async function approveDeviceChallenge(
  prisma: PrismaClient,
  id: string,
  code: string,
  user: { id: string; role: string }
): Promise<boolean> {
  if (user.role !== "admin") return false;

  const challenge = await prisma.cliDeviceChallenge.findUnique({ where: { id } });
  if (!challenge) return false;
  if (challenge.consumedAt || challenge.approvedAt) return false;
  if (challenge.expiresAt <= new Date()) return false;
  if (!secretsMatch(code.replace(/\D/g, ""), challenge.codeHash)) return false;

  await prisma.cliDeviceChallenge.update({
    where: { id },
    data: {
      approvedAt: new Date(),
      approvedById: user.id,
    },
  });

  return true;
}

export async function consumeApprovedChallenge(
  prisma: PrismaClient,
  id: string,
  deviceSecret: string
): Promise<IssuedCliToken | null> {
  const now = new Date();
  const challenge = await prisma.cliDeviceChallenge.findUnique({ where: { id } });
  if (!challenge) return null;
  if (!challenge.approvedAt || !challenge.approvedById) return null;
  if (challenge.consumedAt || challenge.expiresAt <= now) return null;
  if (!secretsMatch(deviceSecret, challenge.deviceHash)) return null;

  const token = makeSecret("sfcli");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const consumed = await prisma.cliDeviceChallenge.updateMany({
    where: {
      id,
      consumedAt: null,
      approvedAt: { not: null },
      expiresAt: { gt: now },
    },
    data: { consumedAt: now },
  });
  if (consumed.count !== 1) return null;

  await prisma.cliToken.create({
    data: {
      tokenHash: sha256(token),
      userId: challenge.approvedById,
      label: challenge.label,
      scopes: [...CLI_SCOPES],
      expiresAt,
    },
  });

  return { token, expiresAt, scopes: [...CLI_SCOPES] };
}

export async function findValidCliToken(
  prisma: PrismaClient,
  rawToken: string
): Promise<VerifiedCliToken | null> {
  if (!rawToken.startsWith("sfcli_")) return null;

  const token = await prisma.cliToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { user: true },
  });
  if (!token || token.revokedAt || token.expiresAt <= new Date()) return null;

  await prisma.cliToken.update({
    where: { id: token.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    id: token.id,
    scopes: token.scopes as CliScope[],
    user: {
      id: token.user.id,
      email: token.user.email,
      role: token.user.role,
    },
  };
}

export async function verifyCliToken(
  prisma: PrismaClient,
  rawToken: string,
  requiredScope: CliScope
): Promise<VerifiedCliToken | null> {
  const token = await findValidCliToken(prisma, rawToken);
  if (!token || !token.scopes.includes(requiredScope)) return null;
  return token;
}

export async function revokeCliToken(prisma: PrismaClient, rawToken: string): Promise<boolean> {
  if (!rawToken.startsWith("sfcli_")) return false;

  const result = await prisma.cliToken.updateMany({
    where: {
      tokenHash: sha256(rawToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  return result.count === 1;
}
