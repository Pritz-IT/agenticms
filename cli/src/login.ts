import { saveCredential, normalizeAdminUrl } from "./config.js";
import { requestJson } from "./http.js";

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

const POLL_INTERVAL_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(adminUrlInput: string): Promise<void> {
  const adminUrl = normalizeAdminUrl(adminUrlInput);
  const device = await requestJson<DeviceResponse>(adminUrl, "/api/cli/device", {
    method: "POST",
    body: JSON.stringify({ label: `AgentiCMS CLI on ${new Date().toISOString()}` }),
  });

  const approveUrl = new URL(device.approveUrl, `${adminUrl}/`).toString();
  console.log(`Open: ${approveUrl}`);
  console.log(`Code: ${device.code}`);

  const deadline = new Date(device.expiresAt).getTime();
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const tokenResponse = await requestJson<TokenResponse>(
      adminUrl,
      `/api/cli/device/${device.deviceId}/token`,
      {
        method: "POST",
        body: JSON.stringify({ deviceSecret: device.deviceSecret }),
      }
    );

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
