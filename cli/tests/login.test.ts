import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
const saveCredential = vi.fn();
const normalizeAdminUrl = vi.fn((url: string) => url);

// Keep CliHttpError (and parseRetryAfterMs) real so `instanceof` works in the
// login backoff path; only stub the network call.
vi.mock("../src/http.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/http.js")>()),
  requestJson,
}));
vi.mock("../src/config.js", () => ({ saveCredential, normalizeAdminUrl }));

const ADMIN_URL = "https://cms.example.com";

const DEVICE = {
  deviceId: "dev_1",
  deviceSecret: "sfdev_secret",
  code: "123456",
  // Far future so the poll loop never times out during these tests.
  expiresAt: "2999-01-01T00:00:00.000Z",
  approveUrl: "/cli/approve/dev_1",
};

const TOKEN = { token: "sfcli_token", expiresAt: "2999-02-01T00:00:00.000Z", scopes: ["pages:write"] };

/** A `requestJson` impl: device-create returns DEVICE, polls drain `pollResults`. */
function wireRequestJson(pollResults: Array<unknown | (() => never)>): void {
  let poll = 0;
  requestJson.mockImplementation((_url: string, path: string) => {
    if (path === "/api/cli/device") return Promise.resolve(DEVICE);
    const next = pollResults[poll] ?? TOKEN;
    poll += 1;
    if (typeof next === "function") return Promise.reject((next as () => never)());
    return Promise.resolve(next);
  });
}

describe("login polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    normalizeAdminUrl.mockImplementation((url: string) => url);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("backs off and keeps polling on a 429 instead of crashing", async () => {
    const { CliHttpError } = await import("../src/http.js");
    // poll #1 -> 429 with Retry-After 7s, poll #2 -> pending, poll #3 -> token
    wireRequestJson([
      () => new CliHttpError(429, "Rate limit exceeded", 7000),
      { status: "pending" },
      TOKEN,
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { login } = await import("../src/login.js");

    await login(ADMIN_URL, { sleep, now: () => 0, pollIntervalMs: 1000 });

    expect(saveCredential).toHaveBeenCalledWith(ADMIN_URL, {
      token: TOKEN.token,
      expiresAt: TOKEN.expiresAt,
    });
    // Honored the server's Retry-After (7s) as the backoff delay.
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("falls back to a default backoff when a 429 carries no Retry-After", async () => {
    const { CliHttpError } = await import("../src/http.js");
    wireRequestJson([() => new CliHttpError(429, "Rate limit exceeded"), TOKEN]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { login } = await import("../src/login.js");

    await login(ADMIN_URL, { sleep, now: () => 0, pollIntervalMs: 1000 });

    expect(saveCredential).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it("propagates non-429 errors instead of looping forever", async () => {
    const { CliHttpError } = await import("../src/http.js");
    wireRequestJson([() => new CliHttpError(500, "boom")]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const { login } = await import("../src/login.js");

    await expect(login(ADMIN_URL, { sleep, now: () => 0, pollIntervalMs: 1000 })).rejects.toMatchObject({
      status: 500,
    });
    expect(saveCredential).not.toHaveBeenCalled();
  });
});
