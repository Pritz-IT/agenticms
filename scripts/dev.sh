#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/.agenticms"
LAYOUTS_DIR="$STATE_DIR/layouts"
ASSETS_DIR="$STATE_DIR/assets"
BUILDS_DIR="$STATE_DIR/builds"
NGINX_CONF_DIR="$STATE_DIR/nginx-conf"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-agenticms-postgres-dev}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
POSTGRES_DB="${POSTGRES_DB:-agenticms}"
POSTGRES_USER="${POSTGRES_USER:-agenticms}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-agenticms}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@agenticms.local}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-agenticms-dev-password}"

ADMIN_PORT="${ADMIN_PORT:-3001}"
WEBSITE_PORT="${WEBSITE_PORT:-4321}"
ADMIN_UI_PORT="${ADMIN_UI_PORT:-5173}"

DATABASE_URL="${DATABASE_URL:-postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}}"
JWT_SECRET="${JWT_SECRET:-dev-secret}"
INTERNAL_API_KEY="${INTERNAL_API_KEY:-dev-internal-key}"

pids=()

kill_tree() {
  local pid="$1"
  local children
  children=$(pgrep -P "$pid" 2>/dev/null) || true
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  if ((${#pids[@]} > 0)); then
    echo
    echo "[dev] Stopping local processes..."
    for pid in "${pids[@]}"; do
      kill_tree "$pid"
    done
    wait "${pids[@]}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[dev] Missing required command: $1" >&2
    exit 1
  fi
}

port_is_free() {
  ! lsof -iTCP:"$1" -sTCP:LISTEN -Pn >/dev/null 2>&1
}

find_free_port() {
  local port="$1"
  while ! port_is_free "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

install_if_needed() {
  local dir="$1"
  if [[ ! -d "$dir/node_modules" ]]; then
    echo "[dev] Installing dependencies in ${dir#$ROOT_DIR/}..."
    (cd "$dir" && npm install)
  fi
}

wait_for_postgres() {
  echo "[dev] Waiting for Postgres on localhost:$POSTGRES_PORT..."
  for _ in {1..60}; do
    if docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      echo "[dev] Postgres is ready."
      return
    fi
    sleep 1
  done
  echo "[dev] Postgres did not become ready in time." >&2
  exit 1
}

start_postgres() {
  require_command docker

  if docker ps --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    echo "[dev] Postgres container already running: $POSTGRES_CONTAINER"
    wait_for_postgres
    return
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$POSTGRES_CONTAINER"; then
    echo "[dev] Starting existing Postgres container: $POSTGRES_CONTAINER"
    docker start "$POSTGRES_CONTAINER" >/dev/null
    wait_for_postgres
    return
  fi

  echo "[dev] Creating Postgres container: $POSTGRES_CONTAINER"
  docker run -d \
    --name "$POSTGRES_CONTAINER" \
    -e POSTGRES_DB="$POSTGRES_DB" \
    -e POSTGRES_USER="$POSTGRES_USER" \
    -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
    -p "$POSTGRES_PORT:5432" \
    postgres:16-alpine >/dev/null
  wait_for_postgres
}

start_process() {
  local name="$1"
  local dir="$2"
  shift 2

  echo "[dev] Starting $name..."
  (
    cd "$dir"
    "$@"
  ) &
  pids+=("$!")
}

main() {
  require_command npm
  require_command lsof
  mkdir -p "$LAYOUTS_DIR" "$ASSETS_DIR" "$BUILDS_DIR" "$NGINX_CONF_DIR"

  start_postgres

  ADMIN_PORT="$(find_free_port "$ADMIN_PORT")"
  WEBSITE_PORT="$(find_free_port "$WEBSITE_PORT")"
  ADMIN_UI_PORT="$(find_free_port "$ADMIN_UI_PORT")"

  install_if_needed "$ROOT_DIR/admin"
  install_if_needed "$ROOT_DIR/admin/frontend"
  install_if_needed "$ROOT_DIR/website"

  echo "[dev] Preparing database..."
  (
    cd "$ROOT_DIR/admin"
    DATABASE_URL="$DATABASE_URL" npm run db:generate
    DATABASE_URL="$DATABASE_URL" npm run db:push
    DATABASE_URL="$DATABASE_URL" ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" npm run db:seed
  )

  # Admin now runs astro builds in-process — point ASTRO_PROJECT_DIR at the
  # local website checkout and BUILDS_DIR at the shared dev state dir.
  start_process "Admin API" "$ROOT_DIR/admin" env \
    DATABASE_URL="$DATABASE_URL" \
    JWT_SECRET="$JWT_SECRET" \
    INTERNAL_API_KEY="$INTERNAL_API_KEY" \
    PORT="$ADMIN_PORT" \
    HOST="0.0.0.0" \
    LAYOUTS_DIR="$LAYOUTS_DIR" \
    ASSETS_DIR="$ASSETS_DIR" \
    ASTRO_PROJECT_DIR="$ROOT_DIR/website" \
    BUILDS_DIR="$BUILDS_DIR" \
    npm run dev

  start_process "Website dev server" "$ROOT_DIR/website" npm run dev -- --host 0.0.0.0 --port "$WEBSITE_PORT"
  start_process "Admin UI" "$ROOT_DIR/admin/frontend" env \
    ADMIN_API_URL="http://localhost:$ADMIN_PORT" \
    npm run dev -- --host 0.0.0.0 --port "$ADMIN_UI_PORT"

  echo
  echo "[dev] AgentiCMS is starting:"
  echo "      Admin UI:        http://localhost:$ADMIN_UI_PORT"
  echo "      Admin API:       http://localhost:$ADMIN_PORT"
  echo "      Website dev:     http://localhost:$WEBSITE_PORT"
  echo "      Postgres:        localhost:$POSTGRES_PORT ($POSTGRES_CONTAINER)"
  echo
  echo "[dev] Login: $ADMIN_EMAIL / $ADMIN_PASSWORD"
  echo "[dev] Press Ctrl+C to stop the local Node processes. Postgres stays running."

  wait
}

main "$@"
