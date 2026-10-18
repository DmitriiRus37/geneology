import type { TreeState } from "../model/types.ts";
import { extent, Merge } from "../util.ts";
import { bracketY, leftRight, sideBySide } from "./couple.ts";
import { detour, STUB, type Heading, type Run } from "./detour.ts";
import { lineFamilies, type LineFamily } from "./families.ts";
import { rectOf, type Box } from "./layout.ts";
import { CLEAR, hitsCard, polyPath, route, type Pt, type Rect } from "./route.ts";

/** Which link a line answers for — the list of what can be removed is built from it. */
export type EdgeRef =
  | { kind: "child"; parents: string[]; child: string }
  | { kind: "leg"; parent: string; children: string[] }
  | { kind: "couple"; a: string; b: string; children: string[] }
  | { kind: "sibling"; a: string; b: string };

export type EdgeItem =
  | { kind: "path"; d: string; hot: boolean; arrow: boolean; ref?: EdgeRef; pts: Pt[]; dashed?: boolean }
  | { kind: "joint"; x: number; y: number; hot: boolean };

type PathItem = Extract<EdgeItem, { kind: "path" }>;

/** A line `route` drew, and what a detour for it would need to know. */
interface Routed {
  item: PathItem;
  /** the family it belongs to; -1 for a sibling line */
  gi: number;
  /** the cards it belongs to: it touches them at its ends */
  own: Rect[];
  leave: Heading;
  arrive: Heading;
}

interface Vert {
  x: number;
  y1: number;
  y2: number;
  gi: number;
}

/** Where a horizontal at height y crosses the verticals of other families. */
function crossAt(xa: number, xb: number, y: number, gi: number, verts: Vert[]): number[] {
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  const out: number[] = [];
  for (const v of verts) {
    if (v.gi === gi) continue;
    const v1 = Math.min(v.y1, v.y2);
    const v2 = Math.max(v.y1, v.y2);
    if (y <= v1 + 2 || y >= v2 - 2) continue;
    if (v.x <= lo + 6 || v.x >= hi - 6) continue;
    out.push(v.x);
  }
  return out;
}

/** The crossings of every horizontal of a path with the verticals of other families. */
function crossAll(pts: Pt[], gi: number, verts: Vert[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i].y - pts[i - 1].y) < 0.01) out.push(...crossAt(pts[i - 1].x, pts[i].x, pts[i].y, gi, verts));
  }
  return out;
}

/**
 * A second look at every line `route` drew. One that runs into a card — by years it
 * can: the cards stand at every height there, a family's own cards among them — is
 * searched for again over the grid (detour.ts), keeping off the lines of the other
 * families as best it can. `fam` is the family of every item of `out`, -1 for none.
 */
function keepOffCards(routed: Routed[], out: EdgeItem[], fam: number[], cards: Rect[], verts: Vert[]): void {
  for (const r of routed) {
    const { item } = r;
    if (item.pts.length < 2 || !hitsCard(item.pts, cards)) continue;
    const lines: Run[] = [];
    out.forEach((it, k) => {
      if (it.kind !== "path" || it === item || it.dashed || (r.gi >= 0 && fam[k] === r.gi)) return;
      for (let i = 1; i < it.pts.length; i++) {
        lines.push({ x1: it.pts[i - 1].x, y1: it.pts[i - 1].y, x2: it.pts[i].x, y2: it.pts[i].y });
      }
    });
    const found = detour(item.pts[0], r.leave, item.pts[item.pts.length - 1], r.arrive, cards, r.own, lines);
    if (!found) continue;
    item.pts = found;
    item.d = item.dashed ? polyPath(found) : polyPath(found, crossAll(found, r.gi, verts));
  }
}

/**
 * Whether no line can leave a joint at (x, y): it lies inside a card, deeper than the
 * crossing check lets a line go, or a card begins right under it, too close for the
 * line to the children to go down.
 */
const boxedIn = (x: number, y: number, cards: Rect[]): boolean =>
  cards.some((o) => x > o.x1 + 1.5 && x < o.x2 - 1.5 && y > o.y1 - STUB && y < o.y2 - 1.5);

