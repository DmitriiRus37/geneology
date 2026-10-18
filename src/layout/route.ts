/**
 * Routing orthogonal links around the cards.
 *
 * A line goes down, sideways and down again. If somebody else's card stands in its
 * way, the vertical slips into the nearest gap between the cards of that row and
 * comes back under it: the turn is made in the space between rows, where there are
 * certainly no cards.
 */

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Pt {
  x: number;
  y: number;
}

/** The clearance by which we go round a card. */
const PAD = 13;
/** A fuse: there are never more detours than this on a single link. */
const MAX_DETOURS = 6;
const HOP = 6;
const R = 9;
/** Lines this far apart no longer get in each other's way. */
const APART = 22;
/** The clearance between a line and a card: running flush against it looks bad. */
export const CLEAR = 10;

const r2 = (v: number): number => Math.round(v * 100) / 100;

/** How far column `x` is from the verticals already routed; beyond APART it no longer matters. */
const roomAround = (x: number, busy: number[]): number => Math.min(APART, ...busy.map((v) => Math.abs(v - x)));

/** The cards standing in column x over a range of heights. */
function blockers(obs: Rect[], x: number, ya: number, yb: number): Rect[] {
  const lo = Math.min(ya, yb);
  const hi = Math.max(ya, yb);
  return obs.filter((o) => x > o.x1 - PAD && x < o.x2 + PAD && o.y2 > lo + 0.5 && o.y1 < hi - 0.5);
}

/** The whole row the obstacle stands in: its top, its bottom and all its cards. */
function rowBand(obs: Rect[], hit: Rect): { top: number; bottom: number; cards: Rect[] } {
  const cards = obs.filter((o) => o.y1 < hit.y2 && o.y2 > hit.y1);
  let top = hit.y1;
  let bottom = hit.y2;
  for (const o of cards) {
    top = Math.min(top, o.y1);
    bottom = Math.max(bottom, o.y2);
  }
  return { top, bottom, cards };
}

