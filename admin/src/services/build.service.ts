import type { Build, PrismaClient } from "@prisma/client";
import { runBuild, rollback as runRollback } from "./website-build/build-runner.js";

const DEFAULT_SITE_KEY = "demo";
const MAX_ACTIVE_BUILDS = 20;

let buildQueue: Promise<unknown> = Promise.resolve();
let admissionQueue: Promise<unknown> = Promise.resolve();

async function withBuildLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = buildQueue;
  let release!: () => void;
  buildQueue = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

async function withAdmissionLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = admissionQueue;
  let release!: () => void;
  admissionQueue = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

export class BuildQueueAdmissionError extends Error {
  constructor(activeBuilds: number) {
    super(`Build queue is full (${activeBuilds} active builds)`);
    this.name = "BuildQueueAdmissionError";
  }
}

export interface BuildAdmission {
  build: Build;
  coalesced: boolean;
}

export async function admitBuild(prisma: PrismaClient, siteId: string, target: "staging" | "production"): Promise<BuildAdmission> {
  return withAdmissionLock(async () => {
    const existing = await prisma.build.findFirst({
      where: {
        siteId,
        target,
        status: { in: ["pending", "building"] },
      },
      orderBy: { startedAt: "asc" },
    });
    if (existing) {
      return { build: existing, coalesced: true };
    }

    const activeBuilds = await prisma.build.count({ where: { status: { in: ["pending", "building"] } } });
    if (activeBuilds >= MAX_ACTIVE_BUILDS) {
      throw new BuildQueueAdmissionError(activeBuilds);
    }

    const build = await prisma.build.create({ data: { siteId, target, status: "pending" } });
    return { build, coalesced: false };
  });
}

// ── In-process build trigger ─────────────────────────────────────────────────
//
// Previously these functions POSTed to a separate Website container which ran
// the astro build and called back into POST /api/builds/:id/status. Now the
// build runs in the admin process itself and writes its result straight to the
// DB. Public signatures take a PrismaClient so routes/builds.ts can pass
// `app.prisma` through.

async function markBuilding(prisma: PrismaClient, buildId: string): Promise<void> {
  await prisma.build.update({
    where: { id: buildId },
    data: { status: "building" },
  });
}

async function markFinished(
  prisma: PrismaClient,
  buildId: string,
  success: boolean,
  outputPath: string | undefined,
  errorLog: string | undefined,
): Promise<void> {
  await prisma.build.update({
    where: { id: buildId },
    data: {
      status: success ? "success" : "failed",
      finishedAt: new Date(),
      outputPath: outputPath ?? null,
      errorLog: errorLog ?? null,
    },
  });
}

export async function triggerBuild(
  prisma: PrismaClient,
  buildId: string,
  siteKeyOrTarget: string,
  maybeTarget?: string,
): Promise<void> {
  const siteKey = maybeTarget === undefined ? DEFAULT_SITE_KEY : siteKeyOrTarget;
  const target = maybeTarget ?? siteKeyOrTarget;
  await withBuildLock(async () => {
    await markBuilding(prisma, buildId);
    const result = await runBuild(prisma, buildId, siteKey, target);
    await markFinished(prisma, buildId, result.success, result.outputPath, result.errorLog);
  });
}

export async function triggerRollback(
  prisma: PrismaClient,
  buildId: string,
  outputPath: string,
  siteKeyOrTarget: string,
  maybeTarget?: string,
): Promise<void> {
  const siteKey = maybeTarget === undefined ? DEFAULT_SITE_KEY : siteKeyOrTarget;
  const target = maybeTarget ?? siteKeyOrTarget;
  await withBuildLock(async () => {
    await markBuilding(prisma, buildId);
    const result = await runRollback(prisma, buildId, outputPath, siteKey, target);
    await markFinished(prisma, buildId, result.success, result.outputPath, result.errorLog);
  });
}
