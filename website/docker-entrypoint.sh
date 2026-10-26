#!/bin/sh
set -e

mkdir -p /var/www/builds /etc/nginx/conf.d

ADMIN_API_URL="${ADMIN_API_URL:-http://admin:3000}"
case "$ADMIN_API_URL" in *"|"*) echo "ADMIN_API_URL must not contain '|'"; exit 1;; esac

# Server name for the admin host block. Defaults to the generic example domain;
# real deployments set ADMIN_SERVER_NAME to their admin domain (e.g.
# cms.example.com). nginx matches this against the Host header, so a wrong value
# makes the admin domain fall through to default_server.
ADMIN_SERVER_NAME="${ADMIN_SERVER_NAME:-cms.example.com}"
case "$ADMIN_SERVER_NAME" in *"|"*) echo "ADMIN_SERVER_NAME must not contain '|'"; exit 1;; esac

# Behind a reverse proxy or tunnel every request arrives from the proxy's
# address, so the per-IP rate limits become one bucket shared by all visitors.
# REAL_IP_FROM lists the proxy addresses/CIDRs (space or comma separated) whose
# REAL_IP_HEADER is trusted as the client address, e.g. REAL_IP_FROM=172.16.0.0/12
# REAL_IP_HEADER=CF-Connecting-IP for a Cloudflare tunnel on the Docker host.
# Unset = use the TCP peer address (no header is trusted).
REAL_IP_HEADER="${REAL_IP_HEADER:-X-Forwarded-For}"
REAL_IP_CONF=""
if [ -n "${REAL_IP_FROM:-}" ]; then
  case "$REAL_IP_HEADER" in *[!A-Za-z0-9-]*) echo "REAL_IP_HEADER must be a plain header name"; exit 1;; esac
  for cidr in $(echo "$REAL_IP_FROM" | tr ',' ' '); do
    case "$cidr" in *[!0-9A-Fa-f.:/]*) echo "REAL_IP_FROM entry '$cidr' is not an address or CIDR"; exit 1;; esac
    REAL_IP_CONF="${REAL_IP_CONF}    set_real_ip_from ${cidr};\n"
  done
  REAL_IP_CONF="${REAL_IP_CONF}    real_ip_header ${REAL_IP_HEADER};\n    real_ip_recursive on;"
  echo "real client IP from ${REAL_IP_HEADER}, trusted proxies: ${REAL_IP_FROM}"
fi

fetch_internal() {
  path="$1"
  if [ -z "${INTERNAL_API_KEY:-}" ]; then
    return 1
  fi
  wget -qO- --header="x-api-key: ${INTERNAL_API_KEY}" "${ADMIN_API_URL}${path}" 2>/dev/null
}

# Compose/Swarm start admin and website together, so the admin is usually still
# running migrations when we get here. A single failed fetch used to fall back
# to the `default` site silently and stay there for the whole container
# lifetime — every host then served the default site's "No build yet"
# placeholder with no error in any log. Retry, and if the admin is configured
# but never answers, refuse to start rather than serve the wrong site.
FETCH_RETRIES=60
FETCH_INTERVAL=2

fetch_internal_retry() {
  path="$1"
  attempt=1
  while :; do
    if body="$(fetch_internal "$path")"; then
      printf '%s' "$body"
      return 0
    fi
    if [ "$attempt" -ge "$FETCH_RETRIES" ]; then
      return 1
    fi
    echo "waiting for admin ${ADMIN_API_URL}${path} (attempt ${attempt}/${FETCH_RETRIES})" >&2
    attempt=$((attempt + 1))
    sleep "$FETCH_INTERVAL"
  done
}

fail_admin_unreachable() {
  echo "FATAL: admin did not answer ${ADMIN_API_URL}${1} within $((FETCH_RETRIES * FETCH_INTERVAL))s" >&2
  echo "FATAL: refusing to start — falling back to the 'default' site would serve every host the wrong site with no error" >&2
  exit 1
}

if [ -z "${INTERNAL_API_KEY:-}" ]; then
  # Explicit opt-out: without a key we cannot read sites at all. Loud, but not
  # fatal — a standalone/demo container is still a legitimate deployment.
  echo "WARNING: INTERNAL_API_KEY is unset — cannot read sites from the admin" >&2
  echo "WARNING: serving the built-in 'default' site for every host" >&2
  SITES="default"
  SITE_HOST_MAP="default default;"
else
  SITES="$(fetch_internal_retry "/api/sites/keys.txt")" || fail_admin_unreachable "/api/sites/keys.txt"
  SITE_HOST_MAP="$(fetch_internal_retry "/api/sites/nginx-map")" || fail_admin_unreachable "/api/sites/nginx-map"

  # A fresh install with no sites yet answers with an empty body. That is not a
  # failure — bootstrap the default site and let the first `site create` land.
  if [ -z "$SITES" ] || [ -z "$SITE_HOST_MAP" ]; then
    echo "NOTE: admin reports no sites yet — serving 'default' until a site is created" >&2
    SITES="default"
    SITE_HOST_MAP="default default;"
  fi
fi
printf '%s\n' "$SITE_HOST_MAP" > /tmp/site-host-map.conf

# Placeholder builds in case the admin hasn't produced any yet — keeps nginx
# from 404-ing at startup on a fresh volume.
for site in $SITES; do
  mkdir -p "/var/www/builds/$site"

  if [ ! -L "/var/www/builds/$site/current-production" ]; then
    mkdir -p "/var/www/builds/$site/empty"
    echo "<html><body><h1>No build yet</h1></body></html>" > "/var/www/builds/$site/empty/index.html"
    ln -s "/var/www/builds/$site/empty" "/var/www/builds/$site/current-production"
  fi

  if [ ! -L "/var/www/builds/$site/current-staging" ]; then
    mkdir -p "/var/www/builds/$site/empty-staging"
    echo "<html><body><h1>No staging build yet</h1></body></html>" > "/var/www/builds/$site/empty-staging/index.html"
    ln -s "/var/www/builds/$site/empty-staging" "/var/www/builds/$site/current-staging"
  fi
done

# Render the active nginx config from the baked template. Idempotent across
# restarts (always regenerated from the pristine template).
sed -e "s|__ADMIN_API_URL__|${ADMIN_API_URL}|g" \
    -e "s|__ADMIN_SERVER_NAME__|${ADMIN_SERVER_NAME}|g" \
  /etc/nginx/nginx.conf.template > /tmp/nginx.conf
awk '
  /__SITE_HOST_MAP__/ {
    while ((getline line < "/tmp/site-host-map.conf") > 0) {
      print "        " line
    }
    close("/tmp/site-host-map.conf")
    next
  }
  /__REAL_IP__/ { if (realip != "") print realip; next }
  { print }
' realip="$REAL_IP_CONF" /tmp/nginx.conf > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
