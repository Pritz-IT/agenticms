import { describe, it, expect } from "vitest";
import { checkDataCaps, originAllowed } from "../../src/lib/submission-guards.js";

const caps = { maxBytes: 4096, maxKeys: 40, maxStrLen: 1000, maxDepth: 3 };

describe("checkDataCaps", () => {
  it("accepts a normal quiz payload", () => {
    const data = { answers: [0, 1, 2, 1, 0, 2, 1, 1], level: "low", pct: 8 };
    expect(checkDataCaps(data, caps)).toEqual({ ok: true });
  });
  it("rejects non-objects", () => {
    expect(checkDataCaps(null, caps).ok).toBe(false);
    expect(checkDataCaps("x" as unknown, caps).ok).toBe(false);
  });
  it("rejects oversize payloads", () => {
    const data = { blob: "x".repeat(5000) };
    expect(checkDataCaps(data, caps).ok).toBe(false);
  });
  it("rejects too many keys", () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 41; i++) data["k" + i] = i;
    expect(checkDataCaps(data, caps).ok).toBe(false);
  });
  it("rejects an over-long string value", () => {
    expect(checkDataCaps({ a: "y".repeat(1001) }, caps).ok).toBe(false);
  });
  it("rejects nesting deeper than maxDepth", () => {
    expect(checkDataCaps({ a: { b: { c: { d: 1 } } } }, caps).ok).toBe(false);
  });
  it("accepts the deepest-allowed nesting shape", () => {
    // maxDepth=3, walk starts at depth 1 → two levels of object nesting pass
    expect(checkDataCaps({ a: { b: 1 } }, caps)).toEqual({ ok: true });
  });
});

describe("originAllowed", () => {
  const s = { domain: "example.com", stagingDomain: "staging.example.com" };
  it("allows a missing origin (same-origin / non-browser)", () => {
    expect(originAllowed(undefined, s)).toBe(true);
  });
  it("allows the production and staging origins (standard ports)", () => {
    expect(originAllowed("https://example.com", s)).toBe(true);
    expect(originAllowed("https://staging.example.com", s)).toBe(true);
  });
  it("rejects a foreign origin", () => {
    expect(originAllowed("https://evil.example", s)).toBe(false);
  });
  it("rejects an unparseable origin", () => {
    expect(originAllowed("not a url", s)).toBe(false);
  });
  it("rejects when no settings are configured", () => {
    expect(originAllowed("https://example.com", null)).toBe(false);
  });
  it("allows loopback origins even with no settings (local dev/prod)", () => {
    expect(originAllowed("http://localhost:8080", null)).toBe(true);
    expect(originAllowed("http://127.0.0.1:4321", null)).toBe(true);
    expect(originAllowed("http://localhost:5173", s)).toBe(true);
  });
});
