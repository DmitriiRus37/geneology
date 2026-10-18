/** Generation rows: which row every person stands in. */
import { yearOfBirth } from "../model/dates.ts";
import type { TreeState } from "../model/types.ts";
import { extent, Merge, push } from "../util.ts";
import { components, type Graph } from "./families.ts";

/** Generation: a child is always below the "youngest" of its parents, spouses are level. */
export function computeLevels(state: TreeState, g: Graph): Record<string, number> {
  const ids = Object.keys(state.people);
  const level: Record<string, number> = {};
  for (const id of ids) level[id] = 0;
  const guard = ids.length + 6;
  /** Who is due to stand in one row: spouses and explicit siblings. */
  const sideBySidePairs = [...state.pairs, ...state.sibs].filter(
    (pr) => state.people[pr.a] && state.people[pr.b],
  );

  /**
   * A child below its parents, spouses level, siblings level — until it settles.
   * Returns whether it converged: a marriage across generations (he married the
   * great-granddaughter of his cousin) makes the rules incompatible and the levels
   * sink without end — in that case we do not level the siblings, as it was before
   * this rule existed.
   */
  const relax = (siblings: boolean): boolean => {
  for (let it = 0; it < guard; it++) {
    let changed = false;
    for (const id of ids) {
      const ps = g.parents[id];
      if (!ps.length) continue;
      let m = 0;
      for (const p of ps) if (level[p] > m) m = level[p];
      for (const p of ps) {
        if (level[p] < m) {
          level[p] = m;
          changed = true;
        }
      }
      if (level[id] < m + 1) {
        level[id] = m + 1;
        changed = true;
      }
    }
    // spouses level; explicit siblinghood holds by the same rule
    for (const pr of sideBySidePairs) {
      const m = Math.max(level[pr.a], level[pr.b]);
      for (const who of [pr.a, pr.b]) {
        if (level[who] < m) {
          level[who] = m;
          changed = true;
        }
      }
    }
    // Siblings are one generation and one row. Otherwise a brother carried down by
    // a marriage ended up three rows below his unmarried brother, and their parents
    // hung at the very top: pulling down to the children looks at the topmost
    // child. Moving down is always allowed — the "child below its parent" rule does
    // not suffer from it.
    for (const id of siblings ? ids : []) {
      const kids = g.children[id];
      if (kids.length < 2) continue;
      let m = 0;
      for (const c of kids) if (level[c] > m) m = level[c];
      for (const c of kids) {
        if (level[c] < m) {
          level[c] = m;
          changed = true;
        }
      }
    }
    if (!changed) return true;
  }
  return false;
  };

  // Second pass: we pull parents right down to their children. Without it a person
  // carried several rows down by a marriage leaves all of their kin at the very top
  // of the tree. We do it apart from the first pass: there the "spouses level" rule
  // raced this one and ended up putting a parent level with their own child. Here
  // the children no longer move, so there can be no race.
  //
  // But a parent pulled down is somebody's sibling: their brothers and sisters and
  // those siblings' parents must move down after them, otherwise a person ends up
  // two rows below the couple they belong beside. So the passes alternate until it
  // settles: pull down, level again, pull down again. Levels only ever grow, so
  // this converges.
  const kin = new Merge<string>();
  for (const pr of sideBySidePairs) kin.join(pr.a, pr.b);
  const clusters = kin.parts(ids);
  const pullDown = (): boolean => {
    let any = false;
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (const cluster of clusters) {
        let hi = Infinity;
        let cur = -Infinity;
        for (const m of cluster) {
          const kids = g.children[m];
          if (kids.length) hi = Math.min(hi, Math.min(...kids.map((c) => level[c])) - 1);
          cur = Math.max(cur, level[m]);
        }
        if (!Number.isFinite(hi) || hi <= cur) continue;
        for (const m of cluster) {
          if (level[m] < hi) {
            level[m] = hi;
            moved = true;
            any = true;
          }
        }
      }
      if (!moved) break;
    }
    return any;
  };

  const settle = (siblings: boolean): boolean => {
    for (const id of ids) level[id] = 0;
    if (!relax(siblings)) return false;
    for (let round = 0; round < guard; round++) {
      if (!pullDown()) return true;
      if (!relax(siblings)) return false;
    }
    return false;
  };
  if (!settle(true)) settle(false);

  alignIslandsByYear(state, level);

  // after the pulling, empty rows may be left at the top — we remove them
  const used = [...new Set(ids.map((id) => level[id]))].sort((a, b) => a - b);
  const packed = new Map(used.map((v, i) => [v, i]));
  for (const id of ids) level[id] = packed.get(level[id]) as number;
  return level;
}

/** This many years are counted between generations when a row has nothing to compare with. */
const YEARS_PER_ROW = 28;

/**
 * An island — a piece of the tree not linked to the main one by a single link —
 * starts from the top row on its own: its eldest has no parents, so they are "at
 * the head". That is how a grandchild born in 2020 ended up in the same row as the
 * great-grandparents. So we shift each island as a whole by as many rows as it
 * takes for its people's years of birth to fall on the years of the corresponding
 * rows of the main tree. The main one is the largest piece; a row's year is the
 * median of the years of birth of its people in that row, and for empty rows it is
 * taken from the neighbours in steps of YEARS_PER_ROW. An island without a single
 * date stays where it was.
 */
function alignIslandsByYear(state: TreeState, level: Record<string, number>): void {
  const comps = components(state).filter((c) => c.length > 1);
  if (comps.length < 2) return;
  const year = (id: string): number | null => yearOfBirth(state.people[id]);
  const main = comps.reduce((a, b) => (b.length > a.length ? b : a));
  const byRow = new Map<number, number[]>();
  for (const id of main) {
    const y = year(id);
    if (y !== null) push(byRow, level[id], y);
  }
  if (byRow.size < 2) return; // nothing to compare with
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const known = new Map(rows.map((r) => [r, median(byRow.get(r)!)]));
  const yearOfRow = (r: number): number => {
    const k = known.get(r);
    if (k !== undefined) return k;
    // the nearest known row and a step of one generation
    let best = rows[0];
    for (const q of rows) if (Math.abs(q - r) < Math.abs(best - r)) best = q;
    return known.get(best)! + (r - best) * YEARS_PER_ROW;
  };

  for (const comp of comps) {
    if (comp === main) continue;
    const dated = comp.filter((id) => year(id) !== null);
    if (!dated.length) continue;
    const [lo, hi] = extent(comp, (id) => level[id]);
    let bestShift = 0;
    let bestCost = Infinity;
    // the island goes no higher than the head and no lower than the row below the main tree's last
    const maxRow = rows[rows.length - 1] + 1;
    for (let shift = -lo; shift <= maxRow - hi; shift++) {
      let cost = 0;
      for (const id of dated) cost += Math.abs((year(id) as number) - yearOfRow(level[id] + shift));
      if (cost < bestCost - 0.5) {
        bestCost = cost;
        bestShift = shift;
      }
    }
    for (const id of comp) level[id] += bestShift;
  }
}

