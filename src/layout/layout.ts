import { visibleState } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { extent } from "../util.ts";
import { components, graphOf, unions, type Graph, type Unions } from "./families.ts";
import { computeLevels } from "./levels.ts";
import { MIN_CARD_H, NODE_W, type CardLine, type CardSizer } from "./measure.ts";
import { roundsFor, tidyTies, untangle } from "./order.ts";
import { placeComponent } from "./place.ts";
import type { Rect } from "./route.ts";
import { orderRows } from "./rows.ts";
import { applyTimeline, type Timeline } from "./timeline.ts";

export interface Box {
  x: number; // the card's centre
  y: number; // the card's top
  w: number;
  h: number;
  lines: CardLine[];
}

/** A card as an obstacle to the lines. */
export const rectOf = (b: Box): Rect => ({ x1: b.x - b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y + b.h });

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

type Plate = NonNullable<LayoutResult["lonePlate"]>;

/** Room for the caption over the block of the unplaced. */
const PLATE_CAPTION = 26;
/** The block of the unplaced is never narrower than this many cards… */
const PLATE_MIN_CARDS = 3;
/** …and is this many cards wide when there is no tree above it at all. */
const PLATE_ALONE_CARDS = 4;

/** The width of `n` cards standing a normal gap apart. */
const cardsWide = (n: number, gaps: Gaps): number => NODE_W * n + gaps.h * (n - 1);

/** Every card at the origin, with its size and lines; and the lowest row in use. */
function cardBoxes(state: TreeState, cards: CardSizer, level: Record<string, number>) {
  const pos: Record<string, Box> = {};
  let maxLevel = 0;
  for (const id of Object.keys(state.people)) {
    const s = cards(state.people[id]);
    pos[id] = { x: 0, y: 0, w: NODE_W, h: s.h, lines: s.lines };
    if (level[id] > maxLevel) maxLevel = level[id];
  }
  return { pos, maxLevel };
}

/** Row heights and their y: a row is as tall as its tallest card. */
function rowGeometry(ids: string[], pos: Record<string, Box>, level: Record<string, number>, maxLevel: number, gaps: Gaps) {
  const rowH: number[] = [];
  const rowY: number[] = [];
  for (let l = 0; l <= maxLevel; l++) rowH[l] = MIN_CARD_H;
  for (const id of ids) if (pos[id].h > rowH[level[id]]) rowH[level[id]] = pos[id].h;
  let y = 0;
  for (let l = 0; l <= maxLevel; l++) {
    rowY[l] = y;
    y += rowH[l] + gaps.v;
  }
  return { rowH, rowY };
}

/**
 * Anyone not yet tied by a "parent - child" link must not stretch the canvas: such
 * people used to drift thousands of pixels past the tree's right edge. They go into
 * a separate block below the tree — both the lone ones and the spouses not yet
 * placed anywhere. `rooted` are the pieces with at least one such link.
 */
function splitLoose(state: TreeState): { rooted: string[][]; loose: string[][] } {
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
  return { rooted, loose };
}

/** The block of the unplaced below the tree; it depends on where the tree ended. */
function placeLoose(rooted: string[][], loose: string[][], pos: Record<string, Box>, gaps: Gaps): Plate | null {
  if (!loose.length) return null;
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
    x2 = cardsWide(PLATE_ALONE_CARDS, gaps);
    y2 = -gaps.v;
  }
  const wide = Math.max(x2 - x1, cardsWide(PLATE_MIN_CARDS, gaps));
  const top = y2 + gaps.v;
  let cx = x1;
  let cy = top + PLATE_CAPTION;
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
  return { x: x1, y: top, w: wide };
}

/** Cards pinned by dragging stand where they were left. */
function keepPinned(state: TreeState, pos: Record<string, Box>): void {
  for (const id of Object.keys(state.people)) {
    const p = state.people[id];
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      pos[id].x = p.fx;
      pos[id].y = p.fy;
    }
  }
}

/** `cards` sizes a card: it measures the text and knows the language, the layout does neither. */
export function layout(full: TreeState, cards: CardSizer): LayoutResult {
  const state = visibleState(full); // as far as the layout is concerned, the hidden do not exist
  const gaps = gapsFor(state.gap || 1);
  const g = graphOf(state);
  const level = computeLevels(state, g);
  const ids = Object.keys(state.people);
  const { pos, maxLevel } = cardBoxes(state, cards, level);
  const { rowH, rowY } = rowGeometry(ids, pos, level, maxLevel, gaps);
  const { rooted, loose } = splitLoose(state);

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

  // The traversal order leaves lines crossing: one family's descent falls inside
  // the span of another's bus. We reorder people within the rows and keep the order
  // with the fewest crossings — counting them on the picture the user will actually
  // see: by years the cards stand differently than by generations.
  const rootedIds = rooted.flat();
  const posRooted: Record<string, Box> = {};
  for (const id of rootedIds) posRooted[id] = pos[id];
  const view = (): Record<string, Box> => {
    if (!state.timeline) return posRooted; // the unplaced have not been positioned yet
    placeLoose(rooted, loose, pos, gaps);
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

  const lonePlate = placeLoose(rooted, loose, pos, gaps);

  let tl: Timeline | null = null;
  if (state.timeline) tl = applyTimeline(state, g, level, pos, gaps);
  keepPinned(state, pos);

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
