function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const config = {
  DATABASE_URL: required("DATABASE_URL"),
  JWT_SECRET: required("JWT_SECRET"),
  INTERNAL_API_KEY: required("INTERNAL_API_KEY"),

  PORT: parseInt(optional("PORT", "3000"), 10),
  HOST: optional("HOST", "0.0.0.0"),
  LAYOUTS_DIR: optional("LAYOUTS_DIR", "./layouts"),
  COMPILED_LAYOUTS_DIR: optional("COMPILED_LAYOUTS_DIR", "./.layout-modules"),
  ASSETS_DIR: optional("ASSETS_DIR", "./assets"),
  POST_MEDIA_DIR: optional("POST_MEDIA_DIR", "./post-media"),
  CLI_PACKAGE_DIR: optional("CLI_PACKAGE_DIR", "../cli"),
  ADMIN_PUBLIC_URL: optional("ADMIN_PUBLIC_URL", ""),

  // Website build orchestration (previously in the Website container).
  ASTRO_PROJECT_DIR: optional("ASTRO_PROJECT_DIR", "/astro-project"),
  BUILDS_DIR: optional("BUILDS_DIR", "/var/www/builds"),
  MAX_BUILDS: parseInt(optional("MAX_BUILDS", "5"), 10),
  ASTRO_BUILD_TIMEOUT_MS: parseInt(optional("ASTRO_BUILD_TIMEOUT_MS", "120000"), 10),

  // CORS origin for the public site. Optional now — used to be required as WEBSITE_URL.
  WEBSITE_ORIGIN: optional("WEBSITE_URL", ""),

  // Brute-force protection for the auth endpoints (per client IP). Only sound
  // when the admin sees the real client IP — see TRUST_PROXY below.
  LOGIN_RATE_MAX: parseInt(optional("LOGIN_RATE_MAX", "10"), 10),
  LOGIN_RATE_WINDOW: optional("LOGIN_RATE_WINDOW", "10 minutes"),

  // Public submissions endpoint guards
  SUBMISSIONS_RATE_MAX: parseInt(optional("SUBMISSIONS_RATE_MAX", "5"), 10),
  SUBMISSIONS_RATE_WINDOW: optional("SUBMISSIONS_RATE_WINDOW", "10 minutes"),
  SUBMISSIONS_MIN_FILL_MS: parseInt(optional("SUBMISSIONS_MIN_FILL_MS", "2500"), 10),
  // Sized for a full readable quiz transcript (8 Q&A + category breakdown);
  // still bounded so abuse is rejected.
  SUBMISSIONS_DATA_MAX_BYTES: parseInt(optional("SUBMISSIONS_DATA_MAX_BYTES", "8192"), 10),
  SUBMISSIONS_DATA_MAX_KEYS: parseInt(optional("SUBMISSIONS_DATA_MAX_KEYS", "150"), 10),
  SUBMISSIONS_DATA_MAX_STRLEN: parseInt(optional("SUBMISSIONS_DATA_MAX_STRLEN", "2000"), 10),
  SUBMISSIONS_DATA_MAX_DEPTH: parseInt(optional("SUBMISSIONS_DATA_MAX_DEPTH", "6"), 10),
  // How long after an anonymous quiz result is stored a later email submission
  // (same unguessable client ref) may attach to that same row. Default 30 min.
  SUBMISSIONS_ATTACH_WINDOW_MS: parseInt(optional("SUBMISSIONS_ATTACH_WINDOW_MS", "1800000"), 10),
  // Fastify trustProxy value. Behind the website nginx on the docker network.
  // Default false (dev/direct). In staging/prod set to the proxy/subnet, e.g.
  // "172.16.0.0/12" or the nginx container IP. Never leave "true" exposed.
  TRUST_PROXY: optional("TRUST_PROXY", ""),

  // Submission mail notifications. SECRETS_KEY encrypts stored SMTP
  // passwords and OAuth refresh tokens; without it no mail secret can be saved.
  SECRETS_KEY: optional("SECRETS_KEY", ""),
  // OAuth apps for "Connect Microsoft 365" / "Connect Google". Redirect URI to
  // register: <ADMIN_PUBLIC_URL>/api/oauth/mail/{microsoft|google}/callback
  MS_OAUTH_CLIENT_ID: optional("MS_OAUTH_CLIENT_ID", ""),
  MS_OAUTH_CLIENT_SECRET: optional("MS_OAUTH_CLIENT_SECRET", ""),
  MS_OAUTH_TENANT: optional("MS_OAUTH_TENANT", "common"),
  GOOGLE_OAUTH_CLIENT_ID: optional("GOOGLE_OAUTH_CLIENT_ID", ""),
  GOOGLE_OAUTH_CLIENT_SECRET: optional("GOOGLE_OAUTH_CLIENT_SECRET", ""),
  NOTIFY_POLL_MS: parseInt(optional("NOTIFY_POLL_MS", "30000"), 10),
} as const;

export type Config = typeof config;
