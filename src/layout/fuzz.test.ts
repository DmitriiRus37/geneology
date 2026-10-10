/**
 * Random trees against the rules the layout promises (CLAUDE.md): no card overlaps
 * another, no line runs through a card or at a slant, nothing is NaN, and by
 * generations a parent stands exactly one row above each child. Random trees have
 * caught bugs the real data never showed.
 *
 * The seeds are fixed, so a failure names the tree to rebuild:
 *   synthTree({ seed, size }) from src/testing/trees.ts
 *
 * By years this test used to find lines through cards on a fifth of the trees: a
 * guessed year put a child level with its parent, and the routing knew only "down,
 * across, down" and let a family's lines cross the family's own cards. Both modes
 * now owe the same promise here, the rows apart.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TreeState } from "../model/types.ts";
import { rng, synthTree } from "../testing/trees.ts";
import { computeEdges } from "./edges.ts";
import { bboxOf, layout } from "./layout.ts";
import { hitsCard, type Rect } from "./route.ts";
import { nodeCards } from "../testing/cards.ts";

const TREES = 200;
const finite = (v: number) => Number.isFinite(v);

/** Everything wrong with the picture of one tree; empty when all is well. */
function faults(s: TreeState): string[] {
  const found: string[] = [];
  const fault = (text: string) => found.push(text);
  const { pos, level } = layout(s, nodeCards());
  const ids = Object.keys(pos);

  for (const id of ids) {
    const b = pos[id];
    if (![b.x, b.y, b.w, b.h].every(finite)) fault("NaN in the card of " + id);
    if (!Number.isInteger(level[id]) || level[id] < 0) fault("a bad row for " + id);
  }
  const box = bboxOf(pos);
  if (ids.length && !(box && finite(box.w) && finite(box.h))) fault("NaN in the bounding box");

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = pos[ids[i]];
      const B = pos[ids[j]];
      const dx = Math.abs(A.x - B.x) - (A.w + B.w) / 2;
      const dy = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
      if (dx < -0.5 && dy < -0.5) fault("cards overlap: " + ids[i] + " × " + ids[j]);
    }
  }

  const rects: Rect[] = ids.map((id) => ({ x1: pos[id].x - pos[id].w / 2, y1: pos[id].y, x2: pos[id].x + pos[id].w / 2, y2: pos[id].y + pos[id].h }));
  for (const it of computeEdges(s, pos, level, null)) {
    if (it.kind !== "path") {
      if (!finite(it.x) || !finite(it.y)) fault("NaN in a joint");
      continue;
    }
    if (/NaN|Infinity|undefined/.test(it.d)) fault("NaN in a line: " + it.d);
    if (hitsCard(it.pts, rects)) fault("a line runs through a card: " + it.d);
    for (let i = 1; i < it.pts.length; i++) {
      const a = it.pts[i - 1];
      const b = it.pts[i];
      if (Math.abs(a.x - b.x) >= 0.6 && Math.abs(a.y - b.y) >= 0.6) fault("a slanted segment: " + JSON.stringify([a, b]));
    }
  }

  if (!s.timeline) {
    for (const l of s.links) {
      if (level[l.child] - level[l.parent] !== 1) fault(`a parent is not one row above the child: ${l.parent} → ${l.child}`);
    }
  }
  return found;
}

/** The trees: sizes drawn from their own seeded stream, so adding a check does not change them. */
const cases = (() => {
  const r = rng(20260927);
  return Array.from({ length: TREES }, (_, i) => ({ seed: 5000 + i, size: 3 + Math.floor(r() * 58) }));
})();

test(`${TREES} random trees by generations keep every promise`, () => {
  const broken = cases.flatMap(({ seed, size }) => faults(synthTree({ seed, size })).map((f) => `seed ${seed}, size ${size}: ${f}`));
  assert.deepEqual(broken, []);
});

test(`${TREES} random trees by years keep every promise but the rows: no overlap, no line through a card, no slant`, () => {
  const broken = cases.flatMap(({ seed, size }) =>
    faults({ ...synthTree({ seed, size }), timeline: true }).map((f) => `seed ${seed}, size ${size}: ${f}`),
  );
  assert.deepEqual(broken, []);
});
