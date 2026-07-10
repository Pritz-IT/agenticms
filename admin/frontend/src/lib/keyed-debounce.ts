export interface KeyedDebounce {
  /** Schedule `fire` for `key`, replacing any pending call for the same key. */
  schedule(key: string, fire: () => void): void;
  /** Immediately run and clear every pending call (e.g. on unmount, so edits are not lost). */
  flushAll(): void;
}

/**
 * Trailing debounce with one timer per key. Edits to different keys don't
 * cancel each other; rapid edits to the same key collapse into one call with
 * the latest closure. Prevents the per-keystroke save flood whose out-of-order
 * PUTs corrupted content values in the page editor.
 */
export function createKeyedDebounce(delayMs: number): KeyedDebounce {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; fire: () => void }>();

  return {
    schedule(key: string, fire: () => void) {
      const existing = pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        pending.delete(key);
        fire();
      }, delayMs);
      pending.set(key, { timer, fire });
    },
    flushAll() {
      for (const { timer, fire } of pending.values()) {
        clearTimeout(timer);
        fire();
      }
      pending.clear();
    },
  };
}
