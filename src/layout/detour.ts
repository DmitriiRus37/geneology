/**
 * The last resort of the line routing, for a line that `route` led into a card.
 *
 * `route` knows one shape: down, across, down, slipping round a card into the gap
 * beside it. By generations that always works, since the turns fall into the space
 * between rows where there are no cards. By years there are no such rows: the cards
 * stand at every height, the parents of one family at different ones, and a line can
 * find a card wherever it turns. Here the line is searched for instead: the cheapest
 * orthogonal path over a grid laid along the cards' edges, a clearance away from
 * them. Length, bends, crossing the lines already drawn, running alongside them and
 * coming close to a card all cost; entering a card is not allowed at all. No DOM.
 */
import { CLEAR, tidy, type Pt, type Rect } from "./route.ts";

/** How a line leaves its start or meets its end: going down, going up, or either way. */
export type Heading = 1 | -1 | 0;

/** A piece of a line already drawn: vertical (x1 = x2) or horizontal (y1 = y2). */
export interface Run {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The straight piece at an end before the first turn: an arrow needs room for its head. */
export const STUB = 14;
/** A bend costs as much as this many pixels of length. */
const BEND = 40;
/** Running closer than CLEAR to somebody else's card costs this much per grid step. */
const HUG = 120;
/** Crossing a line already drawn costs this much. */
const CROSS = 60;
/** Running alongside a line already drawn costs this much per grid step. */
const ALONGSIDE = 30;
/** Horizontals closer than this read as one bus (crossings.ts counts them); verticals closer than half of it merge. */
const APART = 12;
/** The grid lies this far from a card's edge: just outside the clearance. */
const OFF = CLEAR + 2;
/** A gap between grid lines wider than this gets a line down its middle as well. */
const CHANNEL = 24;
/** The first search looks only this far around the two ends. */
const WINDOW = 400;
/** A segment enters a card when it goes this far over the card's edge: touching is allowed. */
const SLACK = 0.5;
/** A fuse: a grid with more nodes than this is not searched. */
const MAX_NODES = 250_000;

const enters = (x1: number, y1: number, x2: number, y2: number, o: Rect, pad: number): boolean =>
  Math.max(x1, x2) > o.x1 + SLACK - pad &&
  Math.min(x1, x2) < o.x2 - SLACK + pad &&
  Math.max(y1, y2) > o.y1 + SLACK - pad &&
  Math.min(y1, y2) < o.y2 - SLACK + pad;

/** The first index whose value is above `v` (`strict`) or at least `v`; `list` sorted. */
function firstPast(list: number[], v: number, strict: boolean): number {
  let a = 0;
  let b = list.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (strict ? list[m] <= v : list[m] < v) a = m + 1;
    else b = m;
  }
  return a;
}

/** Sorted, without repeats, with the middles of wide gaps added. */
function axis(values: number[], lo: number, hi: number): number[] {
  const sorted = values.filter((v) => v >= lo && v <= hi).sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > 0.01) out.push(v);
  const withMiddles: number[] = [];
  for (let i = 0; i < out.length; i++) {
    if (i && out[i] - out[i - 1] > CHANNEL) withMiddles.push((out[i] + out[i - 1]) / 2);
    withMiddles.push(out[i]);
  }
  return withMiddles;
}

/** A run along one axis: `at` is its fixed coordinate, `lo`..`hi` its extent along the other. */
interface Span {
  at: number;
  lo: number;
  hi: number;
}

/** The spans whose `at` lies strictly between lo and hi; `spans` sorted by `at`. */
function between(spans: Span[], lo: number, hi: number): Span[] {
  let a = 0;
  let b = spans.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (spans[m].at <= lo) a = m + 1;
    else b = m;
  }
  const out: Span[] = [];
  for (let i = a; i < spans.length && spans[i].at < hi; i++) out.push(spans[i]);
  return out;
}

type Penalty = (x1: number, y1: number, x2: number, y2: number) => number;

