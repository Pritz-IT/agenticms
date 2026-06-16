export interface DataCaps {
  maxBytes: number;
  maxKeys: number;
  maxStrLen: number;
  maxDepth: number;
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Validate an untrusted JSON object against size/shape caps.
 *
 * The recursive walk starts at depth 1 and rejects when `depth > caps.maxDepth`.
 * So `maxDepth = 3` permits at most TWO levels of nested objects from the root:
 *   { a: { b: primitive } }            → passes
 *   { a: { b: { c: primitive } } }     → rejected
 * Arrays count their indices toward `maxKeys` and recurse like objects.
 */
export function checkDataCaps(data: unknown, caps: DataCaps): GuardResult {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "data must be an object" };
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return { ok: false, reason: "data not serializable" };
  }
  if (serialized.length > caps.maxBytes) {
    return { ok: false, reason: "data too large" };
  }

  let keyCount = 0;
  const walk = (value: unknown, depth: number): GuardResult => {
    if (depth > caps.maxDepth) return { ok: false, reason: "data too deep" };
    if (typeof value === "string" && value.length > caps.maxStrLen) {
      return { ok: false, reason: "string too long" };
    }
    if (value && typeof value === "object") {
      for (const [, v] of Object.entries(value)) {
        keyCount += 1;
        if (keyCount > caps.maxKeys) return { ok: false, reason: "too many keys" };
        const r = walk(v, depth + 1);
        if (!r.ok) return r;
      }
    }
    return { ok: true };
  };
  return walk(data, 1);
}

export function originAllowed(
  origin: string | undefined,
  settings: { domain: string; stagingDomain: string } | null
): boolean {
  if (!origin) return true; // same-origin POST / non-browser client
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  // Loopback is always safe (local dev/prod testing) and must be allowed
  // independent of configured site settings — a fresh DB has no Settings
  // row, and this origin check is a soft abuse filter, not a security
  // boundary (a client can already omit Origin entirely above).
  if (
    host.startsWith("localhost:") ||
    host.startsWith("127.0.0.1:") ||
    host.startsWith("[::1]:")
  ) {
    return true;
  }
  if (!settings) return false;
  const allow = [settings.domain, settings.stagingDomain]
    .filter(Boolean)
    .map((d) => d.toLowerCase());
  return allow.includes(host);
}