interface Geo {
  gi: number;
  ps: string[];
  cs: string[];
  hot: boolean;
  bracket: { x1: number; x2: number; y: number } | null;
  jx: number;
  jy: number;
  sx: number;
  sy: number;
  barY: number;
  flatY: number;
  /** the band the bus may stand in: the bottom of the parents and the top of the children */
  bandLo: number;
  bandHi: number;
}

/** The buses of different families must not merge: we keep them no closer than this in height. */
const BUS_APART = 15;
/**
 * An arrow from the bus to a child is never shorter than this: with a small space
 * between rows a quarter of the gap gave 18 px including the head — "arrows far too
 * short".
 */
const MIN_ARROW = 26;
/** The bus stands this share of the gap between the rows above the children (no closer than MIN_ARROW). */
const BUS_SHARE = 0.24;
/** A childless couple's line runs this far below the lower of the two cards. */
const FLAT_DROP = 22;
/** A start this close to the child's x drops straight onto the child instead. */
const SNAP = 18;
/** An arrow stops this far above the child's card. */
const ARROW_GAP = 3;
/** A dashed sibling arc rises this far above the higher of the two cards. */
const ARC_RISE = 14;
/** Up to this many overlapping buses, every packing order is tried. */
const MAX_PERMUTED = 6;

/**
 * Pass 1 for one family: where its source, joint and bus stand. The verticals of a
 * childless couple go straight into `verts`; the others are collected once the
 * buses are spread apart.
 */
function familyGeometry(
  fam: LineFamily,
  gi: number,
  pos: Record<string, Box>,
  level: Record<string, number>,
  selected: string | null,
  verts: Vert[],
): Geo {
  const ps = fam.parents;
  const cs = fam.children;
  const hot = !!selected && (cs.indexOf(selected) > -1 || ps.indexOf(selected) > -1);
  let bottom = -1e9;
  let top = 1e9;
  let jx = 0;
  for (const p of ps) {
    bottom = Math.max(bottom, pos[p].y + pos[p].h);
    jx += pos[p].x;
  }
  jx /= ps.length;

  let bracket: Geo["bracket"] = null;
  if (ps.length === 2 && sideBySide(pos, level, ps[0], ps[1])) {
    const [L, R] = leftRight(pos[ps[0]], pos[ps[1]]);
    bracket = { x1: L.x + L.w / 2, x2: R.x - R.w / 2, y: bracketY(L, R) };
    jx = (bracket.x1 + bracket.x2) / 2;
  }

  const G: Geo = { gi, ps, cs, hot, bracket, jx, jy: 0, sx: 0, sy: 0, barY: 0, flatY: 0, bandLo: 0, bandHi: 0 };

  if (cs.length) {
    for (const c of cs) top = Math.min(top, pos[c].y);
    const span = top - bottom;
    let barY = top - Math.max(MIN_ARROW, span * BUS_SHARE);
    if (barY < bottom + 10) barY = bottom + Math.max(6, span * 0.45);
    G.barY = barY;
    G.bandLo = bottom + 6;
    G.bandHi = top - 6;
    if (bracket) {
      G.sx = jx;
      G.sy = bracket.y;
    } else {
      let jy = bottom + Math.max(8, Math.min(22, span * 0.3));
      if (jy > barY - 4) jy = Math.max(bottom + 4, barY - 4);
      G.jy = jy;
      if (ps.length > 1) {
        G.sx = jx;
        G.sy = jy;
      } else {
        G.sx = pos[ps[0]].x;
        G.sy = pos[ps[0]].y + pos[ps[0]].h;
      }
    }
  } else if (!bracket && ps.length === 2) {
    G.flatY = bottom + FLAT_DROP;
    for (const pid of ps) verts.push({ x: pos[pid].x, y1: pos[pid].y + pos[pid].h, y2: G.flatY, gi });
  }
  return G;
}

