import { isApproxYear, yearIn, yearOfBirth } from "../model/dates.ts";
import { spousesOf } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import type { Graph } from "./families.ts";
import type { Box, Gaps } from "./layout.ts";
import { NODE_W } from "./measure.ts";
import { mean } from "../util.ts";

export interface Timeline {
  min: number;
  max: number;
  scale: number;
  /** the year was estimated from the kin rather than taken from the card */
  est: Record<string, 1>;
  year: Record<string, number>;
}

/**
 * The vertical axis by year of birth instead of by generation. Missing years are
 * pulled from the children, the parents, the siblings and the spouse, and marked as
 * an estimate.
 */
export function applyTimeline(
  state: TreeState,
  g: Graph,
  level: Record<string, number>,
  pos: Record<string, Box>,
  gaps: Gaps,
): Timeline | null {
  const ids = Object.keys(state.people);
  if (!ids.length) return null;

  const yr: Record<string, number> = {};
  const est: Record<string, 1> = {};

  for (const id of ids) {
    const y = yearOfBirth(state.people[id]);
    if (y) {
      yr[id] = y;
      if (isApproxYear(state.people[id].born)) est[id] = 1; // "197?" — the year is known only roughly
    }
  }
  for (const id of ids) {
    // only the death is known — a rough estimate
    if (yr[id] !== undefined) continue;
    const dy = yearIn(state.people[id].died);
    if (dy) {
      yr[id] = dy - 60;
      est[id] = 1;
    }
  }

  const spouses = (id: string): string[] => spousesOf(state, id, g);

  for (let it = 0; it < 10; it++) {
    let changed = false;
    for (const id of ids) {
      if (yr[id] !== undefined) continue;

      // The spouse has a real date — we stand level with them and guess no further.
      // A spouse's estimate is taken only as a last resort, below.
      const exact = spouses(id).find((s2) => yr[s2] !== undefined && !est[s2]);
      if (exact !== undefined) {
        yr[id] = yr[exact];
        est[id] = 1;
        changed = true;
        continue;
      }

      let cand: number | null = null;
      let v: number;

      const kids = g.children[id].filter((c) => yr[c] !== undefined);
      const par = g.parents[id].filter((p) => yr[p] !== undefined);
      if (kids.length) cand = Math.min(...kids.map((c) => yr[c])) - 28;
      if (par.length) {
        v = Math.max(...par.map((p) => yr[p])) + 28;
        cand = cand === null ? v : Math.round((cand + v) / 2);
      }
      const sib: number[] = [];
      for (const p of g.parents[id]) {
        for (const c of g.children[p]) if (c !== id && yr[c] !== undefined) sib.push(yr[c]);
      }
      if (sib.length) {
        v = Math.round(mean(sib) as number);
        cand = cand === null ? v : Math.round((cand + v) / 2);
      }
      if (cand === null) {
        const sp = spouses(id).filter((s2) => yr[s2] !== undefined);
        if (sp.length) cand = yr[sp[0]];
      }
      if (cand !== null) {
        yr[id] = cand;
        est[id] = 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byLevel: Record<number, number[]> = {};
  const known: number[] = [];
  for (const id of ids) {
    if (yr[id] === undefined) continue;
    (byLevel[level[id]] = byLevel[level[id]] || []).push(yr[id]);
    known.push(yr[id]);
  }
  const base = known.length ? Math.min(...known) : 1900;
  const levelYear = (l: number): number => {
    if (byLevel[l] && byLevel[l].length) {
      return Math.round(mean(byLevel[l]) as number);
    }
    for (let d = 1; d < 25; d++) {
      if (byLevel[l - d] && byLevel[l - d].length) return levelYear(l - d) + 28 * d;
      if (byLevel[l + d] && byLevel[l + d].length) return levelYear(l + d) - 28 * d;
    }
    return base + l * 28;
  };
  for (const id of ids) {
    if (yr[id] === undefined) {
      yr[id] = levelYear(level[id]);
      est[id] = 1;
    }
  }

  let minYr = Infinity;
  let maxYr = -Infinity;
  for (const id of ids) {
    if (yr[id] < minYr) minYr = yr[id];
    if (yr[id] > maxYr) maxYr = yr[id];
  }

  // we pick the scale so that the cards of neighbouring generations do not collide
  let scale = 5.5;
  if (ids.length <= 400) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (Math.abs(pos[a].x - pos[b].x) >= NODE_W + gaps.h * 0.4) continue;
        const dy = Math.abs(yr[a] - yr[b]);
        if (dy < 1) continue;
        const need = (pos[a].h + pos[b].h) / 2 + Math.max(16, gaps.v * 0.32);
        if (need / dy > scale) scale = need / dy;
      }
    }
  }
  // The ceiling is only a fuse against a truly wild picture. It used to be 14, and
  // it took away from the formula exactly what the formula was asking for: with tall
  // cards about 50 px per year are needed, otherwise neighbouring years collide.
  scale = Math.min(scale, 60);
  for (const id of ids) pos[id].y = (yr[id] - minYr) * scale - pos[id].h / 2;

  // Those born in the same year land in the same place — we spread them sideways.
  // The pass is repeated: a card that was moved may collide with the next one, and a
  // single pass did not catch that — overlaps were left, and the lines between them
  // had nowhere to pass.
  if (ids.length <= 400) {
    const need = NODE_W + gaps.h;
    const orig: Record<string, number> = {};
    for (const id of ids) orig[id] = pos[id].x;
    const order = ids.slice().sort((a, b) => pos[a].y - pos[b].y);
    for (let round = 0; round < 40; round++) {
      let moved = false;
      for (let i = 1; i < order.length; i++) {
        for (let j = 0; j < i; j++) {
          const A = pos[order[i]];
          const B = pos[order[j]];
          if (B.y + B.h + 8 <= A.y || A.y + A.h + 8 <= B.y) continue;
          if (Math.abs(A.x - B.x) >= need) continue;
          A.x = A.x >= B.x ? B.x + need : B.x - need;
          moved = true;
        }
      }
      if (!moved) break;
    }
    // The spreading may not converge: a chain of people of the same age pushes each
    // other round in a circle. A final left-to-right pass separates everyone for
    // certain — moving only to the right, in order of x, each card away from those
    // already checked.
    const byX = ids.slice().sort((a, b) => pos[a].x - pos[b].x);
    for (let i = 1; i < byX.length; i++) {
      const A = pos[byX[i]];
      for (let j = 0; j < i; j++) {
        const B = pos[byX[j]];
        if (B.y + B.h + 8 <= A.y || A.y + A.h + 8 <= B.y) continue;
        if (A.x < B.x + need) A.x = B.x + need;
      }
    }

    // Having spread them, we have broken the alignment made in the ordinary mode. We
    // put the cards back where they were, but only while that touches nobody:
    // overlaps cost more here than a vertical line. Back to their previous places
    // specifically, not "under the parents": each sibling separately was drawn to the
    // middle of the parents, and whichever of them the years allowed would stand in
    // the column of their own spouse — with that spouse's line to their children
    // running straight through them.
    /**
     * Is `id` closer than `room` to anybody it shares a height with. The spreading
     * above asks for the whole `need`, which is a card plus a full gap — that is
     * what keeps the picture readable. Putting a card back is a different question:
     * there the only thing that must hold is that nobody is touched and a line can
     * still pass between them, so it asks for `snug` instead. Judging both by the
     * full gap was what left an only child sitting a couple of dozen pixels beside
     * its parents with fifty pixels of clear air on either side.
     */
    const crowded = (id: string, room: number): boolean =>
      ids.some((other) => {
        if (other === id) return false;
        const A = pos[id];
        const B = pos[other];
        if (B.y + B.h + 8 <= A.y || A.y + A.h + 8 <= B.y) return false;
        return Math.abs(A.x - B.x) < room - 0.5;
      });

    // the same fraction of the gap this file already treats as "close enough to matter"
    const snug = NODE_W + Math.max(20, gaps.h * 0.4);

    /** Move `id` as far towards `to` as it can go without crowding anyone. */
    const easeTo = (id: string, to: number, room: number): boolean => {
      const was = pos[id].x;
      const dx = to - was;
      if (Math.abs(dx) < 1) return false;
      // The step used to be all or nothing: a card that could not come back the
      // whole way stayed exactly where the spreading had left it, and an only
      // child kept a jog in its arrow for the sake of a couple of pixels. Halving
      // a few times finds the longest part of the way that is actually free.
      let step = Math.min(Math.abs(dx), 60);
      for (let tries = 0; tries < 7 && step >= 0.5; tries++) {
        pos[id].x = was + Math.sign(dx) * step;
        if (!crowded(id, room)) return true;
        step /= 2;
      }
      pos[id].x = was;
      return false;
    };

    for (let round = 0; round < 8; round++) {
      let moved = false;
      for (const id of ids) if (easeTo(id, orig[id], need)) moved = true;
      if (!moved) break;
    }

    // An only child belongs exactly under its parents — the one promise the
    // generations layout makes and this mode kept breaking. Pulling every child
    // to the middle would be wrong (siblings would pile into one column, and the
    // one the years allowed would land in its own spouse's column), but an only
    // child has nobody to collide with by definition. Parents first: a child
    // aimed at a middle that is still about to move would only have to move again.
    for (let round = 0; round < 3; round++) {
      let moved = false;
      for (const kid of ids) {
        const ps = (g.parents[kid] ?? []).filter((p) => pos[p]);
        if (!ps.length) continue;
        if (ps.some((p) => (g.children[p] ?? []).some((c) => c !== kid && pos[c]))) continue; // not an only child
        const mid = ps.reduce((n, p) => n + pos[p].x, 0) / ps.length;
        if (easeTo(kid, mid, snug)) moved = true;
      }
      if (!moved) break;
    }
  }

  return { min: minYr, max: maxYr, scale, est, year: yr };
}
