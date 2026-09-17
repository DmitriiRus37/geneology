import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { addPair, addPerson, link, normalize, parentsOf } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { computeEdges } from "./edges.ts";
import { bboxOf, layout } from "./layout.ts";
import { NODE_W } from "./measure.ts";
import { hitsCard, type Rect } from "./route.ts";

const real = (): TreeState =>
  normalize(JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8")));

const finite = (v: number) => Number.isFinite(v);

test("на реальной родословной карточки не налезают друг на друга", () => {
  const { pos } = layout(real());
  const ids = Object.keys(pos);
  assert.equal(ids.length, 38);
  const bad: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = pos[ids[i]];
      const B = pos[ids[j]];
      const dx = Math.abs(A.x - B.x) - (A.w + B.w) / 2;
      const dy = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h);
      if (dx < -0.5 && dy < -0.5) bad.push(ids[i] + " × " + ids[j]);
    }
  }
  assert.deepEqual(bad, []);
});

test("в раскладке нет NaN", () => {
  const { pos, level } = layout(real());
  for (const id of Object.keys(pos)) {
    const b = pos[id];
    assert.ok(finite(b.x) && finite(b.y) && finite(b.w) && finite(b.h), "координаты " + id);
    assert.ok(Number.isInteger(level[id]) && level[id] >= 0, "поколение " + id);
  }
  const b = bboxOf(pos);
  assert.ok(b && finite(b.w) && finite(b.h) && b.w > 0 && b.h > 0);
});

test("в разметке связей нет NaN и рисуются все стрелки", () => {
  const s = real();
  const { pos, level } = layout(s);
  const items = computeEdges(s, pos, level, null);
  assert.ok(items.length > 0);
  // у ребёнка двух родителей стрелка одна: она выходит из общей точки семьи
  const arrows = items.filter((i) => i.kind === "path" && i.arrow).length;
  assert.equal(arrows, new Set(s.links.map((l) => l.child)).size, "по стрелке на каждого ребёнка");
  for (const it of items) {
    if (it.kind === "path") assert.ok(!/NaN|Infinity|undefined/.test(it.d), it.d);
    else assert.ok(finite(it.x) && finite(it.y));
  }
});

test("ребёнок всегда ниже родителя, супруги — вровень", () => {
  const s = real();
  const { level } = layout(s);
  for (const l of s.links) assert.ok(level[l.child] > level[l.parent], l.parent + " → " + l.child);
  for (const p of s.pairs) assert.equal(level[p.a], level[p.b]);
});

test("режим по годам: год есть у каждого, оценки помечены", () => {
  const s = real();
  s.timeline = true;
  const { tl, pos } = layout(s);
  assert.ok(tl);
  for (const id of Object.keys(s.people)) {
    assert.ok(Number.isFinite(tl.year[id]), "год " + id);
    assert.ok(Number.isFinite(pos[id].y));
  }
  const known = Object.keys(s.people).filter((id) => !tl.est[id]);
  assert.ok(known.length > 20, "у большинства год взят из карточки, а не оценён");
  assert.ok(tl.min >= 1800 && tl.max <= 2100, "шкала лет в разумных пределах");
});

test("перетаскивание закрепляет карточку на месте", () => {
  const s = real();
  const id = Object.keys(s.people)[0];
  s.people[id].fx = 1234;
  s.people[id].fy = 567;
  const { pos } = layout(s);
  assert.equal(pos[id].x, 1234);
  assert.equal(pos[id].y, 567);
});

test("пустое древо не роняет раскладку", () => {
  const { pos, tl } = layout(normalize({ people: {}, links: [], pairs: [], timeline: true }));
  assert.deepEqual(pos, {});
  assert.equal(tl, null);
  assert.equal(bboxOf(pos), null);
});

