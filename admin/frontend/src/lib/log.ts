export function genId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // non-secure context: crypto.randomUUID unavailable — fall through
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function logError(scope: string, message: string, context?: unknown): void {
  // Durable record before any ephemeral toast — the user will click the
  // toast away; this line is the only thing left to trace the failure.
  console.error(`[${scope}] ${message}`, context ?? "");
}