/** What it costs a straight piece to cross and to run alongside the lines already drawn. */
function linePenalty(lines: Run[]): Penalty {
  const verticals: Span[] = [];
  const horizontals: Span[] = [];
  for (const r of lines) {
    if (Math.abs(r.x1 - r.x2) < 0.5 && Math.abs(r.y1 - r.y2) >= 0.5) {
      verticals.push({ at: r.x1, lo: Math.min(r.y1, r.y2), hi: Math.max(r.y1, r.y2) });
    } else if (Math.abs(r.y1 - r.y2) < 0.5 && Math.abs(r.x1 - r.x2) >= 0.5) {
      horizontals.push({ at: r.y1, lo: Math.min(r.x1, r.x2), hi: Math.max(r.x1, r.x2) });
    }
  }
  verticals.sort((a, b) => a.at - b.at);
  horizontals.sort((a, b) => a.at - b.at);
  return (x1, y1, x2, y2) => {
    const horizontal = Math.abs(y1 - y2) < 0.5;
    const [across, along] = horizontal ? [verticals, horizontals] : [horizontals, verticals];
    const at = horizontal ? y1 : x1;
    const lo = horizontal ? Math.min(x1, x2) : Math.min(y1, y2);
    const hi = horizontal ? Math.max(x1, x2) : Math.max(y1, y2);
    let cost = 0;
    for (const s of between(across, lo + 2, hi - 2)) if (at > s.lo + 2 && at < s.hi - 2) cost += CROSS;
    const close = horizontal ? APART : APART / 2;
    if (between(along, at - close, at + close).some((s) => s.hi > lo + 2 && s.lo < hi - 2)) cost += ALONGSIDE;
    return cost;
  };
}

