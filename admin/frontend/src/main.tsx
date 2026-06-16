import React from "react";
import * as ReactRuntime from "react";
import ReactDOM from "react-dom/client";
import * as ReactDOMClientRuntime from "react-dom/client";
import * as ReactDOMRuntime from "react-dom";
import * as JsxRuntime from "react/jsx-runtime";
import * as AgentiCmsShims from "./components/visual-editor/agenticms-shims";
import "./index.css";
import { App } from "./App";

declare global {
  interface Window {
    __SF_PREVIEW__?: {
      React: typeof ReactRuntime;
      ReactDOM: typeof ReactDOMRuntime;
      ReactDOMClient: typeof ReactDOMClientRuntime;
      JsxRuntime: typeof JsxRuntime;
      Shims: typeof AgentiCmsShims;
    };
  }
}

window.__SF_PREVIEW__ = {
  React: ReactRuntime,
  ReactDOM: ReactDOMRuntime,
  ReactDOMClient: ReactDOMClientRuntime,
  JsxRuntime,
  Shims: AgentiCmsShims,
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