/** Spreads apart the buses of families that overlap horizontally; `cards` are every card as an obstacle. */
function spreadBuses(geo: Geo[], pos: Record<string, Box>, cards: Rect[]): void {
  // The buses of families that overlap horizontally are spread apart in height.
  // The height used to be taken from the remainder of the family number — adjacent
  // ones still ended up flush and lines from different parents merged into one.
  //
  // The band a bus may stand in is computed over every card under its span, with
  // the same CLEAR clearance the routing keeps: otherwise route() would shift the
  // crossbar itself afterwards and the separated buses would converge again.
  //
  // Which one lies above and which below is not a matter of indifference: if one
  // family's source falls inside another's bus span, its bus belongs above the other
  // (otherwise the descent from the parents cuts the other bus), and if a descent to
  // someone else's child falls inside the span — below. So we go round an obstacle
  // both downwards and upwards, whichever is cheaper on crossings, and the order of
  // packing within each group of overlapping buses is chosen by enumeration. On a
  // tie the old behaviour stands: downwards, and in order of natural height.
  const spanOf = (G: Geo): [number, number] => {
    const xs = [G.sx, ...G.cs.map((c) => pos[c].x)];
    return [Math.min(...xs), Math.max(...xs)];
  };
  const bandOf = (G: Geo): [number, number] => {
    const [x1, x2] = spanOf(G);
    let lo = -Infinity;
    let hi = Infinity;
    for (const r of cards) {
      if (r.x2 <= x1 + 0.5 || r.x1 >= x2 - 0.5) continue;
      if (r.y2 <= G.barY) lo = Math.max(lo, r.y2 + CLEAR + 1);
      else if (r.y1 >= G.barY) hi = Math.min(hi, r.y1 - CLEAR - 1);
    }
    if (!Number.isFinite(lo)) lo = G.bandLo;
    if (!Number.isFinite(hi)) hi = G.bandHi;
    return lo <= hi ? [lo, hi] : [G.bandLo, G.bandHi];
  };
  /** A family's verticals with the bus at height y: the source (or the legs to the node) and the descents to the children. */
  const vertsAt = (F: Geo, y: number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    if (F.bracket || F.ps.length === 1) out.push([F.sx, F.sy, y]);
    else {
      const jy = Math.min(F.jy, y - 4);
      for (const pid of F.ps) out.push([pos[pid].x, pos[pid].y + pos[pid].h, jy]);
      out.push([F.sx, jy, y]);
    }
    for (const c of F.cs) out.push([pos[c].x, y, pos[c].y - ARROW_GAP]);
    return out;
  };
  const cut = (x1: number, x2: number, y: number, v: [number, number, number]): boolean =>
    v[0] > x1 + 2 && v[0] < x2 - 2 && y > Math.min(v[1], v[2]) + 2 && y < Math.max(v[1], v[2]) - 2;
  type Laid = { G: Geo; y: number; x1: number; x2: number };
  /** How many times bus G at height y and the already packed buses cut each other's verticals. */
  const tanglesWith = (G: Geo, y: number, laid: Laid[]): number => {
    const [x1, x2] = spanOf(G);
    const mine = vertsAt(G, y);
    let n = 0;
    for (const o of laid) {
      for (const v of vertsAt(o.G, o.y)) if (cut(x1, x2, y, v)) n++;
      for (const v of mine) if (cut(o.x1, o.x2, o.y, v)) n++;
    }
    return n;
  };
  const bands = new Map<Geo, [number, number]>();
  /**
   * A height for G given the buses already packed. The candidates are the natural
   * height and BUS_APART above and below every packed bus that G overlaps along x;
   * we take the free one with the fewest crossings. On a tie: the natural height,
   * then the nearest to it, then the lower one (that is how the old packing
   * behaved). Once the band runs out — up to the parents: better that than stuck
   * together.
   */
  const settle = (G: Geo, laid: Laid[]): number => {
    const [x1, x2] = spanOf(G);
    const [lo, hi] = bands.get(G)!;
    const natural = Math.max(lo, Math.min(G.barY, hi));
    const near = laid.filter((o) => o.x2 > x1 - 10 && o.x1 < x2 + 10);
    const free = (y: number) => y >= lo && y <= hi && !near.some((o) => Math.abs(o.y - y) < BUS_APART);
    const cands = [natural];
    for (const o of near) cands.push(o.y - BUS_APART, o.y + BUS_APART);
    let best: number | null = null;
    let bestCost = Infinity;
    for (const y of cands) {
      if (!free(y)) continue;
      const cost = tanglesWith(G, y, laid);
      if (best === null || cost < bestCost) {
        best = y;
        bestCost = cost;
        continue;
      }
      if (cost > bestCost) continue;
      const dNew = Math.abs(y - natural);
      const dOld = Math.abs(best - natural);
      if (dNew < dOld - 0.5 || (Math.abs(dNew - dOld) <= 0.5 && y > best)) best = y;
    }
    return best ?? lo;
  };
  const layOut = (order: Geo[]): Laid[] => {
    const laid: Laid[] = [];
    for (const G of order) {
      const [x1, x2] = spanOf(G);
      laid.push({ G, y: settle(G, laid), x1, x2 });
    }
    return laid;
  };
  const tangles = (laid: Laid[]): number => {
    let n = 0;
    for (let i = 0; i < laid.length; i++) n += tanglesWith(laid[i].G, laid[i].y, laid.slice(0, i));
    return n;
  };
  const permutations = <T,>(items: T[]): T[][] => {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    items.forEach((it, i) => {
      for (const rest of permutations(items.filter((_, k) => k !== i))) out.push([it, ...rest]);
    });
    return out;
  };

  const withKids = geo.filter((g) => g.cs.length).sort((a, b) => a.barY - b.barY);
  for (const G of withKids) bands.set(G, bandOf(G));
  // groups: overlapping along x and close in natural height
  const overlap = new Merge<Geo>();
  for (let i = 0; i < withKids.length; i++) {
    const [a1, a2] = spanOf(withKids[i]);
    for (let j = i + 1; j < withKids.length; j++) {
      const [b1, b2] = spanOf(withKids[j]);
      if (b2 > a1 - 10 && b1 < a2 + 10 && Math.abs(withKids[i].barY - withKids[j].barY) < BUS_APART * 3) {
        overlap.join(withKids[i], withKids[j]);
      }
    }
  }
  for (const members of overlap.parts(withKids)) {
    let best = layOut(members);
    if (members.length >= 2 && members.length <= MAX_PERMUTED) {
      let bestCost = tangles(best);
      for (const perm of permutations(members)) {
        if (bestCost === 0) break;
        const laid = layOut(perm);
        const cost = tangles(laid);
        if (cost < bestCost) {
          best = laid;
          bestCost = cost;
        }
      }
    }
    for (const { G, y } of best) {
      G.barY = y;
      if (!G.bracket && G.jy > G.barY - 4) G.jy = Math.max(G.bandLo - 2, G.barY - 4);
    }
  }
}

