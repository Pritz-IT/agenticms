# Build context: repository root (set in docker-compose.yml).
# This image now runs both the admin API and on-demand `astro build` for the
# public site. /astro-project is the writable astro source tree.

# ── Stage 0: admin frontend (Vite/React) ────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY admin/frontend/package.json admin/frontend/package-lock.json ./
RUN npm ci
COPY admin/frontend/ .
RUN npm run build

# ── Stage 1: admin server builder (esbuild bundle) ──────────────────────────
FROM node:22-alpine AS server-builder
RUN apk add --no-cache openssl
WORKDIR /app

COPY admin/package*.json ./
RUN npm ci

COPY admin/prisma ./prisma
RUN npx prisma generate

COPY admin/tsconfig.json ./
COPY admin/src ./src
RUN npm run build

# ── Stage 2: admin runtime deps (no devDependencies) ────────────────────────
FROM node:22-alpine AS server-deps
RUN apk add --no-cache openssl
WORKDIR /app

COPY admin/package*.json ./
RUN npm ci --omit=dev

COPY admin/prisma ./prisma
RUN npx prisma generate

# ── Stage 3: astro project deps (used at runtime for `astro build`) ─────────
FROM node:22-alpine AS astro-deps
WORKDIR /astro-project

COPY website/package.json website/package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 3b: AgentiCMS CLI package ────────────────────────────────────────
FROM node:22-alpine AS cli-builder
WORKDIR /cli

COPY cli/package.json cli/package-lock.json ./
RUN npm ci
COPY cli/tsconfig.json ./
COPY cli/src ./src
RUN npm run build

# ── Stage 4: runtime ────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl

# Admin server
WORKDIR /app
COPY --from=server-deps    /app/node_modules ./node_modules
COPY --from=server-builder /app/dist          ./dist
COPY --from=server-builder /app/prisma        ./prisma
COPY --from=server-builder /app/package.json  ./package.json
COPY --from=frontend-builder /app/dist/public ./dist/public

# Downloadable local operator CLI served by /api/cli/agenticms-cli.tar.gz
COPY --from=cli-builder /cli/package.json /agenticms-cli/package.json
COPY --from=cli-builder /cli/dist         /agenticms-cli/dist

# Astro project (writable — build-runner mutates src/layouts, src/data, public/assets)
COPY --from=astro-deps /astro-project/node_modules /astro-project/node_modules
COPY website/package.json     /astro-project/package.json
COPY website/astro.config.mjs /astro-project/astro.config.mjs
COPY website/tsconfig.json    /astro-project/tsconfig.json
COPY website/src              /astro-project/src
COPY website/public           /astro-project/public

RUN mkdir -p /layouts /assets /var/www/builds /var/cache/layout-modules
ENV CLI_PACKAGE_DIR=/agenticms-cli

EXPOSE 3000

CMD ["sh", "-c", "echo 'Waiting for database...' && until npx prisma migrate deploy; do echo 'DB not ready or migration command failed, retrying in 3s...'; sleep 3; done && echo 'DB ready' && node dist/seed.js && node dist/index.js"]
