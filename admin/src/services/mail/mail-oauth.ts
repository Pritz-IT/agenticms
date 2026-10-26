import { config } from "../../config.js";

export type OAuthMailProvider = "microsoft" | "google";

interface ProviderSpec {
  clientId: () => string;
  clientSecret: () => string;
  authorizeUrl: () => string;
  tokenUrl: () => string;
  scope: string;
  extraAuthorizeParams: Record<string, string>;
}

const PROVIDERS: Record<OAuthMailProvider, ProviderSpec> = {
  microsoft: {
    clientId: () => config.MS_OAUTH_CLIENT_ID,
    clientSecret: () => config.MS_OAUTH_CLIENT_SECRET,
    authorizeUrl: () => `https://login.microsoftonline.com/${config.MS_OAUTH_TENANT}/oauth2/v2.0/authorize`,
    tokenUrl: () => `https://login.microsoftonline.com/${config.MS_OAUTH_TENANT}/oauth2/v2.0/token`,
    scope: "offline_access openid email https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Send",
    extraAuthorizeParams: { response_mode: "query", prompt: "select_account" },
  },
  google: {
    clientId: () => config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: () => config.GOOGLE_OAUTH_CLIENT_SECRET,
    authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    scope: "openid email https://www.googleapis.com/auth/gmail.send",
    // offline + consent: Google only returns a refresh token on explicit consent.
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  },
};

export function isOAuthProvider(value: string): value is OAuthMailProvider {
  return value === "microsoft" || value === "google";
}

export function oauthConfigured(provider: OAuthMailProvider): boolean {
  const spec = PROVIDERS[provider];
  return Boolean(spec.clientId() && spec.clientSecret());
}

export function buildAuthorizeUrl(provider: OAuthMailProvider, redirectUri: string, state: string): string {
  const spec = PROVIDERS[provider];
  const url = new URL(spec.authorizeUrl());
  url.search = new URLSearchParams({
    client_id: spec.clientId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: spec.scope,
    state,
    ...spec.extraAuthorizeParams,
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

async function tokenRequest(provider: OAuthMailProvider, params: Record<string, string>): Promise<TokenResponse> {
  const spec = PROVIDERS[provider];
  const res = await fetch(spec.tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: spec.clientId(), client_secret: spec.clientSecret(), ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<TokenResponse> & { error?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`${provider} token request failed (${res.status}): ${body.error ?? "unknown"}${body.error_description ? ` - ${body.error_description.split("\n")[0]}` : ""}`);
  }
  return body as TokenResponse;
}

export function exchangeCode(provider: OAuthMailProvider, code: string, redirectUri: string): Promise<TokenResponse> {
  return tokenRequest(provider, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    ...(provider === "microsoft" ? { scope: PROVIDERS.microsoft.scope } : {}),
  });
}

// Microsoft rotates refresh tokens; callers must persist a returned refresh_token.
export function refreshAccessToken(provider: OAuthMailProvider, refreshToken: string): Promise<TokenResponse> {
  return tokenRequest(provider, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(provider === "microsoft" ? { scope: PROVIDERS.microsoft.scope } : {}),
  });
}

export async function fetchAccountEmail(provider: OAuthMailProvider, accessToken: string): Promise<string> {
  const url = provider === "microsoft"
    ? "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"
    : "https://openidconnect.googleapis.com/v1/userinfo";
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    throw new Error(`${provider} account lookup failed (${res.status})`);
  }
  const body = (await res.json()) as { mail?: string | null; userPrincipalName?: string; email?: string };
  const email = body.mail ?? body.userPrincipalName ?? body.email;
  if (!email) {
    throw new Error(`${provider} account has no email address`);
  }
  return email;
}