/**
 * By years the joint of a family, halfway between parents who may stand far apart
 * and at different heights, can land on somebody else's card or right on top of
 * one, and then every line of the family runs into that card. It moves to the
 * nearest place clear of the cards, with room below it for the line down:
 * sideways between the parents first, then up or down between their bottom and the
 * bus. By generations the joint lies in the space between rows and never moves.
 */
function freeJoint(G: Geo, pos: Record<string, Box>, cards: Rect[]): void {
  if (G.bracket || G.ps.length < 2 || !G.cs.length || !boxedIn(G.jx, G.jy, cards)) return;
  const [xlo, xhi] = extent(G.ps, (p) => pos[p].x);
  const ylo = Math.min(G.jy, G.bandLo - 2);
  const yhi = Math.max(G.jy, G.barY - 4);
  const xs = [G.jx];
  const ys = [G.jy];
  for (const o of cards) {
    xs.push(o.x1 - CLEAR - 2, o.x2 + CLEAR + 2);
    ys.push(o.y1 - STUB - CLEAR - 2, o.y2 + CLEAR + 2);
  }
  const clear = (x: number, y: number) =>
    !cards.some((o) => x > o.x1 - CLEAR && x < o.x2 + CLEAR && y > o.y1 - STUB - CLEAR && y < o.y2 + CLEAR);
  let best: Pt | null = null;
  let bestCost = Infinity;
  for (const x of xs) {
    if (x < xlo || x > xhi) continue;
    for (const y of ys) {
      if (y < ylo || y > yhi || !clear(x, y)) continue;
      const cost = Math.abs(x - G.jx) + 2 * Math.abs(y - G.jy);
      if (cost < bestCost) {
        bestCost = cost;
        best = { x, y };
      }
    }
  }
  if (!best) return;
  G.jx = G.sx = best.x;
  G.jy = G.sy = best.y;
}

