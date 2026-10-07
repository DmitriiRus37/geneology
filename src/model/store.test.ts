import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../i18n.ts";
import { layout } from "../layout/layout.ts";
import { initialAppState, reducer, type Action, type AppState } from "./store.ts";
import { addPair, addPerson, addSibling, childrenOf, link, normalize, parentsOf, partnersOf } from "./tree.ts";
import { emptyState, type TreeState } from "./types.ts";
import { nodeCards } from "../testing/cards.ts";

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

test("clearing leaves nothing pointing at people who are gone", () => {
  const t = emptyState();
  const mother = addPerson(t, { name: "Мать" });
  const one = addPerson(t, { name: "Первая" });
  const two = addPerson(t, { name: "Вторая" });
  link(t, mother, one);
  addSibling(t, one, two); // a dashed kinship, with no shared parents
  const s = reducer(initialAppState(t), { type: "hideAbove", id: one });
  assert.ok(s.tree.sibs.length && s.tree.hidden.length, "there is something to lose");

  const cleared = reducer(s, { type: "wipe" });
  assert.deepEqual(cleared.tree.people, {});
  assert.deepEqual(cleared.tree.links, [], "no links left");
  assert.deepEqual(cleared.tree.pairs, [], "no couples left");
  assert.deepEqual(cleared.tree.sibs, [], "no dashed kinships left");
  assert.deepEqual(cleared.tree.hidden, [], "nobody left hidden");
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
  const { pos } = layout(after.tree, nodeCards());
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
  const { level, pos } = layout(s2.tree, nodeCards());
  assert.equal(level[loner], level[brother], "in the same row");
  assert.ok(Math.abs(pos[loner].x - pos[brother].x) < 260, "and side by side");

  const s3 = reducer(s2, { type: "unlinkSibling", a: loner, b: brother });
  assert.equal(s3.tree.sibs.length, 0);
});

/* ------- actions the tests above do not touch, and known issues of the model -------
   The names below are made up. */

/** A father, a mother and their son, with the son's card pinned where it was dragged. */
function family(): { s: AppState; dad: string; mom: string; son: string } {
  const tree = emptyState();
  const dad = addPerson(tree, { name: "Иван Петрович Орлов" });
  const mom = addPerson(tree, { name: "Анна Сергеевна Орлова" });
  const son = addPerson(tree, { name: "Пётр Иванович Орлов" });
  addPair(tree, dad, mom);
  link(tree, dad, son);
  link(tree, mom, son);
  tree.people[son].fx = 40;
  tree.people[son].fy = 80;
  return { s: initialAppState(tree), dad, mom, son };
}

const pinned = (t: TreeState) => Object.values(t.people).filter((p) => p.fx !== undefined || p.fy !== undefined).length;

test("load replaces the tree, drops the selection, remembers the old tree for undo and asks for a fit", () => {
  const { s, son } = family();
  const selected = reducer(s, { type: "select", id: son });
  const other = emptyState();
  addPerson(other, { name: "Вера Николаевна Белкина" });
  const next = reducer(selected, { type: "load", tree: other, notice: { k: "notice.loaded" } });
  assert.equal(next.tree, other);
  assert.equal(next.selected, null);
  assert.deepEqual(next.history, [s.tree]);
  assert.equal(next.fitSeq, s.fitSeq + 1);
  assert.equal(next.notice?.msg.k, "notice.loaded");
  assert.equal(reducer(next, { type: "undo" }).tree, s.tree, "the tree from before the load comes back");
});

test("known issue DOM-2: a silent load keeps the old undo history, so undo brings back the tree from before it", () => {
  const { s, dad } = family();
  const edited = reducer(s, { type: "remove", id: dad }); // history: [family]
  const fromServer = emptyState();
  addPerson(fromServer, { name: "Вера Николаевна Белкина" });
  const reread = reducer(edited, { type: "load", tree: fromServer, silent: true });
  assert.deepEqual(reread.history, [s.tree], "the silent load pushed nothing and kept the old history");
  assert.equal(reducer(reread, { type: "undo" }).tree, s.tree, "undo skips over the loaded tree to one from before it");
});

test("select takes the id it is given", () => {
  const { s, mom } = family();
  assert.equal(reducer(s, { type: "select", id: mom }).selected, mom);
  assert.equal(reducer(s, { type: "select", id: null }).selected, null);
});

test("unlinking a child's parents drops both arrows and releases the pinned cards", () => {
  const { s, son } = family();
  const next = reducer(s, { type: "unlinkParents", id: son });
  assert.deepEqual(parentsOf(next.tree, son), []);
  assert.equal(next.notice?.msg.k, "msg.parentsRemoved");
  assert.equal(pinned(next.tree), 0);
  assert.equal(next.history.length, 1);
  assert.equal(reducer(next, { type: "unlinkParents", id: son }), next, "with no parents left there is nothing to change");
});

