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
import { nodeCards } from "../testing/cards.ts";

const real = (): TreeState =>
  normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

/** Line crossings on a layout — by the same formula as in tools/metrics.ts. */
const crossingsOf = (s: TreeState) => {
  const { pos, level } = layout(s, nodeCards());
  const rects: Rect[] = Object.keys(pos).map((id) => ({
    x1: pos[id].x - pos[id].w / 2,
    y1: pos[id].y,
    x2: pos[id].x + pos[id].w / 2,
    y2: pos[id].y + pos[id].h,
  }));
  return edgeStats(computeEdges(s, pos, level, null), rects);
};

/** Couples: two parents of one child, or a recorded marriage. */
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
 * A case where the traversal order produces a crossing and reordering removes it: the
 * elder son's wife stands between the brothers, and the descent from her parents cuts the
 * bus of her husband's family. The cure is for the wife to stand on the outside, with her
 * parents above her.
 */
function inLaws(): { s: TreeState; ids: Record<string, string> } {
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

test("a wife between her husband's brothers: reordering removes the crossing", () => {
  const { s, ids } = inLaws();
  const st = crossingsOf(s);
  assert.equal(st.visual, 0, "no crossings are left");
  assert.equal(st.through, 0);

  const { pos } = layout(s, nodeCards());
  // the couple together, the brothers by seniority, the wife's parents exactly above her
  assert.ok(Math.abs(pos[ids.X1].x - pos[ids.S1].x) <= NODE_W + 24 + 1, "the spouses are side by side");
  assert.ok(pos[ids.X1].x < pos[ids.X2].x, "the elder brother is to the left of the younger");
  assert.ok(pos[ids.S1].x < pos[ids.X1].x, "the wife is on the outside, not between the brothers");
  const midQ = (pos[ids.Q1].x + pos[ids.Q2].x) / 2;
  assert.ok(Math.abs(midQ - pos[ids.S1].x) <= 1, "the wife's parents are exactly above her");
});

test("reordering does not touch what was already good", () => {
  const s = real();
  // on the original data only the unavoidable crossings in one family remain
  assert.ok(crossingsOf(s).crossings <= 3);
});

test("spouses stand side by side with nobody between them", () => {
  for (const s of [real(), inLaws().s]) {
    const { pos, level } = layout(s, nodeCards());
    for (const [a, b] of couplesOf(s)) {
      if (level[a] !== level[b]) continue;
      const lo = Math.min(pos[a].x, pos[b].x);
      const hi = Math.max(pos[a].x, pos[b].x);
      // the couple's small gap; the block is spread to the normal one (58) only for the sake of vertical lines to the children of both families
      assert.ok(hi - lo <= NODE_W + 58 + 1, `${s.people[a].name} and ${s.people[b].name} drifted ${Math.round(hi - lo)} px apart`);
      const between = Object.keys(pos).find((id) => id !== a && id !== b && level[id] === level[a] && pos[id].x > lo && pos[id].x < hi);
      assert.equal(between, undefined, `${between && s.people[between].name} stood between the spouses`);
    }
  }
});

test("siblings run in order of seniority", () => {
  const s = real();
  const { pos, level } = layout(s, nodeCards());
  const byChild: Record<string, string[]> = {};
  for (const l of s.links) (byChild[l.child] ||= []).push(l.parent);
  const byUnion: Record<string, string[]> = {};
  for (const c of Object.keys(byChild)) (byUnion[byChild[c].slice().sort().join("|")] ||= []).push(c);
  let checked = 0;
  for (const kids of Object.values(byUnion)) {
    const dated = kids.filter((k) => birthKey(s.people[k]) !== null);
    for (let i = 1; i < dated.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = dated[j];
        const b = dated[i];
        if (level[a] !== level[b]) continue;
        const ka = birthKey(s.people[a])!;
        const kb = birthKey(s.people[b])!;
        if (ka === kb) continue;
        checked++;
        assert.ok(
          (ka < kb) === (pos[a].x < pos[b].x),
          `${s.people[a].name} and ${s.people[b].name} do not stand in order of seniority`,
        );
      }
    }
  }
  assert.ok(checked > 5, "the check actually checked something");
});

test("whoever has two families gets one spouse on the left and the other on the right", () => {
  const { s, ids } = inLaws();
  const T1 = addPerson(s, { name: "Тамара Первая", sex: "f", born: "1956" });
  const T2 = addPerson(s, { name: "Татьяна Вторая", sex: "f", born: "1958" });
  const C1 = addPerson(s, { name: "Пётр Петрович Младший", sex: "m", born: "1980" });
  const C2 = addPerson(s, { name: "Пётр Петрович Меньшой", sex: "m", born: "1985" });
  link(s, ids.X2, C1);
  link(s, T1, C1);
  link(s, ids.X2, C2);
  link(s, T2, C2);
  const { pos } = layout(s, nodeCards());
  const x = pos[ids.X2].x;
  assert.ok((pos[T1].x < x && pos[T2].x > x) || (pos[T2].x < x && pos[T1].x > x), "the wives are on opposite sides");
  assert.ok(pos[C1].x < pos[C2].x, "the children in order of seniority");
});
