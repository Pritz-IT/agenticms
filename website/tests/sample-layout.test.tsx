import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layoutSource = readFileSync(resolve("../examples/layouts/Home.tsx"), "utf-8");

assert.match(layoutSource, /import\s+\{\s*ImageField,\s*LinkField,\s*RichText,\s*type\s+LayoutProps\s*\}\s+from\s+"@agenticms\/components"/);
assert.match(layoutSource, /export\s+const\s+keys\s*=\s*\{/);
assert.match(layoutSource, /"hero\.title":\s*\{\s*type:\s*"text"/);
assert.match(layoutSource, /"hero\.body":\s*\{\s*type:\s*"richtext"/);
assert.match(layoutSource, /"hero\.image":\s*\{\s*type:\s*"image"/);

assert.doesNotMatch(layoutSource, /dangerouslySetInnerHTML/);