test("unlinking a couple removes the marriage", () => {
  const { s, dad, mom } = family();
  const next = reducer(s, { type: "unlinkPartner", a: mom, b: dad });
  assert.deepEqual(partnersOf(next.tree, dad), []);
  assert.equal(next.notice?.msg.k, "msg.marriageRemoved");
  assert.equal(pinned(next.tree), 0);
});

test("known issue WEB-8: the gap slider releases every pinned card and leaves nothing to undo", () => {
  const { s } = family();
  const next = reducer(s, { type: "setGap", gap: 1.6 });
  assert.equal(next.tree.gap, 1.6);
  assert.equal(pinned(next.tree), 0);
  assert.equal(next.fitSeq, s.fitSeq + 1);
  assert.deepEqual(next.history, [], "no snapshot: the positions cannot be brought back");
});

test("known issue WEB-8: switching to years releases every pinned card and leaves nothing to undo", () => {
  const { s } = family();
  const on = reducer(s, { type: "setTimeline", on: true });
  assert.equal(on.tree.timeline, true);
  assert.equal(on.notice?.msg.k, "msg.byYears");
  assert.equal(pinned(on.tree), 0);
  assert.deepEqual(on.history, []);
  assert.equal(reducer(on, { type: "setTimeline", on: false }).notice?.msg.k, "msg.byGenerations");
});

test("a notice is shown with a new number each time; fit only asks for a fit", () => {
  const { s } = family();
  const a = reducer(s, { type: "notice", msg: { k: "notice.empty" } });
  const b = reducer(a, { type: "notice", msg: { k: "notice.empty" } });
  assert.equal(a.notice?.msg.k, "notice.empty");
  assert.equal(b.notice!.seq, a.notice!.seq + 1, "the same text twice is still shown twice");
  const fit = reducer(s, { type: "fit" });
  assert.equal(fit.fitSeq, s.fitSeq + 1);
  assert.equal(fit.tree, s.tree);
});

test("undo keeps at most sixty steps", () => {
  let { s, son } = family();
  for (let i = 0; i < 65; i++) s = reducer(s, { type: "pin", id: son, x: i, y: i });
  assert.equal(s.history.length, 60);
});

test("known issue ARC-3: field edits take no snapshot, and undo throws them away with the step before", () => {
  const { s, dad, son } = family();
  const cut = reducer(s, { type: "cut", parent: dad, child: son }); // history: [family]
  const typed = reducer(cut, { type: "update", id: son, patch: { name: "Пётр Иванович Орлов-младший", born: "01.01.1950" }, quiet: true });
  assert.equal(typed.history.length, 1, "the typing added no step");
  const undone = reducer(typed, { type: "undo" });
  assert.equal(undone.tree.people[son].name, "Пётр Иванович Орлов", "the typed name is gone");
  assert.equal(undone.tree.people[son].born, "", "and the typed date");
});

test("known issue DOM-5: linking two people as siblings gives the second all of the first one's parents", () => {
  const { s, dad, mom, son } = family();
  const tree = structuredClone(s.tree);
  const other = addPerson(tree, { name: "Сергей Николаевич Волков" });
  const hisDad = addPerson(tree, { name: "Николай Андреевич Волков" });
  link(tree, hisDad, other);
  const next = reducer(initialAppState(tree), { type: "connect", mode: "sibling", from: son, to: other });
  assert.deepEqual(parentsOf(next.tree, other).sort(), [dad, hisDad, mom].sort(), "three parents now");
});

test("known issue DOM-V1: a marriage between a person and their own child is accepted", () => {
  const tree = emptyState();
  const father = addPerson(tree, { name: "Иван Петрович Орлов" });
  const daughter = addPerson(tree, { name: "Анна Ивановна Орлова" });
  link(tree, father, daughter);
  const next = reducer(initialAppState(tree), { type: "connect", mode: "spouse", from: father, to: daughter });
  assert.deepEqual(partnersOf(next.tree, father), [daughter]);
});

test("known issue DOM-3: a name the rules do not know is taken for a man, and then a marriage is refused", () => {
  const tree = emptyState();
  const john = addPerson(tree, { name: "John Smith" });
  const mary = addPerson(tree, { name: "Mary Smith" });
  assert.equal(tree.people[mary].sex, "m");
  const next = reducer(initialAppState(tree), { type: "connect", mode: "spouse", from: john, to: mary });
  assert.deepEqual(next.tree.pairs, [], "two men, as far as the model knows");
  assert.equal(next.notice?.msg.k, "reason.bothMen");
});

test("known issue DOM-4: ids named after Object.prototype members bring the layout down", () => {
  const person = (id: string, name: string, sex: string) => ({ id, name, sex, n: 1 });
  const tree = normalize({
    people: { constructor: person("constructor", "Иван Петрович Орлов", "m"), toString: person("toString", "Пётр Иванович Орлов", "m") },
    links: [{ parent: "constructor", child: "toString" }],
  });
  assert.throws(() => layout(tree, nodeCards()));
});

test("known issue DOM-8: normalize throws on containers of the wrong type", () => {
  assert.throws(() => normalize({ people: {}, links: {} }));
  assert.throws(() => normalize({ people: {}, pairs: "ab" }));
});
