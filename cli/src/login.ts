import { saveCredential, normalizeAdminUrl } from "./config.js";
import { CliHttpError, requestJson } from "./http.js";

interface DeviceResponse {
  deviceId: string;
  deviceSecret: string;
  code: string;
  expiresAt: string;
  approveUrl: string;
}

interface TokenResponse {
  token?: string;
  expiresAt?: string;
  scopes?: string[];
  status?: "pending";
}

const DEFAULT_POLL_INTERVAL_MS = 5000;
// Fallback backoff when a 429 carries no Retry-After header. Generous so a
// single transient throttle never turns into a tight retry loop.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 30_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Injectable seams so the polling/backoff loop is testable without real time. */
export interface LoginOptions {
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function login(adminUrlInput: string, options: LoginOptions = {}): Promise<void> {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const adminUrl = normalizeAdminUrl(adminUrlInput);
  const device = await requestJson<DeviceResponse>(adminUrl, "/api/cli/device", {
    method: "POST",
    body: JSON.stringify({ label: `AgentiCMS CLI on ${new Date().toISOString()}` }),
  });

  const approveUrl = new URL(device.approveUrl, `${adminUrl}/`).toString();
  console.log(`Open: ${approveUrl}`);
  console.log(`Code: ${device.code}`);

  const deadline = new Date(device.expiresAt).getTime();
  while (now() < deadline) {
    await sleep(pollIntervalMs);

    let tokenResponse: TokenResponse;
    try {
      tokenResponse = await requestJson<TokenResponse>(
        adminUrl,
        `/api/cli/device/${device.deviceId}/token`,
        {
          method: "POST",
          body: JSON.stringify({ deviceSecret: device.deviceSecret }),
        }
      );
    } catch (err) {
      // A throttle while waiting for approval must not kill the login — honor
      // the server's Retry-After and keep polling until the device expires.
      if (err instanceof CliHttpError && err.status === 429) {
        const backoffMs = err.retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;
        console.warn(`\nRate limited while waiting for approval; retrying in ${Math.ceil(backoffMs / 1000)}s.`);
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }

    if (tokenResponse.token && tokenResponse.expiresAt) {
      await saveCredential(adminUrl, {
        token: tokenResponse.token,
        expiresAt: tokenResponse.expiresAt,
      });
      console.log(`Logged in to ${adminUrl}`);
      return;
    }

    process.stdout.write(".");
  }

  throw new Error("CLI login timed out before approval.");
}
