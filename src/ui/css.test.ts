/** What the stylesheet and the code both know about the screen must not drift apart. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BAR, NARROW } from "./screen.ts";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("the stylesheet's phone media query is character for character the code's", () => {
  const sized = [...css.matchAll(/@media ([^{]+)\{/g)].map((m) => m[1].trim()).filter((q) => q.includes("width"));
  assert.ok(sized.length > 0);
  assert.deepEqual([...new Set(sized)], [NARROW]);
});

test("the strip the sheet leaves at the top is BAR pixels on a screen without a notch", () => {
  const m = css.match(/\.ruler \{[^}]*height: calc\(max\((\d+)px, env\(safe-area-inset-top\)\) \+ (\d+)px\)/);
  assert.ok(m, "the ruler's height is where it was");
  assert.equal(Number(m[1]) + Number(m[2]), BAR);
});
