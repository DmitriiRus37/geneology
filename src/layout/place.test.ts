import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addPair, addPerson, link, normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { layout } from "./layout.ts";
import { NODE_W } from "./measure.ts";

const real = (): TreeState =>
  normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

/** pairs of cards in one row standing on top of each other */
const overlaps = (pos: Record<string, { x: number; y: number; w: number; h: number }>): string[] => {
  const ids = Object.keys(pos);
  const out: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = pos[ids[i]];
      const B = pos[ids[j]];
      const dx = Math.abs(A.x - B.x) - (A.w + B.w) / 2;
      const dy = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
      if (dx < -0.5 && dy < -0.5) out.push(ids[i] + " × " + ids[j]);
    }
  }
  return out;
};

/** families whose middle of the children is not under the centre of the parents */
const offCentre = (s: TreeState, pos: Record<string, { x: number }>): string[] => {
  const byKey = new Map<string, { parents: string[]; kids: string[] }>();
  for (const l of s.links) {
    const ps = s.links.filter((m) => m.child === l.child).map((m) => m.parent).sort();
    const key = ps.join("|");
    const f = byKey.get(key) ?? { parents: ps, kids: [] };
    if (!f.kids.includes(l.child)) f.kids.push(l.child);
    byKey.set(key, f);
  }
  const out: string[] = [];
  for (const f of byKey.values()) {
    const centre = f.parents.reduce((a, p) => a + pos[p].x, 0) / f.parents.length;
    const xs = f.kids.map((c) => pos[c].x);
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    if (Math.abs(mid - centre) > 1) out.push(f.parents.map((p) => s.people[p].name).join("+") + " → " + Math.round(mid - centre) + " px");
  }
  return out;
};

test("parents over the middle of the children, each family's children under their own parents", () => {
  const s = normalize({});
  const grandad = addPerson(s, { name: "Пётр Дед", born: "1900" });
  const grandma = addPerson(s, { name: "Анна Бабка", born: "1902" });
  const kids = ["Иван", "Мария", "Олег"].map((n) => addPerson(s, { name: n + " Петрович" }));
  for (const c of kids) {
    link(s, grandad, c);
    link(s, grandma, c);
  }
  const ivanKids = ["Саша", "Даша", "Паша"].map((n) => addPerson(s, { name: n + " Иванович" }));
  for (const c of ivanKids) link(s, kids[0], c);
  const olegKids = ["Коля", "Толя"].map((n) => addPerson(s, { name: n + " Олегович" }));
  for (const c of olegKids) link(s, kids[2], c);

  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  // the brothers run left to right in the order entered, the grandchildren under their own father rather than their uncle
  assert.ok(pos[kids[0]].x < pos[kids[1]].x && pos[kids[1]].x < pos[kids[2]].x);
  for (const c of olegKids) assert.ok(Math.abs(pos[c].x - pos[kids[2]].x) < NODE_W * 1.5, "Oleg's grandchild is next to Oleg");
});

