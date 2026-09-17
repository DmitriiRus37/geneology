import type { Lang } from "../i18n.ts";
import { birthKey, yearOfBirth } from "../model/dates.ts";
import { siblingsOf, visibleState } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { NODE_W, sizeOf, type CardLine } from "./measure.ts";
import type { Rect } from "./route.ts";
import { roundsFor, tidyTies, untangle } from "./order.ts";
import { placeComponent } from "./place.ts";
import { applyTimeline, type Timeline } from "./timeline.ts";
import { extent, Merge, push } from "../util.ts";

export interface Box {
  x: number; // the card's centre
  y: number; // the card's top
  w: number;
  h: number;
  lines: CardLine[];
}

/** A card as an obstacle to the lines. */
export const rectOf = (b: Box): Rect => ({ x1: b.x - b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y + b.h });

export interface Graph {
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
}

export interface Union {
  parents: string[];
  children: string[];
  key: string;
  first: number;
}

export interface Unions {
  list: Union[];
  byParent: Record<string, Union[]>;
  isCouple: (a: string, b: string) => boolean;
}

export interface LayoutResult {
  pos: Record<string, Box>;
  level: Record<string, number>;
  tl: Timeline | null;
  graph: Graph;
  /** where to caption the block of people without a single link */
  lonePlate: { x: number; y: number; w: number } | null;
}

const H_GAP0 = 58;
const COUPLE_GAP0 = 24;
const V_GAP0 = 124;
const COMP_GAP0 = 180;

export interface Gaps {
  h: number;
  couple: number;
  v: number;
  comp: number;
}

const gapsFor = (k: number): Gaps => ({
  h: Math.round(H_GAP0 * k),
  couple: Math.round(COUPLE_GAP0 * k),
  v: Math.round(V_GAP0 * k),
  comp: Math.round(COMP_GAP0 * k),
});

export function graphOf(state: TreeState): Graph {
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(state.people)) {
    parents[id] = [];
    children[id] = [];
  }
  for (const l of state.links) {
    if (!state.people[l.parent] || !state.people[l.child]) continue;
    if (parents[l.child].indexOf(l.parent) < 0) parents[l.child].push(l.parent);
    if (children[l.parent].indexOf(l.child) < 0) children[l.parent].push(l.child);
  }
  return { parents, children };
}

