import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../i18n.ts";
import { layout } from "../layout/layout.ts";
import { initialAppState, reducer, type Action, type AppState } from "./store.ts";
import { addPair, addPerson, childrenOf, link, parentsOf, partnersOf } from "./tree.ts";
import { emptyState } from "./types.ts";

function start(): { s: AppState; ivan: string; anna: string } {
  const tree = emptyState();
  const ivan = addPerson(tree, { name: "Иван Егорович Якунин" });
  const anna = addPerson(tree, { name: "Анна Фёдоровна Якунина" });
  return { s: initialAppState(tree), ivan, anna };
}

const run = (s: AppState, ...actions: Action[]): AppState => actions.reduce(reducer, s);

test("adding a child with an arrow: the link, the selection and the sex from the name", () => {
  const { s, ivan } = start();
  const next = run(s, { type: "add", spec: { name: "Мария Ивановна Якунина" }, relation: { mode: "child", to: ivan } });
  const id = next.selected;
  assert.ok(id, "the new person is selected straight away");
  assert.equal(next.tree.people[id].sex, "f");
  assert.deepEqual(childrenOf(next.tree, ivan), [id]);
  assert.deepEqual(parentsOf(next.tree, id), [ivan]);
});

test("adding does not recut the view, it only brings the card into frame", () => {
  const { s, ivan } = start();
  const next = run(s, { type: "add", spec: { name: "Пётр" }, relation: { mode: "child", to: ivan } });
  assert.equal(next.fitSeq, s.fitSeq, "the canvas zoom and offset stay as they were");
  assert.equal(next.focus?.id, next.selected);
});

test("a parent is added with the same button, the link pointing the other way", () => {
  const { s, ivan } = start();
  const next = run(s, { type: "add", spec: { name: "Егор Якунин" }, relation: { mode: "parent", to: ivan } });
  assert.deepEqual(parentsOf(next.tree, ivan), [next.selected]);
});

test("a spouse is added as a marriage, not as a parent link", () => {
  const { s, ivan } = start();
  const next = run(s, { type: "add", spec: { name: "Анна" }, relation: { mode: "spouse", to: ivan } });
  assert.deepEqual(partnersOf(next.tree, ivan), [next.selected]);
  assert.equal(next.tree.links.length, 0);
});

test("a loop is not created, and it says why", () => {
  const { s, ivan } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: ivan } });
  const daughter = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: daughter, to: ivan });
  assert.equal(b.tree.links.length, a.tree.links.length, "the link was not added");
  assert.match(render("ru", b.notice!.msg), /петля/);
  assert.match(render("en", b.notice!.msg), /loop/);
});

test("two parents of one child form a single family", () => {
  const { s, ivan, anna } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: ivan } });
  const daughter = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: anna, to: daughter });
  assert.deepEqual(parentsOf(b.tree, daughter).sort(), [ivan, anna].sort());
});

test("undo brings back the previous state", () => {
  const { s, ivan } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: ivan } });
  const b = run(a, { type: "undo" });
  assert.equal(Object.keys(b.tree.people).length, 2);
  assert.equal(b.selected, null);
  assert.equal(render("ru", run(s, { type: "undo" }).notice!.msg), "Отменять нечего");
});

test("editing fields does not clutter the undo history", () => {
  const { s, ivan } = start();
  const a = run(
    s,
    { type: "update", id: ivan, patch: { born: "20.05.1902" }, quiet: true },
    { type: "update", id: ivan, patch: { born: "20.05.1902" }, quiet: true },
  );
  assert.equal(a.history.length, 0);
  assert.equal(a.tree.people[ivan].born, "20.05.1902");
  // whereas changing the sex is an ordinary change and can be undone
  const b = run(a, { type: "update", id: ivan, patch: { sex: "f" } });
  assert.equal(b.history.length, 1);
  assert.equal(run(b, { type: "undo" }).tree.people[ivan].sex, "m");
});

test("deleting a person removes their links and clears the selection", () => {
  const { s, ivan } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: ivan } });
  const daughter = a.selected as string;
  const b = run(a, { type: "remove", id: daughter });
  assert.equal(b.selected, null);
  assert.equal(b.tree.links.length, 0);
  assert.equal(Object.keys(b.tree.people).length, 2);
});

test("one link can be removed without touching the rest", () => {
  const { s, ivan, anna } = start();
  const a = run(s, { type: "add", spec: { name: "Мария" }, relation: { mode: "child", to: ivan } });
  const daughter = a.selected as string;
  const b = run(a, { type: "connect", mode: "child", from: anna, to: daughter }, { type: "cut", parent: ivan, child: daughter });
  assert.deepEqual(parentsOf(b.tree, daughter), [anna]);
});

