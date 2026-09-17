/**
 * Геометрия пары, стоящей бок о бок. Ею пользуются и прокладка линий (скобка
 * между супругами, пунктир между братом и сестрой), и оценка порядка в рядах
 * («пара не разорвана») — условия должны совпадать, иначе раскладка считает
 * пару целой, а рисовать скобку уже негде.
 */
import type { Box } from "./layout.ts";
import { NODE_W } from "./measure.ts";

/** Насколько две карточки перекрываются по высоте. */
export const overlapY = (A: Box, B: Box): number =>
  Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);

/** Та же двойка, но слева направо. */
export const leftRight = (A: Box, B: Box): [Box, Box] => (A.x <= B.x ? [A, B] : [B, A]);

/** Высота скобки между двумя карточками: середина, но не выше и не ниже их краёв. */
export function bracketY(L: Box, R: Box): number {
  const cy = (L.y + L.h / 2 + R.y + R.h / 2) / 2;
  return Math.min(Math.max(cy, Math.max(L.y, R.y) + 12), Math.min(L.y + L.h, R.y + R.h) - 12);
}

/** Стоят ли двое бок о бок: вровень, рядом и никого между ними. */
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
