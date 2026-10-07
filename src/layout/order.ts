/**
 * The order of people within rows, for the sake of fewer crossing lines.
 *
 * One family's bus crossing another family's descent is born not of the routing
 * but of who stands after whom in the row: the descent falls inside the bus's
 * span. So it is people that are reordered here, and the lines are left alone.
 * Candidate orders come from the barycentre of kin in the neighbouring rows, but
 * each one is judged by real geometry: placed along x by the same procedure as
 * always, lines routed, the same metric counted as in tools/metrics.ts. The
 * original traversal order is always one of the candidates, so it can never come
 * out worse than that on crossings.
 *
 * What is preserved: spouses side by side (a block is indivisible, a stretched
 * couple is discarded), whoever has two families keeps one spouse to the left and
 * the other to the right (the chain is either straight or reversed), siblings by
 * seniority, an only child under its parents, no line through a card, buses no
 * closer together, and the tree no more than a tenth wider than before. No DOM.
 */
import { pairKey, type TreeState } from "../model/types.ts";
import { extent, mean, push } from "../util.ts";
import { overlapY, sideBySide } from "./couple.ts";
import { edgeStats } from "./crossings.ts";
import { computeEdges } from "./edges.ts";
import type { Graph, Unions } from "./families.ts";
import { rectOf, type Box } from "./layout.ts";

/** A block — a person with their spouses, standing in the row as one piece. */
interface Block {
  members: string[];
  /** barycentre over kin in the neighbouring row; null — no kin there, the block stays put */
  bary: number | null;
  /** where it stands right now — for a stable sort */
  cur: number;
}

type Dir = "down" | "up" | "both";

export interface Score {
  visual: number;
  crossings: number;
  width: number;
  /** only children that slid out from under their parents */
  misaligned: Set<string>;
  /** couples with a wider gap between them than they are due */
  apart: Set<string>;
  through: number;
  busNear: number;
  overlaps: number;
}

export interface UntangleDeps {
  /** place people along x for the given row orders (per component) */
  place: (rowsByComp: string[][][]) => void;
  /**
   * The cards as the user will see them: by generations it is the placement
   * itself, by years a copy of it recomputed from years of birth.
   */
  view: () => Record<string, Box>;
  /**
   * The width the tree may grow to without a second thought: by years it is
   * narrower than by generations, and measuring its growth from its own narrow
   * base would be unfair.
   */
  widthFloor: number;
  /**
   * Only children under their parents is a strict promise of the generations
   * layout: not one of the aligned may slide off. By years the alignment is
   * approximate anyway, and there it is enough that no more of them slide off.
   */
  strictAlign: boolean;
}

/** How many rounds to allow: scoring costs a whole layout, so we economise on big trees. */
export function roundsFor(people: number): number {
  if (people <= 120) return 3;
  if (people <= 300) return 1;
  return 0;
}

/** How much wider the tree may become for the sake of crossings. */
const WIDEN = 1.1;

/**
 * Returns the best row order found; on exit pos matches it.
 */
