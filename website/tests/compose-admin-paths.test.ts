import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression: the admin process resolves LAYOUTS_DIR/ASSETS_DIR relative to
// its WORKDIR (/app) when unset, so they MUST be set in compose to the
// container-side volume mount points — otherwise the layout-watcher watches
// the wrong dir and asset uploads land in ephemeral storage (not the volume).

const yaml = readFileSync(
  fileURLToPath(new URL("../../docker-compose.yml", import.meta.url)),
  "utf-8"
);

const m = yaml.match(/\n {2}admin:\n([\s\S]*?)(?=\n {2}\w[\w-]*:\n|\nvolumes:|\nnetworks:|$)/);
assert.ok(m, "admin service block not found");
const adminBlock = m![1];

// env values must match the volume mount targets
const expect: Record<string, string> = {
  LAYOUTS_DIR: "/layouts",
  ASSETS_DIR: "/assets",
  BUILDS_DIR: "/var/www/builds",
};
for (const [k, v] of Object.entries(expect)) {
  assert.ok(
    new RegExp(`-\\s*${k}=${v}(\\s|$)`, "m").test(adminBlock),
    `admin env must set ${k}=${v} (matches its volume mount)`
  );
  // source may be a named volume (layouts) or a bind mount (./layouts)
  assert.ok(
    new RegExp(`-\\s*[^\\s:]+:${v}(:|\\s|$)`, "m").test(adminBlock),
    `admin must mount something at ${v} for ${k}`
  );
}

console.log("compose-admin-paths tests passed");
