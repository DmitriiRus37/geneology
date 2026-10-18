/**
 * Snapshots of the layout's output: where every card stands and every line runs, for
 * the sample tree and twenty synthetic ones, in both modes. Any change to the picture
 * fails here — which is the point while the layout code is only being rearranged.
 * After a deliberate layout change: `npm run test:update`, then look at the diff.
 *
 * Only ids and numbers are recorded, never names. Small trees are kept whole so a
 * failure shows what moved; large ones as a fingerprint, to keep the file small.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Lang } from "../i18n.ts";
import { normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { nodeCards } from "../testing/cards.ts";
import { synthTree } from "../testing/trees.ts";
import { computeEdges } from "./edges.ts";
import { layout } from "./layout.ts";

/** A thousandth of a pixel: far below anything visible, far above float noise. */
const round = (v: number) => Math.round(v * 1000) / 1000;
const roundPath = (d: string) => d.replace(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g, (m) => String(round(Number(m))));

function picture(tree: TreeState, lang: Lang = "ru", selected: string | null = null) {
  const lay = layout(tree, nodeCards(lang));
  const edges = computeEdges(tree, lay.pos, lay.level, selected);
  return {
    cards: Object.fromEntries(Object.entries(lay.pos).map(([id, b]) => [id, [round(b.x), round(b.y), round(b.w), round(b.h)]])),
    rows: lay.level,
    lines: edges.map((e) =>
      e.kind === "path"
        ? { d: roundPath(e.d), arrow: e.arrow, hot: e.hot, dashed: !!e.dashed, ref: e.ref ?? null }
        : { joint: [round(e.x), round(e.y)], hot: e.hot },
    ),
    plate: lay.lonePlate ? [round(lay.lonePlate.x), round(lay.lonePlate.y), round(lay.lonePlate.w)] : null,
    years: lay.tl ? { min: lay.tl.min, max: lay.tl.max, scale: round(lay.tl.scale), est: Object.keys(lay.tl.est).sort(), year: lay.tl.year } : null,
  };
}

const fingerprint = (p: ReturnType<typeof picture>) => ({
  cards: Object.keys(p.cards).length,
  lines: p.lines.length,
  sha256: createHash("sha256").update(JSON.stringify(p)).digest("hex"),
});

const both = (tree: TreeState) => [false, true].map((timeline) => ({ ...tree, timeline }));

const sample = () => normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

test("the sample tree, by generations and by years, in both languages", (t) => {
  const [gens, years] = both(sample());
  t.assert.snapshot({
    ruGenerations: picture(gens, "ru"),
    ruYears: picture(years, "ru"),
    enGenerations: picture(gens, "en"),
    enYears: picture(years, "en"),
  });
});

test("the sample tree with someone selected: their lines are drawn hot", (t) => {
  const tree = sample();
  const someone = Object.keys(tree.people)[Math.floor(Object.keys(tree.people).length / 2)];
  t.assert.snapshot(picture(tree, "ru", someone).lines);
});

const SIZES = [5, 8, 12, 16, 20, 25, 30, 40, 50, 60, 80, 100, 120, 150, 180, 200, 230, 260, 280, 300];

for (const [i, size] of SIZES.entries()) {
  test(`synthetic tree ${i + 1}: ${size} people, both modes`, (t) => {
    const [gens, years] = both(synthTree({ seed: 1000 + i, size }));
    const [a, b] = [picture(gens), picture(years)];
    t.assert.snapshot(size <= 60 ? { generations: a, years: b } : { generations: fingerprint(a), years: fingerprint(b) });
  });
}
