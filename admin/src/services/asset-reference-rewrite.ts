export function rewriteAssetReferences(value: unknown, replacements: Map<string, string>): { value: unknown; changed: boolean } {
  if (typeof value === "string") {
    const replacement = replacements.get(value);
    return replacement ? { value: replacement, changed: true } : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = rewriteAssetReferences(item, replacements);
      changed ||= result.changed;
      return result.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = rewriteAssetReferences(item, replacements);
      changed ||= result.changed;
      next[key] = result.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
}

// Rich text is stored as sanitized HTML, which always double-quotes attribute values.
export function rewriteHtmlAssetReference(html: string, oldPath: string, newPath: string): { value: string; changed: boolean } {
  const parts = html.split(`="${oldPath}"`);
  return parts.length === 1 ? { value: html, changed: false } : { value: parts.join(`="${newPath}"`), changed: true };
}