/**
 * Pass 2 for one family: its lines, with bridges where they cross the verticals of
 * other families. `others` are the x of every vertical, kept clear of while going
 * round the cards.
 */
function drawFamily(
  G: Geo,
  pos: Record<string, Box>,
  cards: { id: string; r: Rect }[],
  verts: Vert[],
  others: number[],
  out: EdgeItem[],
  routed: Routed[],
): void {
  // every card is an obstacle; each line excludes its own two ends
  const obsExcept = (ids: string[]): Rect[] => cards.filter((c) => ids.indexOf(c.id) < 0).map((c) => c.r);
  const rectsOf = (ids: string[]): Rect[] => cards.filter((c) => ids.indexOf(c.id) > -1).map((c) => c.r);
  /** The line goes out, and on the list for a second look. */
  const emit = (item: PathItem, own: string[], leave: Heading, arrive: Heading) => {
    out.push(item);
    routed.push({ item, gi: G.gi, own: rectsOf(own), leave, arrive });
  };
  const { gi, ps, cs, hot } = G;
  if (G.bracket) {
    const bp: Pt[] = [
      { x: G.bracket.x1, y: G.bracket.y },
      { x: G.bracket.x2, y: G.bracket.y },
    ];
    out.push({
      kind: "path",
      hot,
      arrow: false,
      ref: { kind: "couple", a: ps[0], b: ps[1], children: cs },
      pts: bp,
      d: polyPath(bp, crossAt(G.bracket.x1, G.bracket.x2, G.bracket.y, gi, verts)),
    });
  }
  if (!cs.length) {
    if (!G.bracket && ps.length === 2) {
      const fp = route(
        pos[ps[0]].x, pos[ps[0]].y + pos[ps[0]].h,
        pos[ps[1]].x, pos[ps[1]].y + pos[ps[1]].h,
        G.flatY,
        obsExcept(ps),
        false,
        // the crossbar must pass under both cards, not through them
        Math.max(pos[ps[0]].y + pos[ps[0]].h, pos[ps[1]].y + pos[ps[1]].h) + 4,
      );
      emit(
        {
          kind: "path",
          hot,
          arrow: false,
          ref: { kind: "couple", a: ps[0], b: ps[1], children: cs },
          pts: fp,
          d: polyPath(fp, crossAt(pos[ps[0]].x, pos[ps[1]].x, G.flatY, gi, verts)),
        },
        ps, 1, -1,
      );
    }
    return;
  }
  if (!G.bracket && ps.length > 1) {
    for (const pid of ps) {
      const p = pos[pid];
      const lp = route(p.x, p.y + p.h, G.jx, G.jy, G.jy, obsExcept(ps), false, p.y + p.h + 2);
      emit(
        {
          kind: "path",
          hot,
          arrow: false,
          ref: { kind: "leg", parent: pid, children: cs },
          pts: lp,
          d: polyPath(lp, crossAt(p.x, G.jx, G.jy, gi, verts)),
        },
        ps, 1, 0,
      );
    }
    out.push({ kind: "joint", x: G.jx, y: G.jy, hot });
  }
  for (const cid of cs) {
    const c = pos[cid];
    // a shift of a couple of pixels gave an ugly slope — we drop the line exactly
    // onto the child. But only if the start does not slide under somebody else's
    // card in the process.
    const obs = obsExcept(ps.concat([cid]));
    // we check the obstacles over every card, the parents' included: the start of
    // the line must not slide under those either
    const roomBelow = !cards.some(
      ({ r: o }) => c.x > o.x1 - 2 && c.x < o.x2 + 2 && G.sy > o.y1 - 2 && G.sy < o.y2 + 2,
    );
    const sx = Math.abs(G.sx - c.x) < SNAP && roomBelow ? c.x : G.sx;
    const cp = route(sx, G.sy, c.x, c.y - ARROW_GAP, G.barY, obs, true, undefined, others);
    emit(
      {
        kind: "path",
        hot,
        arrow: true,
        ref: { kind: "child", parents: ps, child: cid },
        pts: cp,
        d: polyPath(cp, crossAt(G.sx, c.x, G.barY, gi, verts)),
      },
      ps.concat([cid]), 1, 1,
    );
  }
}