test("ещё не пристроенные стоят под древом, а не за его правым краем", () => {
  const s = real();
  const отец = addPerson(s, { name: "Пермяков Александр Владимирович" });
  const мать = addPerson(s, { name: "Пермякова Анна Валерьевна" });
  addPair(s, отец, мать);
  const { pos, lonePlate } = layout(s);

  // в исходных данных уже есть непристроенные — сравниваем с теми, кто в древе
  const вдреве = new Set(s.links.flatMap((l) => [l.parent, l.child]));
  const родня = [...вдреве];
  const ближайший = Math.min(...родня.map((id) => Math.abs(pos[id].x - pos[отец].x)));
  assert.ok(ближайший < 400, "по горизонтали рядом с древом, а не за краем: " + Math.round(ближайший));

  const низ = Math.max(...родня.map((id) => pos[id].y + pos[id].h));
  assert.ok(pos[отец].y > низ, "блок лежит ниже древа");
  assert.ok(lonePlate && pos[отец].y > lonePlate.y, "подпись блока стоит над ним");

  // супруги остаются рядом
  assert.ok(Math.abs(pos[отец].x - pos[мать].x) < NODE_W * 1.6);
});

test("связанный родитель встаёт вплотную к ребёнку, а не в общий блок", () => {
  const s = real();
  const дочь = Object.keys(s.people).find((id) => s.people[id].name.includes("Екатерина Александровна"))!;
  const отец = addPerson(s, { name: "Пермяков Александр Владимирович" });
  assert.equal(link(s, отец, дочь).ok, true);
  const { pos, lonePlate } = layout(s);
  // у дочери теперь двое родителей, она встаёт между ними
  const другой = parentsOf(s, дочь).find((q) => q !== отец)!;
  const слева = Math.min(pos[отец].x, pos[другой].x);
  const справа = Math.max(pos[отец].x, pos[другой].x);
  assert.ok(pos[дочь].x >= слева - 1 && pos[дочь].x <= справа + 1, "дочь между родителями");
  assert.ok(pos[отец].y < pos[дочь].y, "и ниже них");
  assert.ok(!lonePlate || pos[отец].y < lonePlate.y, "он в древе, а не в блоке непристроенных");
});

test("по годам: супруг с известной датой задаёт год второму", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;

  const алексей = id("Алексей Иванович Якунин"); // 28.02.1932
  const алина = id("Алина Александровна"); // дат нет, но у них общие дети
  const { tl, pos } = layout(s);
  assert.ok(tl);

  assert.equal(tl.year[алексей], 1932);
  assert.equal(tl.year[алина], 1932, "жена встала вровень с мужем, а не по средней родне");
  assert.ok(tl.est[алина], "год помечен как оценка");
  const центр = (k: string) => pos[k].y + pos[k].h / 2;
  assert.ok(Math.abs(центр(алексей) - центр(алина)) < 0.6, "и на холсте на одной высоте");
});

test("по годам: то же правило работает и для записанного брака", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;
  const лидия = id("Лидия Лесняк");
  const леонид = id("Леонид Иванович"); // 16.10.1957, в браке с Лидией
  s.people[лидия].born = ""; // забыли её дату
  const { tl } = layout(s);
  assert.equal(tl!.year[леонид], 1957);
  assert.equal(tl!.year[лидия], 1957, "общих детей у них нет, но пара есть — и год тот же");
});

test("по годам: своя дата всегда важнее супруга", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;
  const { tl } = layout(s);
  const анна = id("Анна Фёдоровна"); // 1904, жена Ивана Егоровича 1902
  assert.equal(tl!.year[анна], 1904);
  assert.ok(!tl!.est[анна]);
});

/** Прямоугольники карточек — по ним проверяем, что линии никого не задевают. */
const cardsOf = (pos: Record<string, { x: number; y: number; w: number; h: number }>): Rect[] =>
  Object.keys(pos).map((id) => ({
    x1: pos[id].x - pos[id].w / 2,
    y1: pos[id].y,
    x2: pos[id].x + pos[id].w / 2,
    y2: pos[id].y + pos[id].h,
  }));

const crossings = (s: TreeState) => {
  const { pos, level } = layout(s);
  const rects = cardsOf(pos);
  return computeEdges(s, pos, level, null)
    .filter((i) => i.kind === "path")
    .filter((i) => hitsCard(i.pts, rects));
};

