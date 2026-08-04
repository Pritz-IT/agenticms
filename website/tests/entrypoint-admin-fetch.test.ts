import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Regression for the pflegezeit24 outage (2026-07-02 → 2026-08-04): the
// entrypoint fetched the site list and nginx host map exactly once at startup.
// Admin and website start together, so the admin was still migrating; the fetch
// failed, `|| true` swallowed it, and nginx ran with `default default;` for a
// month. Every host — including a fully built site — served the default site's
// "No build yet" placeholder, with no error in any log.

const root = fileURLToPath(new URL("..", import.meta.url));
const entrypoint = readFileSync(root + "docker-entrypoint.sh", "utf-8");

// 1. The failure must never be swallowed back into the default fallback.
assert.ok(
  !/fetch_internal\s+"\/api\/sites\/(keys\.txt|nginx-map)"\s*\|\|\s*true/.test(entrypoint),
  "entrypoint must not swallow a failed admin fetch with `|| true`"
);

// 2. Both fetches go through the retrying wrapper.
for (const path of ["/api/sites/keys.txt", "/api/sites/nginx-map"]) {
  assert.match(
    entrypoint,
    new RegExp(`fetch_internal_retry "${path.replace(/\//g, "\\/")}"`),
    `entrypoint must fetch ${path} with retries`
  );
}

// 3. A configured-but-unreachable admin is fatal, not a silent fallback.
assert.ok(
  entrypoint.includes("fail_admin_unreachable"),
  "entrypoint must fail loudly when a configured admin never answers"
);
assert.match(entrypoint, /exit 1/, "fail_admin_unreachable must exit non-zero");

// 4. Behavioural check: run the real script against a stub admin that fails
//    the first N calls, and assert it still ends up with the live host map.
const sandbox = mkdtempSync(join(tmpdir(), "agenticms-entrypoint-"));
const bin = join(sandbox, "bin");
execFileSync("mkdir", ["-p", bin, join(sandbox, "etc/nginx"), join(sandbox, "www/builds")]);

// Stub `wget`: fail twice (admin still migrating), then serve the real payloads.
writeFileSync(
  join(bin, "wget"),
  `#!/bin/sh
n=$(cat "${sandbox}/attempts" 2>/dev/null || echo 0)
n=$((n + 1)); echo "$n" > "${sandbox}/attempts"
[ "$n" -le 2 ] && exit 1
case "$*" in
  *keys.txt*)   echo "pflegezeit" ;;
  *nginx-map*)  printf 'default pflegezeit;\\npflegezeit24.at pflegezeit;\\nwww.pflegezeit24.at pflegezeit;\\n' ;;
esac
exit 0
`,
  { mode: 0o755 }
);
// `sleep` is the retry delay — make the test instant.
writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
// `nginx` is the exec'd final command — capture instead of running it.
writeFileSync(join(bin, "nginx"), `#!/bin/sh\ntouch "${sandbox}/nginx-started"\n`, { mode: 0o755 });

// Run the script with its absolute paths redirected into the sandbox.
const script = entrypoint
  .replace(/\/var\/www\/builds/g, join(sandbox, "www/builds"))
  .replace(/\/etc\/nginx/g, join(sandbox, "etc/nginx"))
  .replace(/\/tmp\/(nginx\.conf|site-host-map\.conf)/g, join(sandbox, "$1"));
const scriptPath = join(sandbox, "entrypoint.sh");
writeFileSync(scriptPath, script);
chmodSync(scriptPath, 0o755);
writeFileSync(join(sandbox, "etc/nginx/nginx.conf.template"), "http {\n    map $host $site_key {\n__SITE_HOST_MAP__\n    }\n}\n");

execFileSync("/bin/sh", [scriptPath], {
  env: { PATH: `${bin}:${process.env.PATH}`, INTERNAL_API_KEY: "test-key", ADMIN_API_URL: "http://admin:3000" },
  timeout: 20_000,
});

const rendered = readFileSync(join(sandbox, "etc/nginx/nginx.conf"), "utf-8");
assert.match(
  rendered,
  /www\.pflegezeit24\.at pflegezeit;/,
  "after transient admin failures the rendered map must carry the live hosts, not `default default;`"
);
assert.ok(
  !/^\s*default default;/m.test(rendered),
  "the boot-time fallback map must not survive a recovered admin"
);

console.log("entrypoint-admin-fetch tests passed");
