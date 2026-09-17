import { isApproxYear, yearIn, yearOfBirth } from "../model/dates.ts";
import { spousesOf } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import type { Box, Gaps, Graph } from "./layout.ts";
import { NODE_W } from "./measure.ts";
import { mean } from "../util.ts";

export interface Timeline {
  min: number;
  max: number;
  scale: number;
  /** год оценён по родне, а не взят из карточки */
  est: Record<string, 1>;
  year: Record<string, number>;
}

/**
 * Вертикаль по году рождения вместо поколения. Недостающие годы тянем
 * от детей, родителей, братьев-сестёр и супруга, помечая как оценку.
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
      if (isApproxYear(state.people[id].born)) est[id] = 1; // «197?» — год известен приблизительно
    }
  }
  for (const id of ids) {
    // известна только смерть — грубая оценка
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

      // У супруга есть настоящая дата — встаём с ним вровень и дальше не гадаем.
      // Оценку супруга берём только в последнюю очередь, ниже.
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

  // масштаб подбираем так, чтобы карточки соседних поколений не наезжали
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
  // Потолок — только предохранитель от совсем уж дикой картинки. Раньше тут
  // стояло 14, и он отбирал у формулы ровно то, что она просила: при высоких
  // карточках нужно ~50 px на год, иначе соседние годы налезают друг на друга.
  scale = Math.min(scale, 60);
  for (const id of ids) pos[id].y = (yr[id] - minYr) * scale - pos[id].h / 2;

  // Родившиеся в один год на одном месте — разводим вбок. Проход повторяем:
  // сдвинутая карточка может налезть на следующую, а одним заходом это не
  // ловилось — оставались наложения, и линиям между ними негде было пройти.
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
    // Разведение может и не сойтись: цепочка ровесников толкает друг друга по кругу.
    // Последний проход слева направо разводит всех наверняка — двигая только вправо,
    // в порядке x, каждую карточку от уже проверенных.
    const byX = ids.slice().sort((a, b) => pos[a].x - pos[b].x);
    for (let i = 1; i < byX.length; i++) {
      const A = pos[byX[i]];
      for (let j = 0; j < i; j++) {
        const B = pos[byX[j]];
        if (B.y + B.h + 8 <= A.y || A.y + A.h + 8 <= B.y) continue;
        if (A.x < B.x + need) A.x = B.x + need;
      }
    }

    // Развели — и тем самым сломали выравнивание, сделанное в обычном режиме.
    // Возвращаем карточки на прежние места, но только пока это никого не задевает:
    // наложения здесь дороже отвесной линии. Именно на прежние места, а не «под
    // родителей»: под середину родителей тянулся каждый из братьев по отдельности,
    // и тот, кому годы позволяли, вставал в столбик собственного супруга — сквозь
    // него шла линия супруга к их детям.
    const crowded = (id: string): boolean =>
      ids.some((other) => {
        if (other === id) return false;
        const A = pos[id];
        const B = pos[other];
        if (B.y + B.h + 8 <= A.y || A.y + A.h + 8 <= B.y) return false;
        return Math.abs(A.x - B.x) < need - 0.5;
      });

    for (let round = 0; round < 8; round++) {
      let moved = false;
      for (const id of ids) {
        const dx = orig[id] - pos[id].x;
        if (Math.abs(dx) < 1) continue;
        const was = pos[id].x;
        pos[id].x = was + Math.sign(dx) * Math.min(Math.abs(dx), 60);
        if (crowded(id)) pos[id].x = was;
        else moved = true;
      }
      if (!moved) break;
    }
  }

  return { min: minYr, max: maxYr, scale, est, year: yr };
}
