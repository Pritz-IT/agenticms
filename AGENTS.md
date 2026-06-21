# Repository Guidelines

## Project Structure & Module Organization

This repository contains two Node/TypeScript apps:

- `admin/`: Fastify API, Prisma, backend tests, and Vite React frontend under `admin/frontend/`.
- `cli/`: local AgentiCMS operator CLI for authenticated layout/asset sync.
- `website/`: Astro public site and tests under `website/tests/`.
- `docker-compose.yml`: admin, website, and Postgres topology.

Admin source lives in `admin/src/`; tests live in `admin/tests/`.

## Build, Test, and Development Commands

Run commands from the package directory shown:

- `cd admin && npm run dev`: start the admin API.
- `cd admin && npm run build:tsc`: type-check the admin backend.
- `cd admin && npm run build`: bundle server outputs.
- `cd admin && npm test`: run admin Vitest, including frontend helper tests.
- `cd admin/frontend && npm run dev`: start the Vite admin frontend.
- `cd admin/frontend && npm run build`: build the frontend.
- `cd cli && npm test`: run CLI unit tests.
- `cd cli && npm run build`: type-check/build the CLI.
- `cd cli && node dist/main.js login <admin-url>`: start admin-approved CLI login.
- `cd cli && node dist/main.js site create --key demo --name "Demo" --domain demo.example.com --staging-domain staging-demo.example.com --default-locale de`: create a site via the approved CLI token.
- `cd cli && node dist/main.js status --site demo --url <admin-url>`: check one site.
- `cd cli && node dist/main.js page list --site demo --url <admin-url>`: list pages for a site.
- `cd cli && node dist/main.js page create --site demo --url <admin-url> --path /new-page --layout path/to/Layout.tsx --draft`: create a draft page using a layout path/name.
- `cd cli && node dist/main.js sync layouts --site demo`: sync selected site layouts.
- `site.json` stores the default site and optional per-site local roots. Legacy `.agenticms/site.json` is still supported for older workspaces.
- `cd website && npm run dev`: start Astro locally.
- `cd website && npm run build:astro`: build the public site.
- `cd website && npm test`: run website test scripts.
- `docker compose config`: validate compose wiring before deployment changes.

## Coding Style & Naming Conventions

Use TypeScript ESM. Keep two-space indentation and prefer named exports for shared services. Backend services belong in `admin/src/services/`, route modules in `admin/src/routes/`, and tests should mirror the target path, for example `admin/tests/services/layout-module-cache.test.ts`.

Follow commit prefixes seen in history: `feat:`, `fix:`, `test:`, `docs:`, and `chore:`.

## Testing Guidelines

Admin uses Vitest. Add focused tests for new services, routes, and regressions. Prefer deterministic tests over sleeps; use temp directories for filesystem tests. Website tests are TSX/TS scripts run by `npm test`.

Before finishing backend or deployment work, run affected tests plus `cd admin && npm test` when feasible. Frontend changes should pass `cd admin/frontend && npm run build`.

## Security & Configuration Tips

Secrets are mandatory in compose; do not add insecure defaults. Admin should stay behind the website/nginx proxy. Runtime paths must match Docker mounts. Treat layout files as trusted admin-controlled code.

## Visual Planning Privacy

BuilderIO `visual-plan` and `visual-recap` workflows must stay local-only for this repository. Do not call hosted Agent-Native Plan MCP tools, publish plan content, install PR auto-recap actions, or send diffs, screenshots, security findings, customer content, deployment details, or repository context to an external plan service.

When visual planning or recap output is useful, Codex should create local ignored artifacts directly in this repo, for example under `docs/visual-plans/`, and then show the repository owner the exact optional command they may run to send or publish it. Do not run that command automatically.

## Deployment Permission

Codex must prepare and verify locally, then wait for the repository owner before deploying. Do not run production builds, website container publishes, or deployment commands unless the repository owner explicitly approves that exact action. A global `PreToolUse` hook enforces this for AstroCms:

```bash
~/.codex/hooks/PreToolUse/deploy-permission-guard.mjs
```

Allowed without deployment approval: tests, local dev servers, local admin UI review, and layout sync for editor review. Blocked without approval: `node cli/dist/main.js build production`, production website container rebuild/publish, and deploy commands against `<production-host>` or `cms.example.com`.

## Pull Request Guidelines

PRs should describe the behavior change, list verification commands, and call out Docker/config impacts. Include screenshots for visible admin/frontend changes.
