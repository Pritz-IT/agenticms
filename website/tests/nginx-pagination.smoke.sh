#!/usr/bin/env bash
set -euo pipefail

website_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/agenticms-nginx.XXXXXX")"
container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null
  fi
  rm -rf "$fixture"
}
trap cleanup EXIT

docker build -t agenticms-website-smoke "$website_dir"
mkdir -p "$fixture/builds/default" "$fixture/assets/__page/2"
printf 'must-not-be-public' > "$fixture/assets/__page/2/index.html"
for target in production staging; do
  build="$fixture/builds/default/$target"
  mkdir -p "$build/news/__page/2" "$build/news/__page/3" \
    "$build/en/news/__page/2" "$build/about" "$build/media/post" "$build/__page/2"
  printf '%s-news-1' "$target" > "$build/news/index.html"
  printf '%s-news-2' "$target" > "$build/news/__page/2/index.html"
  printf '%s-news-3' "$target" > "$build/news/__page/3/index.html"
  printf '%s-en-news-2' "$target" > "$build/en/news/__page/2/index.html"
  printf '%s-about' "$target" > "$build/about/index.html"
  printf '%s-home-1' "$target" > "$build/index.html"
  printf '%s-home-2' "$target" > "$build/__page/2/index.html"
  printf '%s-media' "$target" > "$build/media/post/cover.png"
  ln -s "$target" "$fixture/builds/default/current-$target"
done
printf 'smoke:%s\n' "$(openssl passwd -apr1 smoke)" > "$fixture/builds/default/.htpasswd-staging"
chmod -R a+rX "$fixture"

# Trust the test client only inside this isolated container so each assertion can
# use a fresh test IP without exhausting the unchanged production rate limits.
container_id="$(docker run -d --rm \
  -p 127.0.0.1::80 -p 127.0.0.1::8080 \
  -e INTERNAL_API_KEY= -e ADMIN_API_URL=http://127.0.0.1:3000 \
  -e REAL_IP_FROM=0.0.0.0/0 \
  -v "$fixture/builds:/var/www/builds" -v "$fixture/assets:/assets:ro" \
  agenticms-website-smoke)"
production_port="$(docker port "$container_id" 80/tcp | cut -d: -f2)"
staging_port="$(docker port "$container_id" 8080/tcp | cut -d: -f2)"
ready=false
for attempt in {1..50}; do
  if curl --silent --fail --max-time 1 "http://127.0.0.1:$production_port/about" >/dev/null; then
    ready=true
    break
  fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  docker logs "$container_id"
  echo 'FAIL nginx did not become ready' >&2
  exit 1
fi
docker exec "$container_id" nginx -t

passed=0
failed=0
request=0
check() {
  local path="$1" expected_status="$2" expected_body="${3:-}" expected_location="${4:-}"
  local status location
  request=$((request + 1))
  status="$(curl --silent --show-error --max-time 5 ${auth[@]+"${auth[@]}"} \
    -H "X-Forwarded-For: 192.0.2.$request" \
    -D "$fixture/headers" -o "$fixture/body" -w '%{http_code}' "$base$path")"
  location="$(sed -n 's/^[Ll]ocation: //p' "$fixture/headers" | tr -d '\r')"
  if [[ "$status" == "$expected_status" && "$location" == "$expected_location" ]] \
    && { [[ -z "$expected_body" ]] || [[ "$(cat "$fixture/body")" == "$expected_body" ]]; }; then
    echo "PASS $target $path ($status)"
    passed=$((passed + 1))
  else
    echo "FAIL $target $path: expected $expected_status body='$expected_body' location='$expected_location'; got $status body='$(cat "$fixture/body")' location='$location'" >&2
    failed=$((failed + 1))
  fi
}

for target in production staging; do
  auth=()
  port="$production_port"
  if [[ "$target" == staging ]]; then
    port="$staging_port"
    auth=(-u smoke:smoke)
  fi
  base="http://127.0.0.1:$port"
  check '/news?page=2' 200 "$target-news-2"
  check '/news/?page=2' 200 "$target-news-2"
  check '/news?page=2&utm_source=x' 200 "$target-news-2"
  check '/news?utm_source=x&page=2' 200 "$target-news-2"
  check '/news?page=3' 200 "$target-news-3"
  check '/news?page=1' 301 '' '/news'
  check '/news/?page=1' 301 '' '/news/'
  check '/news?page=1&utm_source=x' 301 '' '/news'
  for page in 99 abc 0 02 -1 2.0 '../2'; do
    check "/news?page=$page" 404
  done
  check '/news/?page=99' 404
  check '/news' 200 "$target-news-1"
  check '/news?utm_source=x' 200 "$target-news-1"
  for page in abc 1 2 99; do
    check "/about?page=$page" 200 "$target-about"
  done
  check '/en/news?page=2' 200 "$target-en-news-2"
  check '/?page=2' 200 "$target-home-2"
  check '/?page=1' 301 '' '/'
  for path in '/news/__page' '/news/__page/2/' '/news/__page/2/index.html' \
    '/en/news/__page/2/index.html' '/__page/2/' '/news/%5f%5fpage/2/' \
    '/assets/__page/2/index.html'; do
    check "$path" 404
  done
  check '/media/post/cover.png' 200 "$target-media"
  check '/assets/post/cover.png' 404
done
auth=()
check '/news?page=2' 401
check '/media/post/cover.png' 401

echo "nginx-pagination smoke: $passed passed, $failed failed"
if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
