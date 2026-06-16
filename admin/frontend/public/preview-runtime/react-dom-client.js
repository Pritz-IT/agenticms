const runtime = window.__SF_PREVIEW__;
if (!runtime?.ReactDOMClient) throw new Error("AgentiCMS preview ReactDOM client runtime is not available");
const C = runtime.ReactDOMClient;

export default C;
export const createRoot = C.createRoot;
export const hydrateRoot = C.hydrateRoot;
