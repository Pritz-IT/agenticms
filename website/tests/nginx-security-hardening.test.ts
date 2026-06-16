import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const nginxTpl = readFileSync(root + "nginx/nginx.conf.template", "utf-8");

function blocksFor(marker: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;

  while (true) {
    const markerIndex = nginxTpl.indexOf(marker, searchFrom);
    if (markerIndex === -1) {
      break;
    }

    const openBrace = nginxTpl.indexOf("{", markerIndex);
    assert.notEqual(openBrace, -1, `block "${marker}" must have an opening brace`);

    let depth = 0;
    for (let i = openBrace; i < nginxTpl.length; i += 1) {
      const char = nginxTpl[i];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
      }

      if (depth === 0) {
        blocks.push(nginxTpl.slice(markerIndex, i + 1));
        searchFrom = i + 1;
        break;
      }
    }

    assert.ok(searchFrom > markerIndex, `block "${marker}" must close`);
  }

  return blocks;
}

function assertEveryBlockIncludes(
  marker: string,
  expectedCount: number,
  snippets: string[]
): void {
  const blocks = blocksFor(marker);
  assert.equal(
    blocks.length,
    expectedCount,
    `expected ${expectedCount} "${marker}" blocks`
  );

  for (const snippet of snippets) {
    assert.ok(
      blocks.every((block) => block.includes(snippet)),
      `every "${marker}" block must include ${snippet}`
    );
  }
}

assert.match(
  nginxTpl,
  /client_header_timeout\s+10s;/,
  "nginx must bound client header reads"
);
assert.match(
  nginxTpl,
  /client_body_timeout\s+10s;/,
  "nginx must bound slow request bodies"
);
assert.match(
  nginxTpl,
  /send_timeout\s+10s;/,
  "nginx must bound slow response clients"
);
assert.match(
  nginxTpl,
  /keepalive_timeout\s+15s\s+10s;/,
  "nginx keepalive timeout must be reduced from the default"
);
assert.match(
  nginxTpl,
  /client_max_body_size\s+1m;/,
  "the global body cap must be a small safe default"
);

for (const zone of ["static", "api", "auth", "cli", "assets"]) {
  assert.match(
    nginxTpl,
    new RegExp(`limit_req_zone\\s+\\$binary_remote_addr\\s+zone=${zone}:10m`),
    `nginx must define the ${zone} request limit zone`
  );
}
assert.match(
  nginxTpl,
  /limit_conn_zone\s+\$binary_remote_addr\s+zone=perip:10m;/,
  "nginx must define a per-IP connection limit zone"
);
assert.match(nginxTpl, /limit_req_status\s+429;/, "rate limits must return 429");
assert.match(nginxTpl, /limit_conn_status\s+429;/, "connection limits must return 429");

for (const header of [
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-Frame-Options "DENY" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'add_header Permissions-Policy "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()" always;',
]) {
  assert.ok(nginxTpl.includes(header), `nginx must set ${header}`);
}
assert.ok(
  !/Strict-Transport-Security/i.test(nginxTpl),
  "nginx must not emit HSTS by default when TLS may terminate upstream"
);

const adminServerBlocks = blocksFor("server {").filter((block) =>
  block.includes("server_name cms.example.com;")
);
assert.equal(
  adminServerBlocks.length,
  1,
  "nginx must define exactly one cms.example.com admin server block"
);
assert.match(
  adminServerBlocks[0],
  /listen\s+80;/,
  "the admin host must listen on the production port"
);
assert.doesNotMatch(
  adminServerBlocks[0],
  /listen\s+8080;/,
  "the admin host must not listen on the staging port"
);

assertEveryBlockIncludes("location ~ ^/api/auth/", 3, [
  "limit_req zone=auth burst=5 nodelay;",
  "limit_conn perip 10;",
  "proxy_connect_timeout 5s;",
  "proxy_send_timeout    30s;",
  "proxy_read_timeout    30s;",
]);

assertEveryBlockIncludes(
  "location ~ ^/api/(?:cli/sync/(?:assets|global-assets)|sites/[^/]+/cli/sync/assets)$",
  3,
  [
    "limit_req zone=cli burst=3 nodelay;",
    "limit_conn perip 8;",
    "client_max_body_size 50m;",
    "proxy_connect_timeout 5s;",
    "proxy_send_timeout    60s;",
    "proxy_read_timeout    60s;",
  ]
);

assertEveryBlockIncludes("location ~ ^/api/cli/", 3, [
  "limit_req zone=cli burst=3 nodelay;",
  "limit_conn perip 8;",
  "proxy_connect_timeout 5s;",
  "proxy_send_timeout    30s;",
  "proxy_read_timeout    30s;",
]);

assertEveryBlockIncludes(
  "location ~ ^/api/(?:assets|sites/[^/]+/assets)$",
  3,
  [
    "limit_req zone=assets burst=10 nodelay;",
    "limit_conn perip 10;",
    "client_max_body_size 12m;",
    "proxy_connect_timeout 5s;",
    "proxy_send_timeout    60s;",
    "proxy_read_timeout    60s;",
  ]
);

assertEveryBlockIncludes("location /api/", 2, [
  "limit_req zone=api burst=20 nodelay;",
  "limit_conn perip 20;",
  "proxy_connect_timeout 5s;",
  "proxy_send_timeout    30s;",
  "proxy_read_timeout    30s;",
]);

assertEveryBlockIncludes("location /assets/", 2, [
  "limit_req zone=assets burst=40 nodelay;",
  "client_max_body_size 1m;",
  'add_header X-Content-Type-Options "nosniff" always;',
]);

assertEveryBlockIncludes("location ~* ^/assets/.*\\.(?:svg|html?|xhtml|xml)$", 2, [
  "root /;",
  "limit_req zone=assets burst=20 nodelay;",
  'add_header Content-Disposition "attachment" always;',
  'add_header X-Content-Type-Options "nosniff" always;',
]);

assert.ok(
  !nginxTpl.includes("auth_request") && !nginxTpl.includes("allow ") && !nginxTpl.includes("deny all"),
  "the product template must not hard-code an operator-specific admin host gate"
);

console.log("nginx-security-hardening tests passed");