/** The gap between the row's cards nearest to x; on a tie, the one with the cleaner approach. */
function freeXNear(cards: Rect[], x: number, busy: number[], prefer?: (nx: number) => boolean): number {
  const sorted = cards.slice().sort((a, b) => a.x1 - b.x1);
  const gaps: [number, number][] = [[-Infinity, sorted[0].x1 - PAD]];
  for (let i = 1; i < sorted.length; i++) gaps.push([sorted[i - 1].x2 + PAD, sorted[i].x1 - PAD]);
  gaps.push([sorted[sorted.length - 1].x2 + PAD, Infinity]);

  let best = x;
  let bestScore = -Infinity;
  for (const [a, b] of gaps) {
    if (b - a < 2) continue; // a line will not squeeze through a slit like that
    const near = Math.min(Math.max(x, a), b);
    const mid = Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : near;
    for (const c of [near, mid, (near + mid) / 2]) {
      if (c < a || c > b) continue;
      // the main thing is not to stick to other lines; on a tie we go nearer to x
      const score = roomAround(c, busy) * 4 - Math.abs(c - x) / 8 + (prefer && prefer(c) ? 1e6 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return best;
}

function hBlocked(obs: Rect[], xa: number, xb: number, y: number): boolean {
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  // not only through a card but flush against its edge too — we keep a clearance
  return obs.some((o) => o.y1 - CLEAR < y && o.y2 + CLEAR > y && o.x2 > lo + 0.5 && o.x1 < hi - 0.5);
}

/**
 * One corridor for the whole run: we look for a column free all the way from start
 * to finish. Then a link spanning several rows turns aside once, goes straight down
 * and comes back — instead of weaving around every row separately.
 */
function straightAround(x: number, y1: number, y2: number, obs: Rect[], busy: number[]): Pt[] | null {
  const hits = blockers(obs, x, y1, y2);
  if (hits.length < 2) return null; // a single obstacle is cheaper to go round on the spot

  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  const cands: number[] = [];
  for (const o of obs) {
    if (o.y2 <= lo || o.y1 >= hi) continue;
    cands.push(o.x1 - PAD, o.x2 + PAD);
  }
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    if (blockers(obs, c, y1, y2).length) continue;
    const score = roomAround(c, busy) * 4 - Math.abs(c - x) / 8;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best === null) return null;

  // we turn aside in the gap before the first obstacle and come back after the last
  let top = Infinity;
  let bottom = -Infinity;
  for (const o of hits) {
    top = Math.min(top, o.y1);
    bottom = Math.max(bottom, o.y2);
  }
  const down = y2 >= y1;
  const yIn = freeY(obs, x, best, down ? Math.max(top - PAD, y1) : Math.min(bottom + PAD, y1), 40);
  const yOut = freeY(obs, x, best, down ? Math.min(bottom + PAD, y2) : Math.max(top - PAD, y2), 40);
  if (down ? yIn >= yOut : yIn <= yOut) return null;
  return [{ x, y: yIn }, { x: best, y: yIn }, { x: best, y: yOut }, { x, y: yOut }, { x, y: y2 }];
}

/**
 * The height nearest to y at which a crossbar from xa to xb touches nobody. In the
 * generations mode the turns fall into the space between rows anyway, but by years
 * the cards stand in a solid mass — without this the line used to lie right on an
 * edge.
 */
function freeY(obs: Rect[], xa: number, xb: number, y: number, room: number): number {
  if (!hBlocked(obs, xa, xb, y)) return y;
  for (let step = 3; step <= room; step += 3) {
    if (!hBlocked(obs, xa, xb, y - step)) return y - step;
    if (!hBlocked(obs, xa, xb, y + step)) return y + step;
  }
  return y;
}

/** The points of a vertical run from (x,y1) to (x,y2), going round the cards. Start point excluded. */
function vPoints(x: number, y1: number, y2: number, obs: Rect[], busy: number[]): Pt[] {
  const corridor = straightAround(x, y1, y2, obs, busy);
  if (corridor) return corridor;

  const pts: Pt[] = [];
  const down = y2 >= y1;
  let cy = y1;

  for (let i = 0; i < MAX_DETOURS; i++) {
    const hits = blockers(obs, x, cy, y2);
    if (!hits.length) break;
    hits.sort((a, b) => (down ? a.y1 - b.y1 : b.y2 - a.y2));
    const band = rowBand(obs, hits[0]);
    const roomAfter = down ? band.bottom + PAD < y2 - 1 : band.top - PAD > y2 + 1;
    const nx = freeXNear(band.cards, x, busy, roomAfter ? undefined : (c) => !hBlocked(obs, c, x, y2));
    if (Math.abs(nx - x) < 1) break; // nowhere to turn aside — we run it as it is

    let yIn = down ? band.top - PAD : band.bottom + PAD;
    let yOut = down ? band.bottom + PAD : band.top - PAD;
    if (down ? yIn < cy : yIn > cy) yIn = cy; // we are inside the row already
    yIn = freeY(obs, x, nx, yIn, 40);
    if (down ? yOut >= y2 - 1 : yOut <= y2 + 1) {
      // the row ends past the target: we turn into the gap, but we always arrive at
      // our own point from above and vertically — the arrow must point down, not
      // sideways
      const approach = Math.max(6, Math.min(14, Math.abs(y2 - yIn) / 2));
      const yBack = down ? y2 - approach : y2 + approach;
      pts.push({ x, y: yIn }, { x: nx, y: yIn }, { x: nx, y: yBack }, { x, y: yBack }, { x, y: y2 });
      return pts;
    }
    yOut = freeY(obs, x, nx, yOut, 40);
    pts.push({ x, y: yIn }, { x: nx, y: yIn }, { x: nx, y: yOut }, { x, y: yOut });
    cy = yOut;
  }

  pts.push({ x, y: y2 });
  return pts;
}

/** A height for the horizontal stretch at which it crosses nobody. */
function freeMidY(
  obs: Rect[],
  x1: number,
  x2: number,
  midY: number,
  y1: number,
  y2: number,
  cap?: number,
  floor?: number,
): number {
  const ok = (y: number) =>
    (cap === undefined || y <= cap) && (floor === undefined || y >= floor) && !hBlocked(obs, x1, x2, y);
  if (ok(midY)) return midY;
  const lo = Math.min(y1, y2) + 4;
  const hi = Math.max(y1, y2) - 4;
  const span = Math.abs(y2 - y1);
  for (let step = 6; step <= span; step += 6) {
    for (const y of [midY - step, midY + step]) {
      if (y > lo && y < hi && ok(y)) return y;
    }
  }
  // there is no clean band inside the segment (a card was dragged sideways) — we
  // look nearby, allowing the link to be led above or below both of its ends
  for (let step = 6; step <= 900; step += 6) {
    for (const y of [midY - step, midY + step]) {
      if (ok(y)) return y;
    }
  }
  let fallback = midY;
  if (cap !== undefined) fallback = Math.min(fallback, cap);
  if (floor !== undefined) fallback = Math.max(fallback, floor);
  return fallback;
}

/** We drop repeats and points that lie on one straight line. */
export function tidy(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  for (let i = 1; i < out.length - 1; ) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const collinear =
      (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) ||
      (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
    if (collinear) out.splice(i, 1);
    else i++;
  }
  return out;
}

/** A polyline from parent to child: down, sideways at height midY, down. */
export function route(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  midY: number,
  obs: Rect[],
  /** the line ends at the card's top edge: it may only be approached from above */
  endsAtTop = false,
  /** below which height to keep the crossbar: the end cards are no obstacle to it */
  floor?: number,
  /** the verticals of other links — we do not hug them while going round */
  busy: number[] = [],
): Pt[] {
  if ((midY - y1) * (y2 - midY) < 0) midY = (y1 + y2) / 2; // the node was dragged above its parent
  const cap = endsAtTop ? y2 - 6 : undefined;
  if (cap !== undefined) midY = Math.min(midY, cap);
  if (floor !== undefined) midY = Math.max(midY, floor);

  if (Math.abs(x1 - x2) < 1) return tidy([{ x: x1, y: y1 }, ...vPoints(x1, y1, y2, obs, busy)]);

  const my = freeMidY(obs, x1, x2, midY, y1, y2, cap, floor);
  return tidy([
    { x: x1, y: y1 },
    ...vPoints(x1, y1, my, obs, busy),
    { x: x2, y: my },
    ...vPoints(x2, my, y2, obs, busy),
  ]);
}

/** The horizontal hops over other verticals with an arc — that way the lines do not merge. */
function hopRun(from: number, to: number, y: number, hops: number[]): string {
  let d = "";
  const dir = to > from ? 1 : -1;
  let prev = from;
  hops
    .filter((x) => (x - from) * dir > HOP + 1 && (to - x) * dir > HOP + 1)
    .sort((a, b) => (a - b) * dir)
    .forEach((x) => {
      if (Math.abs(x - prev) < HOP * 2 + 2) return;
      d +=
        " L" + r2(x - dir * HOP) + "," + r2(y) +
        " A" + HOP + " " + HOP + " 0 0 " + (dir > 0 ? 1 : 0) + " " + r2(x + dir * HOP) + "," + r2(y);
      prev = x;
    });
  return d + " L" + r2(to) + "," + r2(y);
}

/** Polyline -> SVG path: the corners are rounded, the horizontals carry bridges. */
export function polyPath(pts: Pt[], hops: number[] = []): string {
  const p = tidy(pts);
  if (p.length < 2) return "";
  let d = "M" + r2(p[0].x) + "," + r2(p[0].y);
  let pen = p[0];

  for (let i = 1; i < p.length; i++) {
    const cur = p[i];
    const next = p[i + 1];
    let rad = 0;
    let ex = cur.x;
    let ey = cur.y;
    if (next) {
      const lenIn = Math.hypot(cur.x - pen.x, cur.y - pen.y);
      const lenOut = Math.hypot(next.x - cur.x, next.y - cur.y);
      rad = Math.max(0, Math.min(R, lenIn / 2, lenOut / 2));
      ex = cur.x - Math.sign(cur.x - pen.x) * rad;
      ey = cur.y - Math.sign(cur.y - pen.y) * rad;
    }
    if (Math.abs(cur.y - pen.y) < 0.01) d += hopRun(pen.x, ex, cur.y, hops);
    else d += " L" + r2(ex) + "," + r2(ey);
    pen = { x: ex, y: ey };
    if (next) {
      const ox = Math.sign(next.x - cur.x);
      const oy = Math.sign(next.y - cur.y);
      const qx = cur.x + ox * rad;
      const qy = cur.y + oy * rad;
      d += " Q" + r2(cur.x) + "," + r2(cur.y) + " " + r2(qx) + "," + r2(qy);
      pen = { x: qx, y: qy };
    }
  }
  return d;
}

/** Whether the polyline crosses even one card. The tests need it. */
export function hitsCard(pts: Pt[], obs: Rect[], slack = 1.5): Rect | null {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) };
    const hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
    for (const o of obs) {
      if (hi.x <= o.x1 + slack || lo.x >= o.x2 - slack) continue;
      if (hi.y <= o.y1 + slack || lo.y >= o.y2 - slack) continue;
      return o;
    }
  }
  return null;
}
