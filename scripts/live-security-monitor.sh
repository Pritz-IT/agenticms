#!/bin/sh
set -eu

BASE_URL="${1:-https://cms.example.com}"
SLEEP_SECONDS="${2:-}"

failures=0

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

request() {
  name="$1"
  method="$2"
  path="$3"
  headers_file="$tmpdir/$name.headers"
  body_file="$tmpdir/$name.body"
  shift 3

  if ! curl -sS --max-time 15 -X "$method" -D "$headers_file" -o "$body_file" "$@" "$BASE_URL$path"; then
    echo "FAIL $name: curl failed"
    failures=$((failures + 1))
    return 1
  fi

  status="$(awk 'toupper($1) ~ /^HTTP/ { code = $2 } END { print code }' "$headers_file")"
  echo "$status" > "$tmpdir/$name.status"
}

status_of() {
  cat "$tmpdir/$1.status"
}

header_has() {
  name="$1"
  pattern="$2"
  grep -Eiq "$pattern" "$tmpdir/$name.headers"
}

body_has() {
  name="$1"
  pattern="$2"
  grep -Eq "$pattern" "$tmpdir/$name.body"
}

expect_status() {
  name="$1"
  expected="$2"
  actual="$(status_of "$name")"
  if [ "$actual" = "$expected" ]; then
    echo "OK   $name: HTTP $actual"
  else
    echo "FAIL $name: expected HTTP $expected, got HTTP $actual"
    failures=$((failures + 1))
  fi
}

expect_status_any() {
  name="$1"
  actual="$(status_of "$name")"
  shift
  for expected in "$@"; do
    if [ "$actual" = "$expected" ]; then
      echo "OK   $name: HTTP $actual"
      return 0
    fi
  done
  echo "FAIL $name: unexpected HTTP $actual"
  failures=$((failures + 1))
}

check_once() {
  failures=0
  rm -f "$tmpdir"/*

  echo "AgentiCMS live security monitor: $BASE_URL"

  request login GET /login
  expect_status login 200
  for header in \
    '^x-content-type-options:[[:space:]]*nosniff' \
    '^x-frame-options:[[:space:]]*DENY' \
    '^referrer-policy:[[:space:]]*strict-origin-when-cross-origin' \
    '^permissions-policy:'; do
    if header_has login "$header"; then
      echo "OK   login: security header present ($header)"
    else
      echo "FAIL login: missing security header ($header)"
      failures=$((failures + 1))
    fi
  done

  request sites_unauth GET /api/sites
  expect_status_any sites_unauth 401 403
  if header_has sites_unauth '^x-ratelimit-limit:'; then
    echo "OK   sites_unauth: rate-limit header present"
  else
    echo "FAIL sites_unauth: missing rate-limit header"
    failures=$((failures + 1))
  fi

  request cors_evil GET /api/sites -H "Origin: https://evil.example"
  expect_status_any cors_evil 401 403
  if header_has cors_evil '^access-control-allow-origin:[[:space:]]*https://evil\\.example'; then
    echo "FAIL cors_evil: reflected untrusted Origin"
    failures=$((failures + 1))
  else
    echo "OK   cors_evil: untrusted Origin not reflected"
  fi

  request invalid_login POST /api/auth/login \
    -H "content-type: application/json" \
    --data '{"email":"not-real@example.invalid","password":"not-real"}'
  expect_status invalid_login 401
  if header_has invalid_login '^x-ratelimit-limit:[[:space:]]*10'; then
    echo "OK   invalid_login: sensitive rate-limit header present"
  else
    echo "FAIL invalid_login: missing expected sensitive rate-limit header"
    failures=$((failures + 1))
  fi

  request cli_install GET /api/cli/install.sh
  expect_status cli_install 200
  if body_has cli_install "DEFAULT_AGENTICMS_ADMIN_URL='https://"; then
    echo "OK   cli_install: default admin URL is HTTPS"
  else
    echo "FAIL cli_install: default admin URL is not HTTPS"
    failures=$((failures + 1))
  fi
  if body_has cli_install 'JWT_SECRET|INTERNAL_API_KEY'; then
    echo "FAIL cli_install: secret marker found in installer"
    failures=$((failures + 1))
  else
    echo "OK   cli_install: no secret markers found"
  fi

  request cli_archive GET /api/cli/agenticms-cli.tar.gz
  expect_status cli_archive 200
  if header_has cli_archive '^content-disposition:.*attachment.*agenticms-cli[.]tar[.]gz'; then
    echo "OK   cli_archive: attachment disposition present"
  else
    echo "FAIL cli_archive: missing attachment disposition"
    failures=$((failures + 1))
  fi

  if [ "$failures" -eq 0 ]; then
    echo "PASS live security monitor"
  else
    echo "FAIL live security monitor: $failures issue(s)"
  fi
  return "$failures"
}

if [ -n "$SLEEP_SECONDS" ]; then
  while true; do
    check_once || true
    sleep "$SLEEP_SECONDS"
  done
fi

check_once
