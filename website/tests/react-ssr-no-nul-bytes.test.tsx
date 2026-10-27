import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import React from "react";
import { renderToPipeableStream, renderToString } from "react-dom/server";

// Regression: React 18's Node streaming writer (renderToPipeableStream, which @astrojs/react uses by default)
// emits a NUL byte whenever a multi-byte character lands on its 2048-byte buffer boundary. Built pages then
// contained e.g. "Qualit\0ät". The site config must render without streaming.

const config = readFileSync(fileURLToPath(new URL("../astro.config.mjs", import.meta.url)), "utf-8");
assert.match(
  config,
  /react\(\{[^}]*experimentalDisableStreaming:\s*true[^}]*\}\)/,
  "astro.config.mjs must pass experimentalDisableStreaming: true to @astrojs/react"
);

// Many short text nodes keep React on its buffered path; shifting the padding moves "ä"/"®" across the boundary.
function page(pad: number) {
  const kids = Array.from({ length: 200 }, (_, i) => <p key={i}>{"x".repeat(pad + (i % 7))}Qualität ORPIT®</p>);
  return <div>{kids}</div>;
}

function streamed(el: React.ReactElement): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = renderToPipeableStream(el, {
      onError: reject,
      onAllReady() {
        s.pipe(new Writable({
          write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); },
          final(cb) { resolve(Buffer.concat(chunks)); cb(); },
        }));
      },
    });
  });
}

let streamedWithNul = 0;
for (let pad = 0; pad < 64; pad++) {
  assert.ok(!renderToString(page(pad)).includes("\0"), `renderToString produced a NUL byte (pad ${pad})`);
  if ((await streamed(page(pad))).includes(0)) streamedWithNul++;
}
// Documents why the flag exists; once React is upgraded past the bug this count drops to 0 and is harmless.
console.log(`react-ssr-no-nul-bytes: renderToString clean, streaming produced NUL in ${streamedWithNul}/64 renders`);