/**
 * An explicit "brother/sister" kinship is a dashed line between the cards. Side
 * by side — at the middle height, like a couple's bracket; far apart — as an arc
 * above the row.
 */
function siblingLines(
  state: TreeState,
  pos: Record<string, Box>,
  level: Record<string, number>,
  selected: string | null,
  cards: { id: string; r: Rect }[],
  out: EdgeItem[],
  routed: Routed[],
): void {
  const own = (a: string, b: string): Rect[] => cards.filter((c) => c.id === a || c.id === b).map((c) => c.r);
  for (const sb of state.sibs || []) {
    if (!pos[sb.a] || !pos[sb.b]) continue;
    const [L, R] = leftRight(pos[sb.a], pos[sb.b]);
    const hot = selected === sb.a || selected === sb.b;
    let pts: Pt[];
    let arc = false;
    if (sideBySide(pos, level, sb.a, sb.b)) {
      const cy = bracketY(L, R);
      pts = [{ x: L.x + L.w / 2, y: cy }, { x: R.x - R.w / 2, y: cy }];
    } else {
      const y = Math.min(L.y, R.y) - ARC_RISE;
      pts = [{ x: L.x, y: L.y }, { x: L.x, y }, { x: R.x, y }, { x: R.x, y: R.y }];
      arc = true;
    }
    const item: PathItem = { kind: "path", hot, arrow: false, dashed: true, ref: { kind: "sibling", a: sb.a, b: sb.b }, pts, d: polyPath(pts) };
    out.push(item);
    // by years the two stand at different heights, and the arc can meet a card on its way
    if (arc) routed.push({ item, gi: -1, own: own(sb.a, sb.b), leave: -1, arrive: 1 });
  }
}

export function computeEdges(
  state: TreeState,
  pos: Record<string, Box>,
  level: Record<string, number>,
  selected: string | null,
): EdgeItem[] {
  const out: EdgeItem[] = [];
  const uni = lineFamilies(state, pos);
  const cards = Object.keys(pos).map((id) => ({ id, r: rectOf(pos[id]) }));
  const rects = cards.map((c) => c.r);

  const leftmost = (k: string): number => {
    const src = uni[k].children.length ? uni[k].children : uni[k].parents;
    return Math.min(...src.map((c) => pos[c].x));
  };
  const keys = Object.keys(uni).sort((a, b) => leftmost(a) - leftmost(b));
  const verts: Vert[] = [];
  const geo = keys.map((key, gi) => familyGeometry(uni[key], gi, pos, level, selected, verts));

  spreadBuses(geo, pos, rects);
  for (const G of geo) freeJoint(G, pos, rects);

  for (const G of geo) {
    if (!G.cs.length) continue;
    verts.push({ x: G.sx, y1: G.sy, y2: G.barY, gi: G.gi });
    for (const cid of G.cs) verts.push({ x: pos[cid].x, y1: G.barY, y2: pos[cid].y - ARROW_GAP, gi: G.gi });
    if (!G.bracket && G.ps.length > 1) {
      for (const pid of G.ps) verts.push({ x: pos[pid].x, y1: pos[pid].y + pos[pid].h, y2: G.jy, gi: G.gi });
    }
  }

  /** the verticals of other links: we do not hug them while going round the cards */
  const others = verts.map((v) => v.x);
  const routed: Routed[] = [];
  const fam: number[] = [];
  for (const G of geo) {
    drawFamily(G, pos, cards, verts, others, out, routed);
    while (fam.length < out.length) fam.push(G.gi);
  }
  siblingLines(state, pos, level, selected, cards, out, routed);
  while (fam.length < out.length) fam.push(-1);
  keepOffCards(routed, out, fam, rects, verts);
  return out;
}