test("in-laws stand over their own child, while the brothers and their children stay under their parents", () => {
  // exactly the user's complaint: a daughter used to stand under the parents of her sister's husband
  const s = normalize({});
  const grandad = addPerson(s, { name: "Пётр Дед" });
  const grandma = addPerson(s, { name: "Анна Бабка" });
  const elena = addPerson(s, { name: "Елена Петровна" });
  const raisa = addPerson(s, { name: "Раиса Петровна" });
  for (const c of [elena, raisa]) {
    link(s, grandad, c);
    link(s, grandma, c);
  }
  const elenaDaughters = ["Анна", "Марина", "Екатерина"].map((n) => addPerson(s, { name: n + " Еленовна" }));
  for (const c of elenaDaughters) link(s, elena, c);
  // Raisa's husband with his parents and brother — in-laws with a tree of their own
  const stepan = addPerson(s, { name: "Степан Андреевич" });
  addPair(s, raisa, stepan);
  const husbandsFather = addPerson(s, { name: "Андрей Свёкор" });
  const husbandsMother = addPerson(s, { name: "Ольга Свекровь" });
  const stepanBrother = addPerson(s, { name: "Фёдор Андреевич" });
  for (const c of [stepan, stepanBrother]) {
    link(s, husbandsFather, c);
    link(s, husbandsMother, c);
  }
  const maria = addPerson(s, { name: "Мария Степановна" });
  link(s, raisa, maria);
  link(s, stepan, maria);

  const { pos, level } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  assert.equal(level[husbandsFather], level[grandad], "the in-laws are in the row of the parents");
  // Elena's daughters go under Elena, not under the in-laws
  const [lo, hi] = [Math.min(...elenaDaughters.map((c) => pos[c].x)), Math.max(...elenaDaughters.map((c) => pos[c].x))];
  assert.ok(pos[stepan].x > hi + NODE_W / 2 || pos[stepan].x < lo - NODE_W / 2, "Stepan is not above Elena's daughters");
  assert.ok(Math.abs(pos[maria].x - (pos[raisa].x + pos[stepan].x) / 2) < 1, "Maria is exactly under Raisa and Stepan");
});

test("an only child under its parents matters more than the wife's parents exactly over her", () => {
  const s = normalize({});
  const father = addPerson(s, { name: "Сергей Отец" });
  const mother = addPerson(s, { name: "Татьяна Мать" });
  const son = addPerson(s, { name: "Дмитрий Сын" });
  link(s, father, son);
  link(s, mother, son);
  const wife = addPerson(s, { name: "Анастасия Жена" });
  addPair(s, son, wife);
  const wifesFather = addPerson(s, { name: "Александр Тесть" });
  const wifesMother = addPerson(s, { name: "Анна Тёща" });
  const brotherInLaw = addPerson(s, { name: "Александр Шурин" });
  for (const c of [wife, brotherInLaw]) {
    link(s, wifesFather, c);
    link(s, wifesMother, c);
  }
  const { pos, level } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.equal(level[wifesFather], level[father], "the wife's father is in the row of the husband's parents");
  assert.ok(Math.abs(pos[son].x - (pos[father].x + pos[mother].x) / 2) < 1, "the son is exactly under his parents");
  // the wife's parents side by side, above their own children — even if not exactly over the middle
  assert.ok(Math.abs(pos[wifesFather].x - pos[wifesMother].x) < NODE_W * 1.6);
  const kids = [pos[wife].x, pos[brotherInLaw].x];
  const centre = (pos[wifesFather].x + pos[wifesMother].x) / 2;
  assert.ok(centre > Math.min(...kids) - NODE_W && centre < Math.max(...kids) + NODE_W, "the in-laws are above their own children");
});

test("on the original data every family is over the middle of its children, bar one honest dispute", () => {
  const s = real();
  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  // one person has two families with an only child in each — both cannot stand exactly
  // under their own couple, so one of the lines goes stepped
  const known = offCentre(s, pos).filter((line) => !line.startsWith("Мария Степановна Стыраневская →"));
  assert.deepEqual(known, []);
});

test("a mother with two husbands: both only children hang vertically, the husbands spread to the normal gap", () => {
  const s = normalize({});
  const mother = addPerson(s, { name: "Мария Мать" });
  const husband1 = addPerson(s, { name: "Сергей Первый" });
  const husband2 = addPerson(s, { name: "Владимир Второй" });
  const daughter1 = addPerson(s, { name: "Светлана Сергеевна" });
  const daughter2 = addPerson(s, { name: "Марина Владимировна" });
  link(s, mother, daughter1);
  link(s, husband1, daughter1);
  link(s, mother, daughter2);
  link(s, husband2, daughter2);
  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  // the husbands on opposite sides of the mother, each no further than the normal gap
  const [l, r] = [Math.min(pos[husband1].x, pos[husband2].x), Math.max(pos[husband1].x, pos[husband2].x)];
  assert.ok(l < pos[mother].x && pos[mother].x < r);
  assert.ok(r - l <= 2 * (NODE_W + 58) + 1, "the couple still reads as a couple");
});
