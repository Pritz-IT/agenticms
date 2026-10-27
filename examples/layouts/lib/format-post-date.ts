export function formatPostDate(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  try {
    return date.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    console.warn("[blog] Invalid date locale; using the stored date", error);
    return value;
  }
}
