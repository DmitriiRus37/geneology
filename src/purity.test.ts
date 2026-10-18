/**
 * model/ and layout/ run in Node — the tests and tools/metrics.ts import them — so they
 * must not touch the browser. This reads their sources and refuses any browser global.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const BROWSER = /\b(document|window|localStorage|sessionStorage|navigator|HTMLCanvasElement|OffscreenCanvas|getContext|measureText|requestAnimationFrame)\b/g;

/** The browser globals in a piece of code, comments aside. */
const browserIn = (code: string): string[] =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .match(BROWSER) ?? [];

test("the purity check sees a browser global, and not one in a comment", () => {
  assert.deepEqual(browserIn('const c = document.createElement("canvas"); // window'), ["document"]);
  assert.deepEqual(browserIn("/** measured with a canvas in the window */ const x = 1;"), []);
});

for (const dir of ["model", "layout"]) {
  test(`${dir}/ touches nothing of the browser`, () => {
    const found: string[] = [];
    for (const name of readdirSync(new URL(dir, import.meta.url))) {
      if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
      const code = readFileSync(new URL(dir + "/" + name, import.meta.url), "utf8");
      for (const g of new Set(browserIn(code))) found.push(name + ": " + g);
    }
    assert.deepEqual(found, []);
  });
}
