import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, ApiError, apiRaw, setAccessToken } from "../src/api/client";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });
beforeEach(() => {
  setAccessToken("");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("api client correlation + logging", () => {
  it("sends X-Request-Id and console.errors with the returned id before throwing", async () => {
    let sentId: string | null = null;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentId = new Headers(init.headers).get("x-request-id");
      return new Response(JSON.stringify({ error: "boom" }), {
        status: 500,
        headers: { "x-request-id": "srv-trace-9" },
      });
    }) as typeof fetch;

    await expect(api("/api/thing", { method: "POST", body: "{}" })).rejects.toBeInstanceOf(ApiError);
    expect(sentId).toBeTruthy();
    const call = (console.error as any).mock.calls.find((c: any[]) => String(c[0]).includes("[api]"));
    expect(call).toBeTruthy();
    expect(JSON.stringify(call[1])).toContain("srv-trace-9");
  });

  it("ApiError carries the requestId", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", { status: 404, headers: { "x-request-id": "srv-trace-404" } })) as typeof fetch;
    try {
      await api("/api/x");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).requestId).toBe("srv-trace-404");
    }
  });

  it("apiRaw refreshes on 401, retries with the new token, and returns the raw response", async () => {
    setAccessToken("expired-token");
    const authorizations: Array<string | null> = [];
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (url === "/api/auth/refresh") {
        return new Response(JSON.stringify({ accessToken: "fresh-token" }), { status: 200 });
      }
      authorizations.push(new Headers(init.headers).get("authorization"));
      if (authorizations.length === 1) {
        return new Response("expired", { status: 401 });
      }
      return new Response("compiled module", {
        status: 200,
        headers: { "x-sf-stale": "1", "content-type": "text/javascript" },
      });
    }) as typeof fetch;

    const res = await apiRaw("/api/layouts/layout-1/module.js");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-sf-stale")).toBe("1");
    expect(await res.text()).toBe("compiled module");
    expect(authorizations).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });
});
