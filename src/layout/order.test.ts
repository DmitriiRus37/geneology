import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { birthKey } from "../model/dates.ts";
import { addPair, addPerson, link, normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { edgeStats } from "./crossings.ts";
import { computeEdges } from "./edges.ts";
import { layout } from "./layout.ts";
import { NODE_W } from "./measure.ts";
import type { Rect } from "./route.ts";

const real = (): TreeState =>
  normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

/** Пересечения линий на раскладке — той же формулой, что в tools/metrics.ts. */
const crossingsOf = (s: TreeState) => {
  const { pos, level } = layout(s);
  const rects: Rect[] = Object.keys(pos).map((id) => ({
    x1: pos[id].x - pos[id].w / 2,
    y1: pos[id].y,
    x2: pos[id].x + pos[id].w / 2,
    y2: pos[id].y + pos[id].h,
  }));
  return edgeStats(computeEdges(s, pos, level, null), rects);
};

/** Пары: двое родителей одного ребёнка или записанный брак. */
const couplesOf = (s: TreeState): [string, string][] => {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  const add = (a: string, b: string) => {
    const k = [a, b].sort().join("|");
    if (!seen.has(k)) {
      seen.add(k);
      out.push([a, b]);
    }
  };
  const byChild: Record<string, string[]> = {};
  for (const l of s.links) (byChild[l.child] ||= []).push(l.parent);
  for (const ps of Object.values(byChild)) if (ps.length === 2) add(ps[0], ps[1]);
  for (const p of s.pairs) add(p.a, p.b);
  return out;
};

/**
 * Пример, где порядок обхода даёт пересечение, а перестановка убирает: жена
 * старшего сына встаёт между братьями, и спуск от её родителей режет шину семьи
 * мужа. Лечится тем, что жена встаёт снаружи, а её родители — над ней.
 */
function свояки(): { s: TreeState; ids: Record<string, string> } {
  const s = normalize({});
  const P1 = addPerson(s, { name: "Пётр Иванович Первый", sex: "m", born: "1920" });
  const P2 = addPerson(s, { name: "Прасковья Первая", sex: "f", born: "1922" });
  const Q1 = addPerson(s, { name: "Кузьма Второй", sex: "m", born: "1921" });
  const Q2 = addPerson(s, { name: "Ксения Вторая", sex: "f", born: "1923" });
  const X1 = addPerson(s, { name: "Иван Петрович Первый", sex: "m", born: "1950" });
  const S1 = addPerson(s, { name: "Светлана Кузьминична", sex: "f", born: "1951" });
  const X2 = addPerson(s, { name: "Пётр Петрович Первый", sex: "m", born: "1955" });
  for (const c of [X1, X2]) {
    link(s, P1, c);
    link(s, P2, c);
  }
  link(s, Q1, S1);
  link(s, Q2, S1);
  addPair(s, X1, S1);
  return { s, ids: { P1, P2, Q1, Q2, X1, S1, X2 } };
}

test("жена между братьями мужа: перестановка убирает пересечение", () => {
  const { s, ids } = свояки();
  const st = crossingsOf(s);
  assert.equal(st.visual, 0, "пересечений не осталось");
  assert.equal(st.through, 0);

  const { pos } = layout(s);
  // пара вместе, братья по старшинству, родители жены ровно над ней
  assert.ok(Math.abs(pos[ids.X1].x - pos[ids.S1].x) <= NODE_W + 24 + 1, "супруги рядом");
  assert.ok(pos[ids.X1].x < pos[ids.X2].x, "старший брат левее младшего");
  assert.ok(pos[ids.S1].x < pos[ids.X1].x, "жена снаружи, а не между братьями");
  const midQ = (pos[ids.Q1].x + pos[ids.Q2].x) / 2;
  assert.ok(Math.abs(midQ - pos[ids.S1].x) <= 1, "родители жены ровно над ней");
});

test("перестановка не трогает то, что уже было хорошо", () => {
  const s = real();
  // на исходных данных остаются только неустранимые пересечения у Тихомировых
  assert.ok(crossingsOf(s).crossings <= 3);
});

test("супруги стоят рядом, между ними никого", () => {
  for (const s of [real(), свояки().s]) {
    const { pos, level } = layout(s);
    for (const [a, b] of couplesOf(s)) {
      if (level[a] !== level[b]) continue;
      const lo = Math.min(pos[a].x, pos[b].x);
      const hi = Math.max(pos[a].x, pos[b].x);
      // малый зазор пары; до обычного (58) блок раздвигается только ради отвесных линий к детям обеих семей
      assert.ok(hi - lo <= NODE_W + 58 + 1, `${s.people[a].name} и ${s.people[b].name} разошлись на ${Math.round(hi - lo)} px`);
      const между = Object.keys(pos).find((id) => id !== a && id !== b && level[id] === level[a] && pos[id].x > lo && pos[id].x < hi);
      assert.equal(между, undefined, `между супругами встал ${между && s.people[между].name}`);
    }
  }
});

test("братья и сёстры идут по старшинству", () => {
  const s = real();
  const { pos, level } = layout(s);
  const byChild: Record<string, string[]> = {};
  for (const l of s.links) (byChild[l.child] ||= []).push(l.parent);
  const byUnion: Record<string, string[]> = {};
  for (const c of Object.keys(byChild)) (byUnion[byChild[c].slice().sort().join("|")] ||= []).push(c);
  let проверено = 0;
  for (const kids of Object.values(byUnion)) {
    const сДатами = kids.filter((k) => birthKey(s.people[k]) !== null);
    for (let i = 1; i < сДатами.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = сДатами[j];
        const b = сДатами[i];
        if (level[a] !== level[b]) continue;
        const ka = birthKey(s.people[a])!;
        const kb = birthKey(s.people[b])!;
        if (ka === kb) continue;
        проверено++;
        assert.ok(
          (ka < kb) === (pos[a].x < pos[b].x),
          `${s.people[a].name} и ${s.people[b].name} стоят не по старшинству`,
        );
      }
    }
  }
  assert.ok(проверено > 5, "проверка что-то проверила");
});

test("у кого две семьи — один супруг слева, другой справа", () => {
  const { s, ids } = свояки();
  const T1 = addPerson(s, { name: "Тамара Первая", sex: "f", born: "1956" });
  const T2 = addPerson(s, { name: "Татьяна Вторая", sex: "f", born: "1958" });
  const C1 = addPerson(s, { name: "Пётр Петрович Младший", sex: "m", born: "1980" });
  const C2 = addPerson(s, { name: "Пётр Петрович Меньшой", sex: "m", born: "1985" });
  link(s, ids.X2, C1);
  link(s, T1, C1);
  link(s, ids.X2, C2);
  link(s, T2, C2);
  const { pos } = layout(s);
  const x = pos[ids.X2].x;
  assert.ok((pos[T1].x < x && pos[T2].x > x) || (pos[T2].x < x && pos[T1].x > x), "жёны по разные стороны");
  assert.ok(pos[C1].x < pos[C2].x, "дети по старшинству");
});