test("a drag is remembered, and \"Rearrange\" releases it", () => {
  const { s, ivan } = start();
  const a = run(s, { type: "pin", id: ivan, x: 100, y: 200 });
  assert.equal(a.tree.people[ivan].fx, 100);
  const b = run(a, { type: "rearrange" });
  assert.equal(b.tree.people[ivan].fx, undefined);
  assert.equal(b.fitSeq, a.fitSeq + 1, "after \"Rearrange\" the tree is fitted to the screen");
});

test("clearing removes everyone, but it can be undone", () => {
  const { s } = start();
  const a = run(s, { type: "wipe" });
  assert.deepEqual(a.tree.people, {});
  assert.equal(Object.keys(run(a, { type: "undo" }).tree.people).length, 2);
});

test("\"Hide ancestors\" cuts the tree upwards, \"Show everyone\" brings it back", () => {
  const s = initialAppState(emptyState());
  const t = s.tree;
  const grandad = addPerson(t, { name: "Дед" });
  const grandma = addPerson(t, { name: "Бабка" });
  const father = addPerson(t, { name: "Отец" });
  const uncle = addPerson(t, { name: "Дядя" });
  const mother = addPerson(t, { name: "Мать" });
  const me = addPerson(t, { name: "Я" });
  const wife = addPerson(t, { name: "Жена" });
  const wifesMother = addPerson(t, { name: "Тёща" });
  const son = addPerson(t, { name: "Сын" });
  for (const c of [father, uncle]) {
    link(t, grandad, c);
    link(t, grandma, c);
  }
  link(t, father, me);
  link(t, mother, me);
  link(t, wifesMother, wife);
  addPair(t, me, wife);
  link(t, me, son);
  link(t, wife, son);

  const after = reducer(s, { type: "hideAbove", id: me });
  const hidden = new Set(after.tree.hidden);
  assert.deepEqual([...hidden].sort(), [grandad, grandma, father, uncle, mother].sort(), "the ancestors, their children and their spouses");
  assert.ok(!hidden.has(me) && !hidden.has(wife) && !hidden.has(son), "the person themselves, the wife and the son stay");
  assert.ok(!hidden.has(wifesMother), "the wife's kin are not my ancestors");
  const { pos } = layout(after.tree);
  assert.ok(!pos[grandad] && pos[me] && pos[wife] && pos[wifesMother], "the layout knows nothing of the hidden");

  const back = reducer(after, { type: "unhideAll" });
  assert.deepEqual(back.tree.hidden, []);
  const undone = reducer(back, { type: "undo" });
  assert.equal(undone.tree.hidden.length, 5, "undo brings the hiding back");
  assert.equal(reducer(s, { type: "hideAbove", id: grandad }).tree.hidden.length, 0, "the root has no ancestors");
});

test("a sibling: with parents known they become their child, without them a dashed kinship", () => {
  const s = initialAppState(emptyState());
  const t = s.tree;
  const father = addPerson(t, { name: "Отец" });
  const mother = addPerson(t, { name: "Мать" });
  const son = addPerson(t, { name: "Сын" });
  link(t, father, son);
  link(t, mother, son);
  const withNew = reducer(s, { type: "add", spec: { name: "Дочь" }, relation: { mode: "sibling", to: son } });
  const daughter = withNew.selected as string;
  assert.deepEqual(parentsOf(withNew.tree, daughter).sort(), [father, mother].sort(), "the same parents");
  assert.equal(withNew.tree.sibs.length, 0, "no dashed line is needed");

  const loner = addPerson(withNew.tree, { name: "Одиночка" });
  const s2 = reducer({ ...withNew, tree: withNew.tree }, { type: "add", spec: { name: "Брат Одиночки" }, relation: { mode: "sibling", to: loner } });
  assert.equal(s2.tree.sibs.length, 1, "no parents, so the kinship itself is recorded");
  const brother = s2.selected as string;
  assert.ok(s2.tree.sibs.some((x) => (x.a === loner && x.b === brother) || (x.b === loner && x.a === brother)));
  const { level, pos } = layout(s2.tree);
  assert.equal(level[loner], level[brother], "in the same row");
  assert.ok(Math.abs(pos[loner].x - pos[brother].x) < 260, "and side by side");

  const s3 = reducer(s2, { type: "unlinkSibling", a: loner, b: brother });
  assert.equal(s3.tree.sibs.length, 0);
});
