import { loadCredential, removeCredential } from "./config.js";
import { requestJson } from "./http.js";

export async function logout(adminUrlArg: string | undefined, revoke: boolean): Promise<void> {
  if (revoke) {
    try {
      const { adminUrl, credential } = await loadCredential(adminUrlArg);
      await requestJson(adminUrl, "/api/cli/token", { method: "DELETE" }, credential);
    } catch (err) {
      console.warn(`Remote revoke failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const removed = await removeCredential(adminUrlArg);
  console.log(`Removed credentials for ${removed}`);
}