test("проверка пересечений сама работает", () => {
  const rect: Rect = { x1: 0, y1: 0, x2: 100, y2: 50 };
  assert.ok(hitsCard([{ x: 50, y: -20 }, { x: 50, y: 70 }], [rect]), "линия насквозь — пересечение");
  assert.equal(hitsCard([{ x: 50, y: -20 }, { x: 50, y: -5 }], [rect]), null, "линия выше — нет");
  assert.equal(hitsCard([{ x: 120, y: -20 }, { x: 120, y: 70 }], [rect]), null, "линия сбоку — нет");
});

test("ни одна связь не проходит сквозь карточку", () => {
  assert.deepEqual(crossings(real()).map((i) => i.d), []);
});

test("брак увёл человека вниз — родня едет за ним, а не остаётся в шапке древа", () => {
  // ровно ваш случай: женился на девушке из ветки поглубже. Раньше её родители
  // оставались в самом верху, за четыре ряда от дочери.
  const s = real();
  const дмитрий = Object.keys(s.people).find((id) => s.people[id].name.includes("Дмитрий Сергеевич"))!;
  const глубже = Object.entries(layout(s).level).sort((a, b) => b[1] - a[1])[0][0];
  const жена = addPerson(s, { name: "Пермякова Анастасия Александровна" });
  const тесть = addPerson(s, { name: "Пермяков Александр Владимирович" });
  assert.equal(link(s, глубже, жена).ok, true);
  assert.equal(link(s, тесть, жена).ok, true);
  addPair(s, дмитрий, жена);

  const { level, pos } = layout(s);
  assert.equal(level[жена] - level[тесть], 1, "тесть ровно на ряд выше дочери");
  assert.ok(pos[тесть].y < pos[жена].y, "и выше неё на холсте");
  assert.deepEqual(crossings(s).map((i) => i.d), []);
});

test("каждый родитель ровно на ряд выше своих детей", () => {
  const s = real();
  const { level } = layout(s);
  const далеко = s.links
    .filter((l) => level[l.child] - level[l.parent] !== 1)
    .map((l) => s.people[l.parent].name + " → " + s.people[l.child].name);
  assert.deepEqual(далеко, []);
});

test("карточку утащили на свободное место — линии до неё никого не задели", () => {
  const s = real();
  const id = Object.keys(s.people).find((k) => s.people[k].name.includes("Екатерина Александровна"))!;
  const b = bboxOf(layout(s).pos)!;
  s.people[id].fx = b.x1 - 420; // слева от всего древа, там пусто
  s.people[id].fy = b.y2 + 60; // и ниже родителей: вверх линия вышла бы из их же карточки
  assert.deepEqual(crossings(s).map((i) => i.d), []);
});

test("единственный ребёнок стоит точно под родителями — линия идёт отвесно", () => {
  const s = real();
  const { pos, level } = layout(s);
  const byChild: Record<string, string[]> = {};
  for (const l of s.links) (byChild[l.child] ||= []).push(l.parent);

  const кривые: string[] = [];
  for (const child of Object.keys(byChild)) {
    const ps = byChild[child];
    const key = ps.slice().sort().join("|");
    const одинРебёнок = Object.keys(byChild).filter((c) => byChild[c].slice().sort().join("|") === key).length === 1;
    if (!одинРебёнок) continue;
    // если у кого-то из родителей есть вторая семья, два единственных ребёнка
    // тянут в разные стороны — оба отвесно встать не могут
    const делятРодителя = ps.some((p) =>
      Object.keys(byChild).some((c) => byChild[c].includes(p) && byChild[c].slice().sort().join("|") !== key),
    );
    if (делятРодителя) continue;
    const середина = ps.reduce((sum, p) => sum + pos[p].x, 0) / ps.length;
    if (Math.abs(середина - pos[child].x) > 1) {
      кривые.push(s.people[child].name + " сдвинут на " + Math.round(Math.abs(середина - pos[child].x)) + " px");
    }
  }
  assert.deepEqual(кривые, []);
  assert.ok(Object.keys(level).length > 0);
});

