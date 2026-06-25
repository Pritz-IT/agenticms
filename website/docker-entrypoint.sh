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

fetch_internal() {
  path="$1"
  if [ -z "${INTERNAL_API_KEY:-}" ]; then
    return 1
  fi
  wget -qO- --header="x-api-key: ${INTERNAL_API_KEY}" "${ADMIN_API_URL}${path}" 2>/dev/null
}

SITES="$(fetch_internal "/api/sites/keys.txt" || true)"
if [ -z "$SITES" ]; then
  SITES="default"
fi

SITE_HOST_MAP="$(fetch_internal "/api/sites/nginx-map" || true)"
if [ -z "$SITE_HOST_MAP" ]; then
  SITE_HOST_MAP="default default;"
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
  { print }
' /tmp/nginx.conf > /etc/nginx/nginx.conf

exec nginx -g 'daemon off;'
