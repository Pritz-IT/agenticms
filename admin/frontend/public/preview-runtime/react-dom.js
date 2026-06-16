const runtime = window.__SF_PREVIEW__;
if (!runtime?.ReactDOM) throw new Error("AgentiCMS preview ReactDOM runtime is not available");
const D = runtime.ReactDOM;

export default D;
export const createPortal = D.createPortal;
export const flushSync = D.flushSync;
export const unstable_batchedUpdates = D.unstable_batchedUpdates;
