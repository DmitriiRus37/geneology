/**
 * Counters of line quality: crossings, horizontals too close together, lines through
 * a card. One formula for the layout (it is what picks the order within rows) and
 * for `tools/metrics.ts` alike — so that the numbers never diverge.
 */
import type { EdgeItem, EdgeRef } from "./edges.ts";
import { hitsCard, type Rect } from "./route.ts";

export interface EdgeStats {
  /** "horizontal x vertical" crossings over individual paths — the way it has always been counted */
  crossings: number;
  /**
   * The same, but the paths of one family over one bus count as a single line. A
   * descent through the bus of a family of seven children is counted once, not up
   * to seven times.
   */
  visual: number;
  /** pairs of horizontals lying closer than 12 px to each other and overlapping along x */
  busNear: number;
  /** lines touching at least one card */
  through: number;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** the path's number */
  id: number;
  /** the family the line belongs to: paths over one bus are glued together by it */
  fam: string;
}

const famOf = (ref: EdgeRef | undefined): string => {
  if (!ref) return "?";
  if (ref.kind === "child") return ref.parents.slice().sort().join("|");
  if (ref.kind === "leg") return "leg:" + ref.children.slice().sort().join("|");
  return (ref.kind === "sibling" ? "sib:" : "") + [ref.a, ref.b].sort().join("|");
};

const r0 = (v: number): number => Math.round(v);

export function edgeStats(items: EdgeItem[], rects: Rect[]): EdgeStats {
  const hor: Seg[] = [];
  const ver: Seg[] = [];
  let through = 0;
  items.forEach((it, n) => {
    if (it.kind !== "path" || it.ref?.kind === "sibling") return; // the dashed kinship line does not count
    if (hitsCard(it.pts, rects)) through++;
    const fam = famOf(it.ref);
    for (let i = 1; i < it.pts.length; i++) {
      const a = it.pts[i - 1];
      const b = it.pts[i];
      const seg: Seg = {
        x1: Math.min(a.x, b.x),
        y1: Math.min(a.y, b.y),
        x2: Math.max(a.x, b.x),
        y2: Math.max(a.y, b.y),
        id: n,
        fam,
      };
      if (Math.abs(a.y - b.y) < 0.6) {
        if (Math.abs(a.x - b.x) > 12) hor.push(seg);
      } else if (Math.abs(a.x - b.x) < 0.6) ver.push(seg);
    }
  });

  let crossings = 0;
  const seen = new Set<string>();
  for (const h of hor) {
    for (const v of ver) {
      if (h.id === v.id) continue;
      if (v.x1 > h.x1 + 2 && v.x1 < h.x2 - 2 && h.y1 > v.y1 + 2 && h.y1 < v.y2 - 2) {
        crossings++;
        seen.add(h.fam + "@" + r0(h.y1) + "|" + r0(v.x1) + ":" + r0(v.y1) + "-" + r0(v.y2));
      }
    }
  }

  let busNear = 0;
  for (let i = 0; i < hor.length; i++) {
    for (let j = i + 1; j < hor.length; j++) {
      const A = hor[i];
      const B = hor[j];
      if (A.x2 < B.x1 - 10 || B.x2 < A.x1 - 10) continue;
      const d = Math.abs(A.y1 - B.y1);
      if (d > 0.1 && d < 12) busNear++;
    }
  }

  return { crossings, visual: seen.size, busNear, through };
}
