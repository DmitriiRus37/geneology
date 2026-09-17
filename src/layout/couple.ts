/**
 * The geometry of a couple standing side by side. Both the line routing (the bracket
 * between spouses, the dashed line between siblings) and the row-order scoring ("the
 * couple is not broken") use it — the conditions must agree, otherwise the layout
 * counts a couple as whole while there is nowhere left to draw the bracket.
 */
import type { Box } from "./layout.ts";
import { NODE_W } from "./measure.ts";

/** By how much two cards overlap in height. */
export const overlapY = (A: Box, B: Box): number =>
  Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);

/** The same pair, but left to right. */
export const leftRight = (A: Box, B: Box): [Box, Box] => (A.x <= B.x ? [A, B] : [B, A]);

/** The height of the bracket between two cards: the middle, but no higher and no lower than their edges. */
export function bracketY(L: Box, R: Box): number {
  const cy = (L.y + L.h / 2 + R.y + R.h / 2) / 2;
  return Math.min(Math.max(cy, Math.max(L.y, R.y) + 12), Math.min(L.y + L.h, R.y + R.h) - 12);
}

/** Whether two stand side by side: level, adjacent and with nobody between them. */
export function sideBySide(
  pos: Record<string, Box>,
  level: Record<string, number>,
  a: string,
  b: string,
): boolean {
  if (level[a] !== level[b]) return false;
  const A = pos[a];
  const B = pos[b];
  if (overlapY(A, B) < 20) return false;
  const lo = Math.min(A.x, B.x);
  const hi = Math.max(A.x, B.x);
  if (hi - lo > NODE_W * 2) return false;
  return !Object.keys(pos).some(
    (id) => id !== a && id !== b && level[id] === level[a] && pos[id].x > lo && pos[id].x < hi,
  );
}
