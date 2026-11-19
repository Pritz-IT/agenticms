import { afterEach, describe, expect, it } from "vitest";
import { PreviewStore } from "../../src/services/blog/preview-store.js";

let now = 0;
let store: PreviewStore;
const owner = { userId: "u1", siteKey: "demo", postKey: "hello" };

afterEach(() => store.close());

describe("PreviewStore", () => {
  it("keeps one stable, unguessable token per editor and post", () => {
    store = new PreviewStore(1_000, () => now);
    const first = store.open(owner);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.open(owner).token).toBe(first.token);
    expect(store.open({ ...owner, userId: "u2" }).token).not.toBe(first.token);
    expect(store.open({ ...owner, postKey: "other" }).token).not.toBe(first.token);
  });

  it("versions each publish and notifies subscribers", () => {
    store = new PreviewStore(1_000, () => now);
    const { token } = store.open(owner);
    const seen: number[] = [];
    const unsubscribe = store.subscribe(token, (version) => seen.push(version));
    expect(store.publish(token, "<p>1</p>")).toBe(1);
    expect(store.publish(token, "<p>2</p>")).toBe(2);
    unsubscribe();
    store.publish(token, "<p>3</p>");
    expect(seen).toEqual([1, 2]);
    expect(store.get(token)?.html).toBe("<p>3</p>");
  });

  it("expires after the TTL, slides on use, and hands out a new token afterwards", () => {
    now = 0;
    store = new PreviewStore(1_000, () => now);
    const { token } = store.open(owner);
    now = 900;
    store.publish(token, "x");
    now = 1_800;
    expect(store.get(token)).not.toBeNull();
    now = 2_900;
    expect(store.get(token)).toBeNull();
    expect(() => store.publish(token, "y")).toThrow(/expired/);
    expect(store.open(owner).token).not.toBe(token);
  });

  it("sweeps expired snapshots", () => {
    now = 0;
    store = new PreviewStore(1_000, () => now);
    store.open(owner);
    store.open({ ...owner, postKey: "b" });
    now = 1_000;
    expect(store.sweep()).toBe(2);
  });
});
