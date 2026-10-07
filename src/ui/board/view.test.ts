import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box } from "../../layout/layout.ts";
import { BAR } from "../screen.ts";
import { fitted, hidden, nudge, wheelMove, zoomAt } from "./view.ts";

const PHONE = { left: 0, top: 0, width: 400, height: 800 };
const WIDE_TREE = { x1: 0, y1: 0, x2: 5000, y2: 1000, w: 5000, h: 1000 };
const card = (x: number, y: number): Box => ({ x, y, w: 202, h: 60, lines: [] });

test("fitting: a phone opens at a readable scale, «Show all» shows all", () => {
  assert.equal(fitted(WIDE_TREE, PHONE, 0, true).k, 0.6);
  assert.equal(fitted(WIDE_TREE, PHONE, 0, false).k, 0.12);
  const small = { x1: 0, y1: 0, x2: 100, y2: 100, w: 100, h: 100 };
  assert.equal(fitted(small, PHONE, 0, false).k, 1.15, "a small tree is not blown up past this");
});

test("fitting centres the tree in what the sheet leaves", () => {
  const b = { x1: 0, y1: 0, x2: 200, y2: 100, w: 200, h: 100 };
  const v = fitted(b, PHONE, 300, false);
  assert.equal(v.y + (b.y1 + b.h / 2) * v.k, (800 - 300) / 2);
  assert.equal(v.x + (b.x1 + b.w / 2) * v.k, 200);
});

test("zoom keeps the point under the cursor and stays within its bounds", () => {
  const v = zoomAt({ k: 1, x: 10, y: 20 }, 2, 100, 100);
  assert.deepEqual(v, { k: 2, x: -80, y: -60 });
  assert.equal(zoomAt({ k: 1, x: 0, y: 0 }, 100, 0, 0).k, 3);
  assert.equal(zoomAt({ k: 1, x: 0, y: 0 }, 0.001, 0, 0).k, 0.1);
});

test("a selected card is brought out from under the bar or the sheet, unless the sheet is all the way up", () => {
  const v = { k: 1, x: 0, y: 0 };
  assert.equal(hidden(v, card(200, 300), PHONE, 300), false, "in plain sight");
  assert.equal(hidden(v, card(200, BAR - 1), PHONE, 300), true, "under the bar");
  assert.equal(hidden(v, card(200, 450), PHONE, 300), true, "under the sheet");
  assert.equal(hidden(v, card(200, 700), PHONE, 650), false, "the sheet is all the way up");
});

test("bringing a card into view moves only as far as needed", () => {
  const v = { k: 1, x: 0, y: 0 };
  assert.deepEqual(nudge(v, card(200, 300), PHONE, 0), { dx: 0, dy: 0 });
  assert.deepEqual(nudge(v, card(380, 300), PHONE, 0), { dx: -161, dy: 0 });
});

test("the wheel: a pinch zooms, lines and Shift scroll, nothing does nothing", () => {
  const base = { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, clientX: 50, clientY: 60 };
  const r = { left: 10, top: 20, width: 400, height: 800 };
  assert.deepEqual(wheelMove({ ...base, ctrlKey: true, deltaY: -1000 }, r), { zoom: 1.5, cx: 40, cy: 40 });
  assert.deepEqual(wheelMove({ ...base, deltaY: 3, deltaMode: 1 }, r), { dx: 0, dy: 48 });
  assert.deepEqual(wheelMove({ ...base, deltaY: 30, shiftKey: true }, r), { dx: 30, dy: 0 });
  assert.equal(wheelMove(base, r), null);
});