/** A minimal binary heap of [cost, state]. */
class Heap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(cost: number, state: number): void {
    const a = this.items;
    a.push([cost, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The longest straight piece up to STUB from `p` in direction `dir` that enters no card. */
function stubFrom(p: Pt, dir: Heading, cards: Rect[]): number | null {
  if (!dir) return 0;
  for (const len of [STUB, STUB / 2, 4]) {
    if (!cards.some((o) => enters(p.x, p.y, p.x, p.y + dir * len, o, 0))) return len;
  }
  return null;
}

interface Ends {
  a: Pt;
  leave: Heading;
  b: Pt;
  arrive: Heading;
}

function search({ a, leave, b, arrive }: Ends, cards: Rect[], own: Rect[], penalty: Penalty, box: Rect): Pt[] | null {
  const near = cards.filter((o) => o.x2 > box.x1 && o.x1 < box.x2 && o.y2 > box.y1 && o.y1 < box.y2);
  const others = near.filter((o) => !own.includes(o));
  const sa = stubFrom(a, leave, near);
  const sb = stubFrom(b, (-arrive) as Heading, near);
  if (sa === null || sb === null) return null;
  const a1: Pt = { x: a.x, y: a.y + leave * sa };
  const b1: Pt = { x: b.x, y: b.y - arrive * sb };

  const xv = [a.x, b.x, box.x1, box.x2];
  const yv = [a1.y, b1.y, box.y1, box.y2];
  for (const o of near) {
    xv.push(o.x1 - OFF, o.x2 + OFF);
    yv.push(o.y1 - OFF, o.y2 + OFF);
  }
  const xs = axis(xv, box.x1, box.x2);
  const ys = axis(yv, box.y1, box.y2);
  const nx = xs.length;
  const ny = ys.length;
  if (nx * ny > MAX_NODES) return null;
  const at = (v: number, list: number[]) => list.findIndex((w) => Math.abs(w - v) <= 0.01);
  const ia = at(a1.x, xs);
  const ja = at(a1.y, ys);
  const ib = at(b1.x, xs);
  const jb = at(b1.y, ys);
  if (ia < 0 || ja < 0 || ib < 0 || jb < 0) return null;

  // What every step between neighbouring nodes runs into, worked out card by card
  // (the same test as `enters`): 1 — it enters a card, 2 — it comes closer than
  // CLEAR to somebody else's. Index i * ny + j: the step from (i, j) to (i + 1, j)
  // along x, or to (i, j + 1) along y.
  const alongX = new Uint8Array(nx * ny);
  const alongY = new Uint8Array(nx * ny);
  const mark = (o: Rect, pad: number, bit: number) => {
    const x1 = o.x1 + SLACK - pad;
    const x2 = o.x2 - SLACK + pad;
    const y1 = o.y1 + SLACK - pad;
    const y2 = o.y2 - SLACK + pad;
    const jIn = [firstPast(ys, y1, true), firstPast(ys, y2, false)];
    const iIn = [firstPast(xs, x1, true), firstPast(xs, x2, false)];
    for (let j = jIn[0]; j < jIn[1]; j++) {
      for (let i = Math.max(0, iIn[0] - 1); i < Math.min(nx - 1, iIn[1]); i++) alongX[i * ny + j] |= bit;
    }
    for (let i = iIn[0]; i < iIn[1]; i++) {
      for (let j = Math.max(0, jIn[0] - 1); j < Math.min(ny - 1, jIn[1]); j++) alongY[i * ny + j] |= bit;
    }
  };
  for (const o of near) mark(o, 0, 1);
  for (const o of others) mark(o, CLEAR, 2);

  /** The cost of a step between two neighbouring nodes, or null when it enters a card. */
  const step = (i1: number, j1: number, i2: number, j2: number): number | null => {
    const flags = i1 !== i2 ? alongX[Math.min(i1, i2) * ny + j1] : alongY[i1 * ny + Math.min(j1, j2)];
    if (flags & 1) return null;
    const x1 = xs[i1];
    const y1 = ys[j1];
    const x2 = xs[i2];
    const y2 = ys[j2];
    return Math.abs(x2 - x1) + Math.abs(y2 - y1) + penalty(x1, y1, x2, y2) + (flags & 2 ? HUG : 0);
  };

  // a state is a node and the way it was entered: 0 along x, 1 along y
  const N = nx * ny * 2;
  const dist = new Float64Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const heap = new Heap();
  const state = (i: number, j: number, o: number) => (i * ny + j) * 2 + o;
  const startCost = leave ? sa + penalty(a.x, a.y, a1.x, a1.y) : 0;
  for (const o of leave ? [1] : [0, 1]) {
    dist[state(ia, ja, o)] = startCost;
    heap.push(startCost, state(ia, ja, o));
  }
  const endCost = arrive ? sb + penalty(b1.x, b1.y, b.x, b.y) : 0;
  let goal = -1;
  let goalCost = Infinity;
  while (heap.size) {
    const [d, s] = heap.pop();
    if (d > dist[s] || d >= goalCost) continue;
    const o = s & 1;
    const node = s >> 1;
    const i = Math.floor(node / ny);
    const j = node % ny;
    if (i === ib && j === jb) {
      // the last piece to the end runs along y when the end has a heading
      const total = d + endCost + (arrive && o === 0 && sb > 0 ? BEND : 0);
      if (total < goalCost) {
        goalCost = total;
        goal = s;
      }
      continue;
    }
    const moves: [number, number, number][] = [
      [i - 1, j, 0],
      [i + 1, j, 0],
      [i, j - 1, 1],
      [i, j + 1, 1],
    ];
    for (const [i2, j2, o2] of moves) {
      if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
      const c = step(i, j, i2, j2);
      if (c === null) continue;
      const nd = d + c + (o2 !== o ? BEND : 0);
      const s2 = state(i2, j2, o2);
      if (nd < dist[s2]) {
        dist[s2] = nd;
        from[s2] = s;
        heap.push(nd, s2);
      }
    }
  }
  if (goal < 0) return null;

  const nodes: Pt[] = [];
  for (let s = goal; s >= 0; s = from[s]) {
    const node = s >> 1;
    nodes.push({ x: xs[Math.floor(node / ny)], y: ys[node % ny] });
  }
  nodes.reverse();
  return tidy([a, ...nodes, b]);
}

/**
 * A path from `a` to `b` that enters none of `cards`, or null when there is none.
 * `leave` and `arrive` say which way the line must go at its ends (an arrow comes
 * down onto a child from above, a line leaves a parent downwards). `own` are the
 * cards the line belongs to: it touches them at its ends, so it may run close to
 * them; it keeps its distance from the rest where it can. `lines` are the lines
 * already drawn, which it would rather not cross or run alongside.
 */
export function detour(
  a: Pt,
  leave: Heading,
  b: Pt,
  arrive: Heading,
  cards: Rect[],
  own: Rect[] = [],
  lines: Run[] = [],
): Pt[] | null {
  const ends = { a, leave, b, arrive };
  const penalty = linePenalty(lines);
  const around = (pad: number): Rect => ({
    x1: Math.min(a.x, b.x) - pad,
    y1: Math.min(a.y, b.y) - pad,
    x2: Math.max(a.x, b.x) + pad,
    y2: Math.max(a.y, b.y) + pad,
  });
  const first = search(ends, cards, own, penalty, around(WINDOW));
  if (first) return first;
  // nothing nearby: the whole picture, with room to go round it
  const whole = around(WINDOW);
  for (const o of cards) {
    whole.x1 = Math.min(whole.x1, o.x1 - WINDOW);
    whole.y1 = Math.min(whole.y1, o.y1 - WINDOW);
    whole.x2 = Math.max(whole.x2, o.x2 + WINDOW);
    whole.y2 = Math.max(whole.y2, o.y2 + WINDOW);
  }
  return search(ends, cards, own, penalty, whole);
}