export function untangle(
  state: TreeState,
  g: Graph,
  u: Unions,
  level: Record<string, number>,
  rowsByComp: string[][][],
  pos: Record<string, Box>,
  rootedIds: string[],
  deps: UntangleDeps,
  rounds: number,
  /** further orders worth trying as a start — for example the best one by generations */
  extraStarts: string[][][][] = [],
): string[][][] {
  if (rounds <= 0 || !rootedIds.length) return rowsByComp;

  // We look only at those placed: the unplaced have no position yet.
  const rooted = new Set(rootedIds);
  // only children: they are due to stand exactly under their parents
  const onlyChildren: { child: string; parents: string[] }[] = [];
  for (const un of u.list) {
    if (un.children.length !== 1 || !rooted.has(un.children[0])) continue;
    if (!un.parents.every((p) => level[p] === level[un.children[0]] - 1)) continue;
    onlyChildren.push({ child: un.children[0], parents: un.parents });
  }
  const couples: [string, string][] = [];
  for (const un of u.list) {
    const [a, b] = un.parents;
    if (un.parents.length === 2 && level[a] === level[b] && rooted.has(a) && rooted.has(b)) couples.push([a, b]);
  }

  const evaluate = (): Score => {
    const shown = deps.view();
    const ids = Object.keys(shown);
    const rects = ids.map((id) => rectOf(shown[id]));
    const st = edgeStats(computeEdges(state, shown, level, null), rects);
    const [minX, maxX] = extent(rootedIds, (id) => shown[id].x);
    const misaligned = new Set<string>();
    for (const oc of onlyChildren) {
      const mid = mean(oc.parents.map((p) => shown[p].x)) as number;
      if (Math.abs(mid - shown[oc.child].x) > 1) misaligned.add(oc.child);
    }
    // A couple is broken when the bracket between the spouses can no longer be
    // drawn: too far apart, or someone from their row stood between them — the
    // same condition as in edges.ts, one function serving both. Spouses at
    // different heights (by years) have no bracket, so they do not count.
    const apart = new Set<string>();
    for (const [a, b] of couples) {
      if (overlapY(shown[a], shown[b]) < 20) continue;
      if (!sideBySide(shown, level, a, b)) apart.add(pairKey(a, b));
    }
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i];
        const B = rects[j];
        if (A.x1 < B.x2 - 0.5 && B.x1 < A.x2 - 0.5 && A.y1 < B.y2 - 0.5 && B.y1 < A.y2 - 0.5) overlaps++;
      }
    }
    return {
      visual: st.visual,
      crossings: st.crossings,
      width: maxX - minX,
      misaligned,
      apart,
      through: st.through,
      busNear: st.busNear,
      overlaps,
    };
  };

  // seniority: for every family, its children of one row in order of birth
  const siblingRuns: string[][] = [];
  for (const un of u.list) {
    if (un.children.length < 2) continue;
    const byLevel = new Map<number, string[]>();
    for (const c of un.children) push(byLevel, level[c], c);
    for (const run of byLevel.values()) if (run.length > 1) siblingRuns.push(run);
  }

  deps.place(rowsByComp); // pos may be left over from another order — judge the original by itself
  const base = evaluate();
  let best = { rows: rowsByComp, score: base };

  // what was in order must stay in order; what was already broken does not count
  const subset = (a: Set<string>, b: Set<string>): boolean => [...a].every((v) => b.has(v));
  const widthCap = Math.max(base.width, deps.widthFloor) * WIDEN + 1;
  const acceptable = (s: Score): boolean =>
    (deps.strictAlign ? subset(s.misaligned, base.misaligned) : s.misaligned.size <= base.misaligned.size) &&
    subset(s.apart, base.apart) &&
    s.through <= base.through &&
    s.busNear <= base.busNear &&
    s.overlaps <= base.overlaps &&
    s.width <= widthCap;
  // First what the eye sees; on a tie, the more compact; the path count last:
  // a descent through the bus of three children and through the bus of one look
  // exactly the same.
  const better = (a: Score, b: Score): boolean =>
    a.visual !== b.visual ? a.visual < b.visual
    : Math.abs(a.width - b.width) > 0.5 ? a.width < b.width
    : a.crossings < b.crossings;

  // An order found for the other picture is often good here too — we try it as a
  // starting point, but judge it by the same rules as all the rest.
  for (const start of extraStarts) {
    if (sameRows(start, best.rows)) continue;
    deps.place(start);
    const score = evaluate();
    const take = acceptable(score) && better(score, best.score);
    if (take) best = { rows: start, score };
  }

  // Each direction runs until it settles: in one pass a row is reordered by the
  // old positions of its neighbours, and a row that moved only pulls the next one
  // along on the pass after. Every intermediate order is scored too — the best may
  // well turn up halfway. A round starts from the best found so far.
  const dirs: Dir[] = ["up", "down", "both"];
  for (let round = 0; round < rounds; round++) {
    let cur = best.rows;
    deps.place(cur);
    const startedFrom = best;
    for (const dir of dirs) {
      for (let k = 0; k < 4; k++) {
        const cand = cur.map((rows) => rows.map((row) => reorderRow(row, dir, g, u, pos, siblingRuns)));
        if (sameRows(cand, cur)) break;
        deps.place(cand);
        const score = evaluate();
        const take = acceptable(score) && better(score, best.score);
        if (take) best = { rows: cand, score };
        cur = cand;
      }
    }
    if (best === startedFrom) break;
  }
  deps.place(best.rows);
  return best.rows;
}

