import { afterEach, describe, expect, it, vi } from "vitest";
import { CliHttpError, requestJson } from "../src/http";

describe("requestJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries transient fetch failures before parsing a successful response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await expect(requestJson("https://cms.example.com", "/api/demo")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("https://cms.example.com/api/demo", expect.any(Object));
  });

  it("does not retry HTTP error responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));

    await expect(requestJson("https://cms.example.com", "/api/demo")).rejects.toMatchObject({
      name: "CliHttpError",
      status: 401,
      message: "nope",
    } satisfies Partial<CliHttpError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends bearer credentials on retried requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await requestJson("https://cms.example.com", "/api/demo", {}, {
      token: "sfcli_token",
      expiresAt: "2030-01-01T00:00:00.000Z",
    });

    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sfcli_token");
  });
});
