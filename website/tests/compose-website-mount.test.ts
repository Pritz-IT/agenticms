import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression: the website entrypoint bootstraps placeholder current-*
// symlinks into the builds volume on a fresh deploy. If the website service
// mounts `builds` read-only, that mkdir fails ("Read-only file system") and
// the container exits(1) on the very first `docker compose up`. Guard that
// the committed compose keeps the website builds mount writable.

const composePath = fileURLToPath(
  new URL("../../docker-compose.yml", import.meta.url)
);
const yaml = readFileSync(composePath, "utf-8");

// Extract the `website:` service block (up to the next top-level service).
const m = yaml.match(/\n {2}website:\n([\s\S]*?)(?=\n {2}\w[\w-]*:\n|\nvolumes:|\nnetworks:|$)/);
assert.ok(m, "website service block not found in docker-compose.yml");
const websiteBlock = m![1];

const buildsMount = websiteBlock
  .split("\n")
  .map((l) => l.trim())
  .find((l) => l.includes(":/var/www/builds"));

assert.ok(buildsMount, "website must mount the builds volume");
assert.ok(
  !/:ro\b/.test(buildsMount),
  `website builds mount must NOT be read-only (entrypoint bootstraps placeholders). Found: "${buildsMount}"`
);

console.log("compose-website-mount tests passed");
