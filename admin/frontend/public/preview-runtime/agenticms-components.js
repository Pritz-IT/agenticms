const runtime = window.__SF_PREVIEW__;
if (!runtime?.Shims) throw new Error("AgentiCMS preview component shims are not available");
const S = runtime.Shims;

export const EditableWrap = S.EditableWrap;
export const ImageField = S.ImageField;
export const LinkField = S.LinkField;
export const RichText = S.RichText;
export const sanitizeRichText = S.sanitizeRichText;
