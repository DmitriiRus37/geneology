import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../i18n.ts";
import { layout } from "../layout/layout.ts";
import { initialAppState, reducer, type Action, type AppState } from "./store.ts";
import { addPair, addPerson, childrenOf, link, parentsOf, partnersOf } from "./tree.ts";
import { emptyState } from "./types.ts";

function start(): { s: AppState; иван: string; анна: string } {
  const tree = emptyState();
  const иван = addPerson(tree, { name: "Иван Егорович Якунин" });
  const анна = addPerson(tree, { name: "Анна Фёдоровна Якунина" });
  return { s: initialAppState(tree), иван, анна };
}

const run = (s: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, s);

test("добавление ребёнка стрелкой: связь, выбор и пол по имени", () => {
  const { s, иван } = start();
  const next = run(s, { type: "add", spec: { name: "Мария Ивановна Якунина" }, relation: { mode: "child", to: иван } });
  const id = next.selected;
  assert.ok(id, "новый человек сразу выбран");
  assert.equal(next.tree.people[id].sex, "f");
  assert.deepEqual(childrenOf(next.tree, иван), [id]);
  assert.deepEqual(parentsOf(next.tree, id), [иван]);
});

test("добавление не перекраивает вид, а только подводит карточку в кадр", () => {
  const { s, иван } = start();
  const next = run(s, { type: "add", spec: { name: "Пётр" }, relation: { mode: "child", to: иван } });
  assert.equal(next.fitSeq, s.fitSeq, "масштаб и сдвиг холста остаются как были");
  assert.equal(next.focus?.id, next.selected);
});

test("родителя добавляем той же кнопкой, направление связи обратное", () => {
  const { s, иван } = start();
  const next = run(s, { type: "add", spec: { name: "Егор Якунин" }, relation: { mode: "parent", to: иван } });
  assert.deepEqual(parentsOf(next.tree, иван), [next.selected]);
});

test("супруг добавляется браком, а не родительской связью", () => {
  const { s, иван } = start();
  const next = run(s, { type: "add", spec: { name: "Анна" }, relation: { mode: "spouse", to: иван } });
  assert.deepEqual(partnersOf(next.tree, иван), [next.selected]);
  assert.equal(next.tree.links.length, 0);
});

test("петля не создаётся и объясняет почему", () => {
  const { s, иван } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: иван } });
  const дочь = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: дочь, to: иван });
  assert.equal(b.tree.links.length, a.tree.links.length, "связь не добавилась");
  assert.match(render("ru", b.notice!.msg), /петля/);
  assert.match(render("en", b.notice!.msg), /loop/);
});

test("двое родителей одного ребёнка образуют одну семью", () => {
  const { s, иван, анна } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: иван } });
  const дочь = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: анна, to: дочь });
  assert.deepEqual(parentsOf(b.tree, дочь).sort(), [иван, анна].sort());
});

test("отмена возвращает предыдущее состояние", () => {
  const { s, иван } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: иван } });
  const b = run(a, { type: "undo" });
  assert.equal(Object.keys(b.tree.people).length, 2);
  assert.equal(b.selected, null);
  assert.equal(render("ru", run(s, { type: "undo" }).notice!.msg), "Отменять нечего");
});

test("правка полей не засоряет историю отмены", () => {
  const { s, иван } = start();
  const a = run(
    s,
    { type: "update", id: иван, patch: { born: "20.05.1902" }, quiet: true },
    { type: "update", id: иван, patch: { born: "20.05.1902" }, quiet: true },
  );
  assert.equal(a.history.length, 0);
  assert.equal(a.tree.people[иван].born, "20.05.1902");
  // а смена пола — обычное изменение, её можно отменить
  const b = run(a, { type: "update", id: иван, patch: { sex: "f" } });
  assert.equal(b.history.length, 1);
  assert.equal(run(b, { type: "undo" }).tree.people[иван].sex, "m");
});

test("удаление человека убирает его связи и снимает выбор", () => {
  const { s, иван } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: иван } });
  const дочь = a.selected as string;
  const b = run(a, { type: "remove", id: дочь });
  assert.equal(b.selected, null);
  assert.equal(b.tree.links.length, 0);
  assert.equal(Object.keys(b.tree.people).length, 2);
});

test("одну связь можно убрать, не трогая остальные", () => {
  const { s, иван, анна } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: иван } });
  const дочь = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: анна, to: дочь }, { type: "cut", parent: иван, child: дочь });
  assert.deepEqual(parentsOf(b.tree, дочь), [анна]);
});

