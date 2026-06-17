# Security Policy

## Supported Versions

AgentiCMS is currently pre-1.0. Security fixes are applied to the main
development line unless maintainers announce a supported release branch.

## Reporting a Vulnerability

Please do not report vulnerabilities through public issues, pull requests, or
discussions.

Use GitHub private vulnerability reporting:

https://github.com/Pritz-IT/agenticms/security/advisories/new

If private vulnerability reporting is unavailable, do not file a public issue.
Ask a maintainer to enable private reporting for the repository first.

Include:

- Affected component, route, CLI command, or deployment path.
- Impact and realistic attack scenario.
- Reproduction steps or proof of concept.
- Whether credentials, deployment access, or user interaction are required.
- Any logs or screenshots that do not expose secrets.

We will acknowledge reports as soon as practical and coordinate disclosure based
on severity and exploitability.

## Security Boundaries

AgentiCMS has a small set of important trust boundaries:

- The admin API must not be directly exposed to the public internet.
- The website/nginx layer is the public entry point.
- CLI access requires admin-approved login and bearer-token authentication.
- Layout files are trusted admin-controlled code, not untrusted user content.
- Uploaded assets are content, but must still be validated, stored safely, and
  served without path traversal.
- Production builds and deployments require explicit site-owner approval.

Do not weaken these boundaries to simplify a feature.

## Secrets and Configuration

Never commit real values for:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `INTERNAL_API_KEY`
- CLI credentials or device tokens
- Cloudflare tunnel credentials
- Production hostnames, SSH details, or private deployment scripts unless they
  are intentionally public examples

Use `.env.example` for documented placeholders only. Docker examples must keep
secrets mandatory and avoid insecure production defaults.

## Contributor Security Expectations

All contributions must use an AI-agent-assisted workflow and include the agent as
a commit co-author. The human contributor remains responsible for the security of
the change.

Before opening a pull request, contributors should:

- Run the relevant tests and builds.
- Review auth, authorization, filesystem, SSR, and command-execution paths.
- Avoid logging secrets, tokens, request bodies with credentials, or private
  deployment data.
- Prefer allowlists, path normalization, and explicit validation over string
  filters.
- Keep production deployment commands out of automated tests and examples unless
  they are guarded and clearly marked.

## Dependency Security

Run dependency checks before release preparation:

```bash
cd admin && npm audit
cd admin/frontend && npm audit
cd cli && npm audit
cd website && npm audit
```

Audit results must be triaged. Do not hide high-impact findings by pinning or
ignoring packages without documenting why the finding is not exploitable here.

## Disclosure

Security advisories should describe the affected versions or commits, impact,
fix, and recommended operator action. Credit reporters unless they request
otherwise.
