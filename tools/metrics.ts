/**
 * Layout quality metrics. To run:
 *
 *   node tools/metrics.ts            # on persons/ (your data)
 *   node tools/metrics.ts seed       # on src/data/family.json (the original 38)
 *   node tools/metrics.ts /path/to/copy   # on a copy: persons/ changes while you work
 *
 * Measuring before and after a change is mandatory: the layout is built in such a way
 * that almost any improvement of one number spoils another. Quote the numbers rather than
 * claiming an improvement.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { edgeStats } from "../src/layout/crossings.ts";
import { computeEdges } from "../src/layout/edges.ts";
import { bboxOf, layout, rectOf } from "../src/layout/layout.ts";
import type { Pt, Rect } from "../src/layout/route.ts";
import { cardsToTree } from "../src/model/cards.ts";
import { normalize } from "../src/model/tree.ts";
import type { TreeState } from "../src/model/types.ts";
import { nodeCards } from "../src/testing/cards.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The tree from a persons/ folder, read exactly the way the server's disk store reads
 * it: every `.json` by name, through `cardsToTree`, then `normalize` as the app does —
 * so `_view.json` (the hidden, the gap) and the ids taken from file names count.
 */
export function fromFolder(dir: string): TreeState {
  const names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  const files = names.map((n): [string, string] => [n, readFileSync(join(dir, n), "utf8")]);
  return normalize(cardsToTree(files, console.warn));
}

const arg = process.argv[2];
const seed = arg === "seed";
const dir = arg && !seed ? arg : join(ROOT, "persons");
const source = (): TreeState =>
  seed
    ? normalize(JSON.parse(readFileSync(join(ROOT, "src/data/family.json"), "utf8")))
    : fromFolder(dir);

/** The distance from a segment to a rectangle; 0 means touching or crossing. */
function distance(a: Pt, b: Pt, o: Rect): number {
  const toCorner = (px: number, py: number) =>
    Math.hypot(Math.max(o.x1 - px, 0, px - o.x2), Math.max(o.y1 - py, 0, py - o.y2));
  let m = Infinity;
  for (let t = 0; t <= 1; t += 0.02) m = Math.min(m, toCorner(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
  return m;
}

function main(): void {
  for (const byYears of [false, true]) {
    const s = source();
    s.timeline = byYears;
    const { pos, level } = layout(s, nodeCards());
    const ids = Object.keys(pos);
    const rects = ids.map((id) => rectOf(pos[id]));
    const items = computeEdges(s, pos, level, null);
    const lines = items.filter((i) => i.kind === "path");

    // cards on top of each other
    let overlaps = 0;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const A = pos[ids[i]];
        const B = pos[ids[j]];
        if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 - 0.5 && Math.max(A.y, B.y) < Math.min(A.y + A.h, B.y + B.h) - 0.5)
          overlaps++;
      }

    // crossings, buses too close and lines through a card — by the formula shared with the layout
    const st = edgeStats(items, rects);

    // a line flush against somebody else's card
    let tight = 0;
    let gap = Infinity;
    for (const it of lines) {
      if (it.kind !== "path") continue;
      const ref = it.ref;
      const own = new Set<string>();
      if (ref?.kind === "child") {
        ref.parents.forEach((p) => own.add(p));
        own.add(ref.child);
      }
      if (ref?.kind === "leg") {
        own.add(ref.parent);
        ref.children.forEach((c) => own.add(c));
      }
      if (ref?.kind === "couple") {
        own.add(ref.a);
        own.add(ref.b);
        ref.children.forEach((c) => own.add(c));
      }
      for (let i = 1; i < it.pts.length; i++)
        for (const id of ids) {
          if (own.has(id)) continue;
          const d = distance(it.pts[i - 1], it.pts[i], rectOf(pos[id]));
          if (d < 5) tight++;
          gap = Math.min(gap, d);
        }
    }

    // slanted lines and the arrows to children: vertical versus stepped
    let slanted = 0;
    let straight = 0;
    let stepped = 0;
    for (const it of lines) {
      if (it.kind !== "path") continue;
      if (it.ref?.kind === "child") {
        if (it.pts.length === 2 && Math.abs(it.pts[0].x - it.pts[1].x) < 0.6) straight++;
        else stepped++;
      }
      for (let i = 1; i < it.pts.length; i++) {
        const a = it.pts[i - 1];
        const b = it.pts[i];
        if (Math.abs(a.y - b.y) >= 0.6 && Math.abs(a.x - b.x) >= 0.6) slanted++;
      }
    }

    const b = bboxOf(pos);
    console.log(`\n=== ${byYears ? "by years" : "by generations"} · people ${ids.length} ===`);
    console.log(`  overlapping cards .......... ${overlaps}`);
    console.log(`  lines through a card ....... ${st.through}`);
    console.log(`  segments closer than 5 px .. ${tight} (smallest gap ${gap === Infinity ? "—" : gap.toFixed(1)} px)`);
    console.log(`  slanted lines .............. ${slanted}`);
    console.log(`  line crossings ............. ${st.crossings} (by paths), ${st.visual} (visually)`);
    console.log(`  bus pairs closer than 12 px  ${st.busNear}`);
    console.log(`  arrows to children ......... ${straight} vertical, ${stepped} stepped`);
    console.log(`  tree size .................. ${b ? Math.round(b.w) + " × " + Math.round(b.h) : "—"} px`);
  }
}

// run as a tool; the tests import `fromFolder` only
if (import.meta.main) main();
