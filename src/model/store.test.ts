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

test("typing into a field takes one undo step, not one per letter", () => {
  const { s, ivan } = start();
  const born = (v: string): Action => ({ type: "update", id: ivan, patch: { born: v }, quiet: true });
  const a = run(s, born("2"), born("20.05"), born("20.05.1902"));
  assert.equal(a.history.length, 1);
  assert.equal(a.tree.people[ivan].born, "20.05.1902");
  // whereas changing the sex is an ordinary change and can be undone
  const b = run(a, { type: "update", id: ivan, patch: { sex: "f" } });
  assert.equal(b.history.length, 2);
  const undone = run(b, { type: "undo" });
  assert.equal(undone.tree.people[ivan].sex, "m");
  assert.equal(run(undone, { type: "undo" }).tree.people[ivan].born, "", "the whole date goes in one undo");
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

/* ------- actions the tests above do not touch, and fixed issues of the model -------
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

test("a silent load clears the undo history: nothing from before it can come back", () => {
  const { s, dad } = family();
  const edited = reducer(s, { type: "remove", id: dad }); // history: [family]
  const fromServer = emptyState();
  addPerson(fromServer, { name: "Вера Николаевна Белкина" });
  const reread = reducer(edited, { type: "load", tree: fromServer, silent: true });
  assert.deepEqual(reread.history, []);
  const undone = reducer(reread, { type: "undo" });
  assert.equal(undone.tree, fromServer, "undo leaves the loaded tree alone");
  assert.equal(undone.notice?.msg.k, "msg.nothingToUndo");
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

test("WEB-8: the gap slider releases every pinned card, and undo brings them back with the old gap", () => {
  const { s, son } = family();
  const next = reducer(s, { type: "setGap", gap: 1.6 });
  assert.equal(next.tree.gap, 1.6);
  assert.equal(pinned(next.tree), 0);
  assert.equal(next.fitSeq, s.fitSeq + 1);
  assert.deepEqual(next.history, [s.tree], "the tree before the release is an undo step");
  const dragged = run(next, { type: "setGap", gap: 1.7 }, { type: "setGap", gap: 1.8 });
  assert.equal(dragged.tree.gap, 1.8);
  assert.equal(dragged.history.length, 1, "with nothing pinned the slider takes no step, however long it is dragged");
  const undone = reducer(dragged, { type: "undo" });
  assert.equal(undone.tree.gap, 1);
  assert.deepEqual([undone.tree.people[son].fx, undone.tree.people[son].fy], [40, 80]);
});

test("WEB-8: switching to years releases every pinned card, and undo brings them back by generations", () => {
  const { s, son } = family();
  const on = reducer(s, { type: "setTimeline", on: true });
  assert.equal(on.tree.timeline, true);
  assert.equal(on.notice?.msg.k, "msg.byYears");
  assert.equal(pinned(on.tree), 0);
  assert.deepEqual(on.history, [s.tree]);
  const off = reducer(on, { type: "setTimeline", on: false });
  assert.equal(off.notice?.msg.k, "msg.byGenerations");
  assert.equal(off.history.length, 1, "nothing was pinned any more, so no step");
  const undone = reducer(on, { type: "undo" });
  assert.equal(undone.tree.timeline, false);
  assert.deepEqual([undone.tree.people[son].fx, undone.tree.people[son].fy], [40, 80]);
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

test("ARC-3: typing is one undo step per field; undo brings back the value from before it, and the step before stays", () => {
  const { s, dad, mom, son } = family();
  const cut = reducer(s, { type: "cut", parent: dad, child: son }); // history: [family]
  const name = (v: string): Action => ({ type: "update", id: son, patch: { name: v }, quiet: true });
  const born = (v: string): Action => ({ type: "update", id: son, patch: { born: v }, quiet: true });
  const typed = run(cut, name("Пётр Иванович Орлов-"), name("Пётр Иванович Орлов-мл"), name("Пётр Иванович Орлов-младший"), born("01"), born("01.01.1950"));
  assert.equal(typed.history.length, 3, "one step for the name, one for the date");
  const once = reducer(typed, { type: "undo" });
  assert.equal(once.tree.people[son].born, "", "the typed date is gone");
  assert.equal(once.tree.people[son].name, "Пётр Иванович Орлов-младший", "the name waits for the next undo");
  const twice = reducer(once, { type: "undo" });
  assert.equal(twice.tree.people[son].name, "Пётр Иванович Орлов", "the name from before the typing");
  assert.deepEqual(parentsOf(twice.tree, son), [mom], "the cut is still there");
  assert.deepEqual(parentsOf(reducer(twice, { type: "undo" }).tree, son).sort(), [dad, mom].sort(), "and is undone on its own");
});

test("any other action ends the typing: the next keystroke in the same field is a new undo step", () => {
  const { s, mom, son } = family();
  const name = (id: string, v: string): Action => ({ type: "update", id, patch: { name: v }, quiet: true });
  const typing = run(s, name(son, "Пётр"));
  assert.notEqual(typing.typing, null);
  assert.equal(reducer(typing, { type: "fit" }).typing, null);
  const again = run(typing, { type: "select", id: mom }, { type: "select", id: son }, name(son, "Пётр И"));
  assert.equal(again.history.length, 2);
  assert.equal(run(again, name(mom, "Анна")).history.length, 3, "another person's field is another step");
  assert.equal(run(again, { type: "fit" }, name(son, "Пётр И")).history.length, 2, "a keystroke that changes nothing takes no step");
});

test("DOM-5: two people who both have parents become siblings by a recorded kinship, and nobody's parents change", () => {
  const { s, dad, mom, son } = family();
  const tree = structuredClone(s.tree);
  const other = addPerson(tree, { name: "Сергей Николаевич Волков" });
  const hisDad = addPerson(tree, { name: "Николай Андреевич Волков" });
  link(tree, hisDad, other);
  const next = reducer(initialAppState(tree), { type: "connect", mode: "sibling", from: son, to: other });
  assert.deepEqual(parentsOf(next.tree, other), [hisDad], "his own father only");
  assert.deepEqual(parentsOf(next.tree, son).sort(), [dad, mom].sort());
  assert.deepEqual(next.tree.sibs, [{ a: son, b: other }]);
  assert.equal(next.notice?.msg.k, "msg.siblingOf");
});

test("linked as siblings, the one without parents gets the other's, whichever way the link is drawn", () => {
  const { s, dad, mom, son } = family();
  const tree = structuredClone(s.tree);
  const loner = addPerson(tree, { name: "Ольга Ивановна Орлова" });
  for (const [from, to] of [[son, loner], [loner, son]]) {
    const next = reducer(initialAppState(tree), { type: "connect", mode: "sibling", from, to });
    assert.deepEqual(parentsOf(next.tree, loner).sort(), [dad, mom].sort(), from === son ? "from the son" : "from her");
    assert.deepEqual(next.tree.sibs, [], "ordinary arrows, no dashed line");
  }
});

test("DOM-V1: a marriage within one line, up or down, is refused, and it says why", () => {
  const tree = emptyState();
  const father = addPerson(tree, { name: "Иван Петрович Орлов" });
  const daughter = addPerson(tree, { name: "Анна Ивановна Орлова" });
  const grandson = addPerson(tree, { name: "Пётр Сергеевич Волков" });
  const granddaughter = addPerson(tree, { name: "Мария Сергеевна Волкова" });
  link(tree, father, daughter);
  link(tree, daughter, grandson);
  link(tree, daughter, granddaughter);
  const s = initialAppState(tree);
  for (const [from, to] of [[father, daughter], [granddaughter, father], [daughter, grandson]]) {
    const next = reducer(s, { type: "connect", mode: "spouse", from, to });
    assert.deepEqual(next.tree.pairs, [], `${tree.people[from].name} and ${tree.people[to].name}`);
    assert.equal(next.notice?.msg.k, "reason.lineage");
    assert.equal(next.history.length, 0);
  }
  const why = reducer(s, { type: "connect", mode: "spouse", from: father, to: daughter }).notice!.msg;
  assert.equal(render("en", why), "They are already parent and descendant: Иван Петрович Орлов and Анна Ивановна Орлова");
  assert.equal(addPair(tree, grandson, granddaughter).ok, true, "a brother and a sister are not one line up or down: the rule stops there");
});

test("a link that would make spouses parent and descendant is refused, and it says why", () => {
  const tree = emptyState();
  const husband = addPerson(tree, { name: "Иван Петрович Орлов" });
  const wife = addPerson(tree, { name: "Анна Сергеевна Орлова" });
  const herFather = addPerson(tree, { name: "Сергей Андреевич Волков" });
  assert.equal(addPair(tree, husband, wife).ok, true);
  assert.equal(link(tree, herFather, wife).ok, true);
  const direct = link(tree, husband, wife);
  assert.equal(direct.ok, false);
  assert.equal(!direct.ok && direct.reason.k, "reason.spouseLineage");
  assert.equal(link(tree, husband, herFather).ok, false, "over her father: he would be her grandfather");
  assert.deepEqual(tree.links, [{ parent: herFather, child: wife }], "nothing was linked");
  const why = !direct.ok ? direct.reason : null;
  assert.equal(render("en", why!), "That would make the spouses Иван Петрович Орлов and Анна Сергеевна Орлова parent and descendant");
  const child = addPerson(tree, { name: "Пётр Иванович Орлов" });
  assert.equal(link(tree, husband, child).ok, true, "their own child is fine");
});

test("DOM-3: a name the rules do not know leaves the sex unknown, and the marriage goes through", () => {
  const tree = emptyState();
  const john = addPerson(tree, { name: "John Smith" });
  const mary = addPerson(tree, { name: "Mary Smith" });
  assert.deepEqual([tree.people[john].sex, tree.people[mary].sex], ["u", "u"]);
  const next = reducer(initialAppState(tree), { type: "connect", mode: "spouse", from: john, to: mary });
  assert.deepEqual(partnersOf(next.tree, john), [mary]);
  assert.equal(next.notice?.msg.k, "msg.marriage");
});

test("DOM-4: ids named after Object.prototype members get new ones, links and all, and the layout stands", () => {
  const person = (id: string, name: string, sex: string) => ({ id, name, sex, n: 1 });
  const tree = normalize({
    people: { constructor: person("constructor", "Иван Петрович Орлов", "m"), toString: person("toString", "Пётр Иванович Орлов", "m") },
    links: [{ parent: "constructor", child: "toString" }],
  });
  assert.deepEqual(Object.keys(tree.people), ["constructor-1", "toString-1"]);
  assert.deepEqual(tree.links, [{ parent: "constructor-1", child: "toString-1" }]);
  for (const timeline of [false, true]) {
    const { pos, level } = layout({ ...tree, timeline }, nodeCards());
    assert.deepEqual(Object.keys(pos).sort(), ["constructor-1", "toString-1"]);
    if (!timeline) assert.equal(level["toString-1"] - level["constructor-1"], 1);
  }
});

test("DOM-8: normalize takes containers of the wrong type for empty ones", () => {
  const people = { a: { name: "Иван Петрович Орлов" }, b: { name: "Анна Сергеевна Орлова" } };
  for (const bad of [{}, { a: "a", b: "b" }, "ab", 7, null, true]) {
    const s = normalize({ people, links: bad, pairs: bad, sibs: bad, hidden: bad });
    assert.deepEqual([s.links, s.pairs, s.sibs, s.hidden], [[], [], [], []], JSON.stringify(bad));
    assert.deepEqual(Object.keys(s.people), ["a", "b"]);
  }
  for (const bad of [[], [{ name: "Анна" }], "ab", 7, null]) assert.deepEqual(normalize({ people: bad }).people, {}, JSON.stringify(bad));
  for (const bad of ["a tree", 7, null, [], [{ people: people }]]) assert.deepEqual(normalize(bad), emptyState(), JSON.stringify(bad));
  const odd = normalize({ people: { a: "Анна", b: null }, links: [null, "a>b", 7, { parent: 1, child: 2 }] });
  assert.deepEqual(Object.keys(odd.people), ["a", "b"], "a person who is not an object is still somebody");
  assert.deepEqual(odd.links, []);
});

test("normalize keeps a link, a marriage and a siblinghood written twice once", () => {
  const s = normalize({
    people: {
      a: { name: "Иван Петрович Орлов" },
      b: { name: "Анна Сергеевна Орлова" },
      c: { name: "Пётр Иванович Орлов" },
      d: { name: "Ольга Петровна Волкова" },
    },
    links: [{ parent: "a", child: "c" }, { parent: "a", child: "c" }, { parent: "b", child: "c" }],
    pairs: [{ a: "a", b: "b" }, { a: "b", b: "a" }, { a: "a", b: "b" }],
    sibs: [{ a: "c", b: "d" }, { a: "d", b: "c" }],
  });
  assert.deepEqual(s.links, [{ parent: "a", child: "c" }, { parent: "b", child: "c" }]);
  assert.deepEqual(s.pairs, [{ a: "a", b: "b" }]);
  assert.deepEqual(s.sibs, [{ a: "c", b: "d" }]);
});