test("стрелки к детям никогда не идут наискось", () => {
  const s = real();
  const { pos, level } = layout(s);
  for (const it of computeEdges(s, pos, level, null)) {
    if (it.kind !== "path") continue;
    const pts: { x: number; y: number }[] = it.pts;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      assert.ok(
        Math.abs(a.x - b.x) < 0.6 || Math.abs(a.y - b.y) < 0.6,
        "отрезок не горизонтальный и не вертикальный: " + JSON.stringify([a, b]),
      );
    }
  }
});

test("остров без связей с древом встаёт в ряд по году рождения, а не в шапку", () => {
  // основное древо: три поколения с датами
  const s = normalize({});
  const дед = addPerson(s, { name: "Пётр Иванович Старший", born: "1900" });
  const бабка = addPerson(s, { name: "Анна Петровна Старшая", born: "1902" });
  const отец = addPerson(s, { name: "Иван Петрович Средний", born: "1930" });
  const внук = addPerson(s, { name: "Пётр Иванович Младший", born: "1960" });
  link(s, дед, отец);
  link(s, бабка, отец);
  link(s, отец, внук);
  // остров: отец 1958 года и его сын 1990-го, ни с кем не связаны
  const чужой = addPerson(s, { name: "Артём Александрович Гость", born: "1958" });
  const сын = addPerson(s, { name: "Макар Артёмович Гость", born: "1990" });
  link(s, чужой, сын);

  const { level } = layout(s);
  assert.equal(level[чужой], level[внук], "1958-й — ряд внука (1960)");
  assert.equal(level[сын], level[внук] + 1, "а его сын — рядом ниже");
  assert.ok(level[дед] === 0 && level[отец] === 1, "основное древо не сдвинулось");
});

test("остров без единой даты остаётся в шапке", () => {
  const s = normalize({});
  const дед = addPerson(s, { name: "Пётр Иванович Старший", born: "1900" });
  const отец = addPerson(s, { name: "Иван Петрович Средний", born: "1930" });
  link(s, дед, отец);
  const чужой = addPerson(s, { name: "Некто Безымянный" });
  const сын = addPerson(s, { name: "Сын Безымянный" });
  link(s, чужой, сын);
  const { level } = layout(s);
  assert.equal(level[чужой], 0);
  assert.equal(level[сын], 1);
});

test("сестру увёл вниз брак её дочери — брат и сестра едут за ней, родители над всеми троими", () => {
  const s = normalize({});
  const мать = addPerson(s, { name: "Татьяна Лузина" });
  const отец = addPerson(s, { name: "Валерий Лузин" });
  const анна = addPerson(s, { name: "Анна Валерьевна" });
  const сергей = addPerson(s, { name: "Сергей Валерьевич" });
  const мария = addPerson(s, { name: "Мария Валерьевна" });
  for (const c of [анна, сергей, мария]) {
    link(s, мать, c);
    link(s, отец, c);
  }
  const дочь = addPerson(s, { name: "Анастасия Александровна" });
  link(s, анна, дочь);
  // глубокая ветка: пять поколений, младший женится на дочери Анны
  let верх = addPerson(s, { name: "Пращур" });
  for (let i = 0; i < 4; i++) {
    const next = addPerson(s, { name: "Потомок " + i });
    link(s, верх, next);
    верх = next;
  }
  addPair(s, верх, дочь);

  const { level } = layout(s);
  assert.equal(level[анна], level[сергей], "брат в ряду сестры");
  assert.equal(level[анна], level[мария], "и вторая сестра тоже");
  assert.equal(level[мать], level[анна] - 1, "родители ровно на ряд выше");
  assert.equal(level[отец], level[анна] - 1);
  assert.equal(level[дочь], level[анна] + 1);
  assert.equal(level[дочь], level[верх], "супруги вровень");
});
