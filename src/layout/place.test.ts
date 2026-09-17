import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addPair, addPerson, link, normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { layout } from "./layout.ts";
import { NODE_W } from "./measure.ts";

const real = (): TreeState =>
  normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

/** пары карточек одного ряда, стоящих друг на друге */
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

/** семьи, чья середина детей не под центром родителей */
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

test("родители над серединой детей, дети каждой семьи под своими родителями", () => {
  const s = normalize({});
  const дед = addPerson(s, { name: "Пётр Дед", born: "1900" });
  const бабка = addPerson(s, { name: "Анна Бабка", born: "1902" });
  const дети = ["Иван", "Мария", "Олег"].map((n) => addPerson(s, { name: n + " Петрович" }));
  for (const c of дети) {
    link(s, дед, c);
    link(s, бабка, c);
  }
  const внукиИвана = ["Саша", "Даша", "Паша"].map((n) => addPerson(s, { name: n + " Иванович" }));
  for (const c of внукиИвана) link(s, дети[0], c);
  const внукиОлега = ["Коля", "Толя"].map((n) => addPerson(s, { name: n + " Олегович" }));
  for (const c of внукиОлега) link(s, дети[2], c);

  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  // братья идут слева направо в порядке ввода, внуки под своим отцом, а не под дядей
  assert.ok(pos[дети[0]].x < pos[дети[1]].x && pos[дети[1]].x < pos[дети[2]].x);
  for (const c of внукиОлега) assert.ok(Math.abs(pos[c].x - pos[дети[2]].x) < NODE_W * 1.5, "внук Олега рядом с Олегом");
});

test("сваты стоят над своим ребёнком, а братья с их детьми остаются под родителями", () => {
  // ровно жалоба пользователя: дочь стояла под родителями мужа её сестры
  const s = normalize({});
  const дед = addPerson(s, { name: "Пётр Дед" });
  const бабка = addPerson(s, { name: "Анна Бабка" });
  const елена = addPerson(s, { name: "Елена Петровна" });
  const раиса = addPerson(s, { name: "Раиса Петровна" });
  for (const c of [елена, раиса]) {
    link(s, дед, c);
    link(s, бабка, c);
  }
  const дочериЕлены = ["Анна", "Марина", "Екатерина"].map((n) => addPerson(s, { name: n + " Еленовна" }));
  for (const c of дочериЕлены) link(s, елена, c);
  // муж Раисы с родителями и братом — сваты со своим деревом
  const степан = addPerson(s, { name: "Степан Андреевич" });
  addPair(s, раиса, степан);
  const свёкор = addPerson(s, { name: "Андрей Свёкор" });
  const свекровь = addPerson(s, { name: "Ольга Свекровь" });
  const братСтепана = addPerson(s, { name: "Фёдор Андреевич" });
  for (const c of [степан, братСтепана]) {
    link(s, свёкор, c);
    link(s, свекровь, c);
  }
  const мария = addPerson(s, { name: "Мария Степановна" });
  link(s, раиса, мария);
  link(s, степан, мария);

  const { pos, level } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  assert.equal(level[свёкор], level[дед], "сваты в ряду родителей");
  // дочери Елены — под Еленой, а не под сватами
  const [lo, hi] = [Math.min(...дочериЕлены.map((c) => pos[c].x)), Math.max(...дочериЕлены.map((c) => pos[c].x))];
  assert.ok(pos[степан].x > hi + NODE_W / 2 || pos[степан].x < lo - NODE_W / 2, "Степан не над дочерями Елены");
  assert.ok(Math.abs(pos[мария].x - (pos[раиса].x + pos[степан].x) / 2) < 1, "Мария ровно под Раисой и Степаном");
});

test("единственный ребёнок под родителями важнее, чем родители жены ровно над ней", () => {
  const s = normalize({});
  const отец = addPerson(s, { name: "Сергей Отец" });
  const мать = addPerson(s, { name: "Татьяна Мать" });
  const сын = addPerson(s, { name: "Дмитрий Сын" });
  link(s, отец, сын);
  link(s, мать, сын);
  const жена = addPerson(s, { name: "Анастасия Жена" });
  addPair(s, сын, жена);
  const тесть = addPerson(s, { name: "Александр Тесть" });
  const тёща = addPerson(s, { name: "Анна Тёща" });
  const шурин = addPerson(s, { name: "Александр Шурин" });
  for (const c of [жена, шурин]) {
    link(s, тесть, c);
    link(s, тёща, c);
  }
  const { pos, level } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.equal(level[тесть], level[отец], "тесть в ряду родителей мужа");
  assert.ok(Math.abs(pos[сын].x - (pos[отец].x + pos[мать].x) / 2) < 1, "сын ровно под родителями");
  // тесть с тёщей рядом, над своими детьми — пусть и не ровно над серединой
  assert.ok(Math.abs(pos[тесть].x - pos[тёща].x) < NODE_W * 1.6);
  const kids = [pos[жена].x, pos[шурин].x];
  const centre = (pos[тесть].x + pos[тёща].x) / 2;
  assert.ok(centre > Math.min(...kids) - NODE_W && centre < Math.max(...kids) + NODE_W, "сваты над своими детьми");
});

test("на исходных данных все семьи над серединой детей, кроме одного честного спора", () => {
  const s = real();
  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  // у Марии Степановны две семьи с единственным ребёнком в каждой — обоим ровно
  // под своей парой встать нельзя, одна из линий идёт ступенькой
  const known = offCentre(s, pos).filter((line) => !line.startsWith("Мария Степановна Стыраневская →"));
  assert.deepEqual(known, []);
});

test("мать с двумя мужьями: оба единственных ребёнка отвесно, мужья раздвинуты до обычного зазора", () => {
  const s = normalize({});
  const мать = addPerson(s, { name: "Мария Мать" });
  const муж1 = addPerson(s, { name: "Сергей Первый" });
  const муж2 = addPerson(s, { name: "Владимир Второй" });
  const дочь1 = addPerson(s, { name: "Светлана Сергеевна" });
  const дочь2 = addPerson(s, { name: "Марина Владимировна" });
  link(s, мать, дочь1);
  link(s, муж1, дочь1);
  link(s, мать, дочь2);
  link(s, муж2, дочь2);
  const { pos } = layout(s);
  assert.deepEqual(overlaps(pos), []);
  assert.deepEqual(offCentre(s, pos), []);
  // мужья по разные стороны от матери, каждый не дальше обычного зазора
  const [l, r] = [Math.min(pos[муж1].x, pos[муж2].x), Math.max(pos[муж1].x, pos[муж2].x)];
  assert.ok(l < pos[мать].x && pos[мать].x < r);
  assert.ok(r - l <= 2 * (NODE_W + 58) + 1, "пара читается как пара");
});
