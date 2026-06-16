const runtime = window.__SF_PREVIEW__;
if (!runtime?.JsxRuntime) throw new Error("AgentiCMS preview JSX runtime is not available");
const J = runtime.JsxRuntime;

export const Fragment = J.Fragment;
export const jsx = J.jsx;
export const jsxs = J.jsxs;