function sameRows(a: string[][][], b: string[][][]): boolean {
  for (let c = 0; c < a.length; c++) {
    for (let r = 0; r < a[c].length; r++) {
      const x = a[c][r];
      const y = b[c][r];
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
  }
  return true;
}

/** A person's kin in the neighbouring rows, the ones the barycentre is counted over. */
function kin(id: string, dir: Dir, g: Graph): string[] {
  if (dir === "down") return g.parents[id];
  if (dir === "up") return g.children[id];
  return g.parents[id].concat(g.children[id]);
}

/**
 * Inside a block every tie (spouses, explicit siblings) must stand right next to
 * each other. The traversal gives "sister, her husband, brother" — the husband
 * between the brother and the sister. If the ties form a chain, we lay the block
 * out along it; the direction is the one that differs less from the current order.
 * Not a chain (someone has three ties) — we leave it as it is.
 */
function chainOrder(members: string[], u: Unions): string[] {
  if (members.length < 3) return members;
  const ties = new Map<string, string[]>();
  for (const a of members) ties.set(a, members.filter((b) => b !== a && u.isCouple(a, b)));
  let broken = false;
  for (let i = 1; i < members.length; i++) if (!u.isCouple(members[i - 1], members[i])) broken = true;
  if (!broken) return members; // they are all adjacent already
  if ([...ties.values()].some((t) => t.length > 2)) return members;
  const ends = members.filter((m) => ties.get(m)!.length === 1);
  if (ends.length !== 2) return members;
  const path = [ends[0]];
  while (path.length < members.length) {
    const next = ties.get(path[path.length - 1])!.find((n) => !path.includes(n));
    if (!next) return members; // not a single chain
    path.push(next);
  }
  const index = new Map(members.map((m, i) => [m, i]));
  const shift = (order: string[]) => order.reduce((s, m, i) => s + Math.abs(index.get(m)! - i), 0);
  const back = path.slice().reverse();
  return shift(back) < shift(path) ? back : path;
}

/** A row of blocks whose ties stand adjacent inside; the order of blocks is unchanged. */
export function tidyTies(row: string[], u: Unions): string[] {
  return blocksOf(row, u).flatMap((b) => b.members);
}

/** The row's blocks: spouses together, and inside them the current order. */
function blocksOf(row: string[], u: Unions): Block[] {
  const index = new Map(row.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const id of row) {
    if (seen.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const other of row) {
        if (!seen.has(other) && u.isCouple(cur, other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    members.sort((a, b) => index.get(a)! - index.get(b)!);
    out.push({ members: chainOrder(members, u), bary: null, cur: 0 });
  }
  return out;
}

function reorderRow(
  row: string[],
  dir: Dir,
  g: Graph,
  u: Unions,
  pos: Record<string, Box>,
  siblingRuns: string[][],
): string[] {
  if (row.length < 2) return row;
  const blocks = blocksOf(row, u);
  const blockOf = new Map<string, Block>();
  for (const b of blocks) {
    for (const m of b.members) blockOf.set(m, b);
    b.cur = mean(b.members.map((m) => pos[m].x)) as number;
    const xs: number[] = [];
    for (const m of b.members) for (const n of kin(m, dir, g)) xs.push(pos[n].x);
    b.bary = mean(xs);

    // A spouse stands on the side of their own kin — the kin above: the couple's
    // shared children are the same for both and suggest no side, while a
    // one-card difference over them used to flip the couple and lead it away from
    // its parents. A chain of two families allows only the straight and the
    // reversed order — that way one family stays on the left and the other on
    // the right.
    if (b.members.length > 1) {
      const first = mean(g.parents[b.members[0]].map((n) => pos[n].x));
      const last = mean(g.parents[b.members[b.members.length - 1]].map((n) => pos[n].x));
      if (first !== null && last !== null) {
        if (first > last + 0.5) b.members.reverse();
      } else if (first !== null) {
        if (first > b.cur + 0.5) b.members.reverse(); // the first one's kin is on the right — send them right
      } else if (last !== null) {
        if (last < b.cur - 0.5) b.members.reverse(); // the last one's kin is on the left — send them left
      }
    }
  }

  // Whoever has no kin in the neighbouring row stays where they are: there is
  // nothing to sort them by, and their own x against other people's barycentres
  // used to carry such blocks off to the end of the row. The rest are sorted by
  // barycentre and take the free places.
  const order: (Block | null)[] = blocks.map((b) => (b.bary === null ? b : null));
  const movable = blocks
    .filter((b) => b.bary !== null)
    .sort((a, b) => (a.bary as number) - (b.bary as number) || a.cur - b.cur);
  let k = 0;
  for (let i = 0; i < order.length; i++) if (!order[i]) order[i] = movable[k++];
  const sorted = order as Block[];

  // seniority within this row: chains of blocks that must run left to right
  const chains: Block[][] = [];
  for (const run of siblingRuns) {
    if (!blockOf.has(run[0])) continue;
    const chain: Block[] = [];
    let ok = true;
    for (const c of run) {
      const b = blockOf.get(c)!;
      if (chain[chain.length - 1] === b) continue;
      if (chain.includes(b)) {
        ok = false; // siblings in one block through a third — the order is undefined
        break;
      }
      chain.push(b);
    }
    if (ok && chain.length > 1) chains.push(chain);
  }

  return restoreSeniority(sorted, chains).flatMap((b) => b.members);
}

/**
 * Sibling blocks stay in the places the sort gave them, but are dealt out by
 * seniority. In-laws that stood between them do not go anywhere. A block with the
 * children of two families takes part in two chains — hence the repeats until it
 * settles.
 */
function restoreSeniority(order: Block[], chains: Block[][]): Block[] {
  const out = order.slice();
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const chain of chains) {
      const slots = chain.map((b) => out.indexOf(b)).sort((a, b) => a - b);
      for (let i = 0; i < chain.length; i++) {
        if (out[slots[i]] !== chain[i]) {
          out[slots[i]] = chain[i];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return out;
}
