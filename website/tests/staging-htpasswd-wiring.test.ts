import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regression for staging Basic Auth wiring: the build-runner writes credentials
// to ${BUILDS_DIR}/<siteKey>/.htpasswd-staging, and nginx must read the same
// site-aware path.

const root = fileURLToPath(new URL("..", import.meta.url));
const entrypoint = readFileSync(root + "docker-entrypoint.sh", "utf-8");
const nginxTpl = readFileSync(root + "nginx/nginx.conf.template", "utf-8");
const buildRunner = readFileSync(
  root + "../admin/src/services/website-build/build-runner.ts",
  "utf-8"
);

// 1. The nginx staging block's auth_basic_user_file path.
const m = nginxTpl.match(/auth_basic_user_file\s+([^;]+);/);
assert.ok(m, "nginx template must declare auth_basic_user_file");
const authPath = m![1].trim();
assert.equal(
  authPath,
  "/var/www/builds/$site_key/.htpasswd-staging",
  "nginx staging auth file must be site-aware"
);

// 2. The build-runner writes .htpasswd-staging under BUILDS_DIR; the shared
//    volume path is /var/www/builds/<siteKey> (admin rw, website rw for
//    placeholder bootstrap).
assert.match(
  buildRunner,
  /join\(config\.BUILDS_DIR,\s*siteKey,\s*"\.htpasswd-staging"\)/,
  "build-runner must write .htpasswd-staging under the site build directory"
);

// 3. The entrypoint bootstraps site-aware current-* placeholders, not legacy
//    global current-* symlinks.
assert.ok(
  entrypoint.includes("/api/sites/keys.txt"),
  "entrypoint must fetch the generated site list before bootstrapping placeholders"
);
assert.ok(
  entrypoint.includes("/var/www/builds/$site/current-staging"),
  "entrypoint must create site-scoped staging placeholder symlinks"
);
assert.ok(
  !entrypoint.includes("/var/www/builds/current-staging"),
  "entrypoint must not create legacy global current-staging symlinks"
);

// 4. Host routing is generated from admin-managed sites, not baked into the
//    nginx template.
assert.ok(
  nginxTpl.includes("__SITE_HOST_MAP__"),
  "nginx template must receive a generated host map"
);
assert.ok(
  entrypoint.includes("/api/sites/nginx-map"),
  "entrypoint must fetch the generated nginx host map"
);
assert.ok(
  !nginxTpl.includes("sample.example.com sample;"),
  "nginx template must not bake site-specific host mappings"
);

// 5. Access logs must expose host headers so Cloudflare tunnel host forwarding
//    can be verified from the Pi after deployment.
assert.ok(
  nginxTpl.includes('host="$host"'),
  "nginx access log must include the resolved Host header"
);
assert.ok(
  nginxTpl.includes('x_forwarded_host="$http_x_forwarded_host"'),
  "nginx access log must include X-Forwarded-Host"
);

console.log("staging-htpasswd-wiring tests passed");