/** Generation: a child is always below the "youngest" of its parents, spouses are level. */
function computeLevels(state: TreeState, g: Graph): Record<string, number> {
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

/** The connected pieces of the tree — laid out independently and spread horizontally. */
function components(state: TreeState): string[][] {
  const merge = new Merge<string>();
  for (const l of state.links) if (state.people[l.parent] && state.people[l.child]) merge.join(l.parent, l.child);
  for (const pr of [...state.pairs, ...state.sibs]) if (state.people[pr.a] && state.people[pr.b]) merge.join(pr.a, pr.b);
  const oldest = (c: string[]) => Math.min(...c.map((i) => state.people[i].n));
  return merge.parts(Object.keys(state.people)).sort((a, b) => oldest(a) - oldest(b));
}

/** A family unit: a set of parents and their shared children. A childless marriage is a unit too. */
function unions(state: TreeState, g: Graph, xhint: Record<string, number> | null): Unions {
  const srcX = (u: Union): number => {
    let s = 0;
    let n = 0;
    for (const p of u.parents) {
      if (xhint && xhint[p] !== undefined) {
        s += xhint[p];
        n++;
      }
    }
    return n ? s / n : 0;
  };

  const byKey: Record<string, Union> = {};
  for (const cid of Object.keys(state.people)) {
    const ps = g.parents[cid];
    if (!ps.length) continue;
    const key = ps.slice().sort().join("|");
    if (!byKey[key]) byKey[key] = { parents: ps.slice(), children: [], key, first: 1e9 };
    byKey[key].children.push(cid);
  }
  const list = Object.keys(byKey).map((k) => byKey[k]);

  const byParent: Record<string, Union[]> = {};
  // who stands tight together: spouses, and explicit siblings, who share the same small gap
  const pairGap: Record<string, 1> = {};
  for (const sb of state.sibs) {
    if (state.people[sb.a] && state.people[sb.b]) pairGap[[sb.a, sb.b].sort().join("|")] = 1;
  }
  for (const pr of state.pairs) {
    if (!state.people[pr.a] || !state.people[pr.b]) continue;
    const key = [pr.a, pr.b].sort().join("|");
    pairGap[key] = 1;
    if (!byKey[key]) {
      byKey[key] = { parents: [pr.a, pr.b], children: [], key, first: 1e9 };
      list.push(byKey[key]);
    }
  }

  for (const u of list) {
    // the elder to the left, and those without dates in the order they were entered
    u.children.sort((a, b) => {
      const ka = birthKey(state.people[a]);
      const kb = birthKey(state.people[b]);
      if (ka !== null && kb !== null && ka !== kb) return ka - kb;
      if (ka !== null && kb === null) return -1;
      if (ka === null && kb !== null) return 1;
      return state.people[a].n - state.people[b].n;
    });
    u.first = u.children.length ? state.people[u.children[0]].n : 1e9;
    for (const p of u.parents) (byParent[p] = byParent[p] || []).push(u);
    for (let i = 0; i < u.parents.length; i++) {
      for (let j = i + 1; j < u.parents.length; j++) {
        pairGap[[u.parents[i], u.parents[j]].sort().join("|")] = 1;
      }
    }
  }

  for (const p of Object.keys(byParent)) {
    byParent[p].sort((a, b) => {
      if (xhint) {
        // second pass: by now we know where the line will start from
        const d = srcX(a) - srcX(b);
        if (Math.abs(d) > 1) return d;
      }
      return a.first - b.first;
    });
  }

  return {
    list,
    byParent,
    isCouple: (a, b) => !!pairGap[[a, b].sort().join("|")],
  };
}

/** The order within rows: a top-down traversal, a couple and its children stay together. */
function orderRows(
  state: TreeState,
  ids: string[],
  g: Graph,
  u: Unions,
  level: Record<string, number>,
  maxLevel: number,
  /** those the traversal put in the row as a child of their own family, not as a spouse */
  asChild: Set<string>,
): string[][] {
  const rows: string[][] = [];
  for (let l = 0; l <= maxLevel; l++) rows[l] = [];
  const seen: Record<string, 1> = {};
  const inSet: Record<string, 1> = {};
  for (const id of ids) inSet[id] = 1;

  const visit = (id: string): void => {
    if (seen[id] || !inSet[id]) return;
    seen[id] = 1;
    const uns = u.byParent[id] || [];
    // Whoever has two families gets one to the left and the other to the right:
    // otherwise the lines to the children of different spouses run the same way and
    // tangle.
    if (uns.length > 1) for (const p of uns[0].parents) visit(p);
    rows[level[id]].push(id); // we take our place in our own row straight away
    // The spouse takes their place in the row first. If we went up to the parents
    // first, their other kin (the person's siblings) would take the places between
    // the spouses, the couple would sprawl across half a row and the child would
    // hang between them.
    for (const un of u.byParent[id] || []) for (const p of un.parents) visit(p);
    for (const sb of siblingsOf(state, id)) visit(sb); // explicit siblings stand next to them
    for (const p of g.parents[id]) visit(p); // the other half's family stands above them
    for (const un of u.byParent[id] || []) {
      for (const c of un.children) {
        if (!seen[c]) asChild.add(c);
        visit(c);
      }
    }
  };

  ids
    .filter((id) => !g.parents[id].length)
    .sort((a, b) => state.people[a].n - state.people[b].n)
    .forEach(visit);
  ids.slice().sort((a, b) => state.people[a].n - state.people[b].n).forEach(visit);
  return rows;
}

export function layout(full: TreeState, lang: Lang = "ru"): LayoutResult {
  const state = visibleState(full); // as far as the layout is concerned, the hidden do not exist
  const gaps = gapsFor(state.gap || 1);
  const g = graphOf(state);
  const level = computeLevels(state, g);
  const pos: Record<string, Box> = {};
  const ids = Object.keys(state.people);

  let maxLevel = 0;
  for (const id of ids) {
    const s = sizeOf(state.people[id], lang);
    pos[id] = { x: 0, y: 0, w: NODE_W, h: s.h, lines: s.lines };
    if (level[id] > maxLevel) maxLevel = level[id];
  }

  // row heights and their Y
  const rowH: number[] = [];
  const rowY: number[] = [];
  for (let l = 0; l <= maxLevel; l++) rowH[l] = 46;
  for (const id of ids) if (pos[id].h > rowH[level[id]]) rowH[level[id]] = pos[id].h;
  let y = 0;
  for (let l = 0; l <= maxLevel; l++) {
    rowY[l] = y;
    y += rowH[l] + gaps.v;
  }

  // Anyone not yet tied by a "parent - child" link must not stretch the canvas:
  // such people used to drift thousands of pixels past the tree's right edge. We
  // put them in a separate block below the tree — both the lone ones and the
  // spouses not yet placed anywhere.
  const tied = new Set<string>();
  for (const l of state.links) {
    if (state.people[l.parent] && state.people[l.child]) {
      tied.add(l.parent);
      tied.add(l.child);
    }
  }
  const comps = components(state);
  const rooted = comps.filter((c) => c.some((id) => tied.has(id)));
  const loose = comps
    .filter((c) => !c.some((id) => tied.has(id)))
    .map((c) => c.slice().sort((a, b) => state.people[a].n - state.people[b].n));

  // Who came into the row as a child of their own family: this decides which family
  // the "child + spouse" pair belongs to when both of them have parents.
  const asChild = new Set<string>();
  const orderAll = (u: Unions): string[][][] => {
    asChild.clear();
    return rooted.map((compIds) =>
      orderRows(state, compIds, g, u, level, maxLevel, asChild).map((row) => tidyTies(row, u)),
    );
  };

  /** Placement along x for an already known row order; it does not depend on the previous x. */
  const placeRows = (u: Unions, rowsByComp: string[][][]): void => {
    let offset = 0;
    rooted.forEach((compIds, ci) => {
      const xs = placeComponent(rowsByComp[ci], { g, u, level, asChild, gaps });
      let [minX, maxX] = extent(compIds, (id) => xs[id] ?? 0);
      minX -= NODE_W / 2;
      maxX += NODE_W / 2;
      if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = 0;
      }
      for (const id of compIds) pos[id].x = (xs[id] ?? 0) - minX + offset;
      offset += maxX - minX + gaps.comp;
    });
  };

  let u = unions(state, g, null);
  placeRows(u, orderAll(u));
  const xhint: Record<string, number> = {};
  for (const id of Object.keys(pos)) xhint[id] = pos[id].x;
  u = unions(state, g, xhint); // the second pass already knows where the lines will start
  const rows = orderAll(u);
  placeRows(u, rows);

  for (const id of ids) pos[id].y = rowY[level[id]] + (rowH[level[id]] - pos[id].h) / 2;

  /** The block of the unplaced below the tree; it depends on where the tree ended. */
  let lonePlate: { x: number; y: number; w: number } | null = null;
  const placeLoose = (): void => {
    lonePlate = null;
    if (!loose.length) return;
    let x1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const c of rooted) {
      for (const id of c) {
        x1 = Math.min(x1, pos[id].x - pos[id].w / 2);
        x2 = Math.max(x2, pos[id].x + pos[id].w / 2);
        y2 = Math.max(y2, pos[id].y + pos[id].h);
      }
    }
    if (x1 === Infinity) {
      x1 = 0;
      x2 = NODE_W * 4 + gaps.h * 3;
      y2 = -gaps.v;
    }
    const wide = Math.max(x2 - x1, NODE_W * 3 + gaps.h * 2);
    const top = y2 + gaps.v;
    let cx = x1;
    let cy = top + 26;
    let tall = 0;
    for (const comp of loose) {
      // we do not break a couple across a line
      const need = comp.length * NODE_W + (comp.length - 1) * gaps.couple;
      if (cx > x1 && cx + need > x1 + wide) {
        cx = x1;
        cy += tall + gaps.v / 2;
        tall = 0;
      }
      comp.forEach((id, i) => {
        if (i) cx += gaps.couple;
        pos[id].x = cx + NODE_W / 2;
        pos[id].y = cy;
        tall = Math.max(tall, pos[id].h);
        cx += NODE_W;
      });
      cx += gaps.h;
    }
    lonePlate = { x: x1, y: top, w: wide };
  };

  // The traversal order leaves lines crossing: one family's descent falls inside
  // the span of another's bus. We reorder people within the rows and keep the order
  // with the fewest crossings — counting them on the picture the user will actually
  // see: by years the cards stand differently than by generations.
  const rootedIds = rooted.flat();
  const posRooted: Record<string, Box> = {};
  for (const id of rootedIds) posRooted[id] = pos[id];
  const view = (): Record<string, Box> => {
    if (!state.timeline) return posRooted; // the unplaced have not been positioned yet
    placeLoose();
    const copy: Record<string, Box> = {};
    for (const id of ids) copy[id] = { ...pos[id] };
    applyTimeline(state, g, level, copy, gaps);
    return copy;
  };
  const [gx1, gx2] = extent(rootedIds, (id) => pos[id].x);
  const genWidth = rootedIds.length ? gx2 - gx1 : 0;
  const placeBy = (r: string[][][]) => placeRows(u, r);
  const rounds = roundsFor(ids.length);
  // By years we first look for an order that is good by generations: it is often
  // better than the original there too, and the scoring by years will decide for
  // itself whether to take it as a starting point.
  const starts: string[][][][] = [];
  if (state.timeline && rounds > 0) {
    starts.push(
      untangle(state, g, u, level, rows, pos, rootedIds, { place: placeBy, view: () => posRooted, widthFloor: genWidth, strictAlign: true }, rounds),
    );
  }
  placeRows(
    u,
    untangle(
      state, g, u, level, rows, pos, rootedIds,
      { place: placeBy, view, widthFloor: genWidth, strictAlign: !state.timeline },
      rounds,
      starts,
    ),
  );

  placeLoose();

  let tl: Timeline | null = null;
  if (state.timeline) tl = applyTimeline(state, g, level, pos, gaps);

  // cards pinned by dragging stand where they were left
  for (const id of ids) {
    const p = state.people[id];
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      pos[id].x = p.fx;
      pos[id].y = p.fy;
    }
  }

  return { pos, level, tl, graph: g, lonePlate: state.timeline ? null : lonePlate };
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
}

export function bboxOf(pos: Record<string, Box>): BBox | null {
  const ids = Object.keys(pos);
  if (!ids.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const id of ids) {
    const b = pos[id];
    x1 = Math.min(x1, b.x - b.w / 2);
    x2 = Math.max(x2, b.x + b.w / 2);
    y1 = Math.min(y1, b.y);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}
