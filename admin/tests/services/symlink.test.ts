import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";

let tempDir: string;
let previousBuildsDir: string;
let previousCwd: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "sf-symlink-"));
  previousBuildsDir = config.BUILDS_DIR;
  previousCwd = process.cwd();
  process.chdir(tempDir);
  (config as { BUILDS_DIR: string }).BUILDS_DIR = "builds";
});

afterEach(async () => {
  (config as { BUILDS_DIR: string }).BUILDS_DIR = previousBuildsDir;
  process.chdir(previousCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("website build symlinks", () => {
  it("creates an absolute symlink target when BUILDS_DIR is relative", async () => {
    const buildDir = join("builds", "demo", "production-1");
    await mkdir(buildDir, { recursive: true });
    await writeFile(join(buildDir, "index.html"), "demo");

    const { swapSymlink } = await import("../../src/services/website-build/symlink.js");
    await swapSymlink("demo", "production", buildDir);

    const linkPath = join(tempDir, "builds", "demo", "current-production");
    await expect(readFile(join(linkPath, "index.html"), "utf-8")).resolves.toBe("demo");
    await expect(readlink(linkPath)).resolves.toBe(resolve(buildDir));
  });

  it("rejects build directories outside the selected site and target", async () => {
    const demoBuild = join("builds", "demo", "production-1");
    const stagingBuild = join("builds", "sample", "staging-1");
    await mkdir(demoBuild, { recursive: true });
    await mkdir(stagingBuild, { recursive: true });

    const { swapSymlink } = await import("../../src/services/website-build/symlink.js");

    await expect(swapSymlink("sample", "production", demoBuild)).rejects.toThrow(
      "Build directory is outside sample/production builds"
    );
    await expect(swapSymlink("sample", "production", stagingBuild)).rejects.toThrow(
      "Build directory is outside sample/production builds"
    );
    await expect(readlink(join(tempDir, "builds", "sample", "current-production"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