test("перетаскивание запоминается, «Расставить» его снимает", () => {
  const { s, иван } = start();
  const a = run(s, { type: "pin", id: иван, x: 100, y: 200 });
  assert.equal(a.tree.people[иван].fx, 100);
  const b = run(a, { type: "rearrange" });
  assert.equal(b.tree.people[иван].fx, undefined);
  assert.equal(b.fitSeq, a.fitSeq + 1, "после «Расставить» древо вмещается в экран");
});

test("очистка убирает всех, но её можно отменить", () => {
  const { s } = start();
  const a = run(s, { type: "wipe" });
  assert.deepEqual(a.tree.people, {});
  assert.equal(Object.keys(run(a, { type: "undo" }).tree.people).length, 2);
});

test("«Скрыть предков» срезает древо вверх, «Вернуть всех» возвращает", () => {
  const s = initialAppState(emptyState());
  const t = s.tree;
  const дед = addPerson(t, { name: "Дед" });
  const бабка = addPerson(t, { name: "Бабка" });
  const отец = addPerson(t, { name: "Отец" });
  const дядя = addPerson(t, { name: "Дядя" });
  const мать = addPerson(t, { name: "Мать" });
  const я = addPerson(t, { name: "Я" });
  const жена = addPerson(t, { name: "Жена" });
  const тёща = addPerson(t, { name: "Тёща" });
  const сын = addPerson(t, { name: "Сын" });
  for (const c of [отец, дядя]) {
    link(t, дед, c);
    link(t, бабка, c);
  }
  link(t, отец, я);
  link(t, мать, я);
  link(t, тёща, жена);
  addPair(t, я, жена);
  link(t, я, сын);
  link(t, жена, сын);

  const after = reducer(s, { type: "hideAbove", id: я });
  const hidden = new Set(after.tree.hidden);
  assert.deepEqual([...hidden].sort(), [дед, бабка, отец, дядя, мать].sort(), "предки, их дети и супруги");
  assert.ok(!hidden.has(я) && !hidden.has(жена) && !hidden.has(сын), "сам, жена и сын остаются");
  assert.ok(!hidden.has(тёща), "родня жены — не мои предки");
  const { pos } = layout(after.tree);
  assert.ok(!pos[дед] && pos[я] && pos[жена] && pos[тёща], "раскладка скрытых не знает");

  const back = reducer(after, { type: "unhideAll" });
  assert.deepEqual(back.tree.hidden, []);
  const undone = reducer(back, { type: "undo" });
  assert.equal(undone.tree.hidden.length, 5, "отмена возвращает скрытие");
  assert.equal(reducer(s, { type: "hideAbove", id: дед }).tree.hidden.length, 0, "у корня предков нет");
});

test("брат или сестра: при известных родителях — их ребёнок, без них — пунктирное родство", () => {
  const s = initialAppState(emptyState());
  const t = s.tree;
  const отец = addPerson(t, { name: "Отец" });
  const мать = addPerson(t, { name: "Мать" });
  const сын = addPerson(t, { name: "Сын" });
  link(t, отец, сын);
  link(t, мать, сын);
  const сНов = reducer(s, { type: "add", spec: { name: "Дочь" }, relation: { mode: "sibling", to: сын } });
  const дочь = сНов.selected as string;
  assert.deepEqual(parentsOf(сНов.tree, дочь).sort(), [отец, мать].sort(), "те же родители");
  assert.equal(сНов.tree.sibs.length, 0, "пунктир не нужен");

  const одиночка = addPerson(сНов.tree, { name: "Одиночка" });
  const s2 = reducer({ ...сНов, tree: сНов.tree }, { type: "add", spec: { name: "Брат Одиночки" }, relation: { mode: "sibling", to: одиночка } });
  assert.equal(s2.tree.sibs.length, 1, "родителей нет — записано родство");
  const брат = s2.selected as string;
  assert.ok(s2.tree.sibs.some((x) => (x.a === одиночка && x.b === брат) || (x.b === одиночка && x.a === брат)));
  const { level, pos } = layout(s2.tree);
  assert.equal(level[одиночка], level[брат], "в одном ряду");
  assert.ok(Math.abs(pos[одиночка].x - pos[брат].x) < 260, "и рядом");

  const s3 = reducer(s2, { type: "unlinkSibling", a: одиночка, b: брат });
  assert.equal(s3.tree.sibs.length, 0);
});
