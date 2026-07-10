import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyedDebounce } from "../../frontend/src/lib/keyed-debounce";

describe("createKeyedDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid calls for the same key into one trailing call", () => {
    const debounce = createKeyedDebounce(500);
    const calls: string[] = [];

    debounce.schedule("title", () => calls.push("P"));
    debounce.schedule("title", () => calls.push("Pr"));
    debounce.schedule("title", () => calls.push("Pritz"));

    vi.advanceTimersByTime(499);
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(calls).toEqual(["Pritz"]);
  });

  it("keeps independent timers per key", () => {
    const debounce = createKeyedDebounce(500);
    const calls: string[] = [];

    debounce.schedule("title", () => calls.push("title"));
    vi.advanceTimersByTime(300);
    debounce.schedule("description", () => calls.push("description"));

    vi.advanceTimersByTime(200);
    expect(calls).toEqual(["title"]);

    vi.advanceTimersByTime(300);
    expect(calls).toEqual(["title", "description"]);
  });

  it("fires again for a key after the previous call flushed", () => {
    const debounce = createKeyedDebounce(500);
    const calls: string[] = [];

    debounce.schedule("title", () => calls.push("first"));
    vi.advanceTimersByTime(500);
    debounce.schedule("title", () => calls.push("second"));
    vi.advanceTimersByTime(500);

    expect(calls).toEqual(["first", "second"]);
  });

  it("flushAll runs pending calls immediately and cancels their timers", () => {
    const debounce = createKeyedDebounce(500);
    const calls: string[] = [];

    debounce.schedule("title", () => calls.push("title"));
    debounce.schedule("description", () => calls.push("description"));

    debounce.flushAll();
    expect(calls).toEqual(["title", "description"]);

    vi.advanceTimersByTime(1000);
    expect(calls).toEqual(["title", "description"]);
  });

  it("flushAll with nothing pending is a no-op", () => {
    const debounce = createKeyedDebounce(500);
    expect(() => debounce.flushAll()).not.toThrow();
  });
});
