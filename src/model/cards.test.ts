import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fromFolder } from "../../tools/metrics.ts";
import { synthTree } from "../testing/trees.ts";
import { cardIdOf, cardsToTree, treeToCards, VIEW, type CardSet } from "./cards.ts";
import { initialAppState, reducer } from "./store.ts";
import { normalize } from "./tree.ts";
import type { TreeState } from "./types.ts";

const family: unknown = JSON.parse(readFileSync(new URL("../data/family.json", import.meta.url), "utf8"));

/** What the store holds after a save. */
const files = (set: CardSet): [string, string][] => [...set.cards, [VIEW, set.view]];

/** A save and a read back, the way the app sees it. */
const roundTrip = (s: TreeState): TreeState => normalize(cardsToTree(files(treeToCards(s)), assert.fail));

/** Links carry no order that matters to the tree: compare them as sets. */
const canon = (s: TreeState) => {
  const key = (p: { a: string; b: string }) => [p.a, p.b].sort().join("|");
  return {
    ...s,
    links: s.links.map((l) => l.parent + ">" + l.child).sort(),
    pairs: s.pairs.map(key).sort(),
    sibs: s.sibs.map(key).sort(),
  };
};

const trees = (): [string, TreeState][] => {
  const pinned = normalize(family);
  const ids = Object.keys(pinned.people);
  Object.assign(pinned.people[ids[0]], { fx: 12.5, fy: -40.25 });
  pinned.hidden = [ids[1], ids[2]];
  pinned.timeline = true;
  pinned.gap = 1.5;
  return [
    ["sample", normalize(family)],
    ["sample, pinned and cut", pinned],
    ...[1, 2, 3, 4, 5].map((seed): [string, TreeState] => [`synthetic #${seed}`, normalize(synthTree({ seed, size: 40 + seed * 30 }))]),
  ];
};

for (const [name, s] of trees()) {
  test(`tree -> cards -> tree keeps the ${name} tree`, () => {
    assert.deepEqual(canon(roundTrip(s)), canon(s));
  });

  test(`a second save of the ${name} tree writes the same cards`, () => {
    const once = roundTrip(s);
    assert.deepEqual(files(treeToCards(roundTrip(once))), files(treeToCards(once)));
  });
}

test("cardsToTree: an empty store is no tree, a broken card is reported and skipped", () => {
  assert.equal(cardsToTree(null, assert.fail), null);
  const warned: string[] = [];
  const tree = cardsToTree([["a.json", "{"], ["b.json", '{"name":"B"}']], (w) => warned.push(w));
  assert.deepEqual(Object.keys(tree!.people), ["b"]);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^skipping a\.json: /);
});

test("normalize gives an id the cards cannot keep a new one, links and all, and the cards keep everyone", () => {
  // through JSON: a "__proto__" key of an object literal would be its prototype, not a person
  const raw = JSON.parse(`{
    "people": { "a b": {"name":"Анна"}, "ok": {"name":"Борис"}, "a_b-1": {"name":"Вера"}, "__proto__": {"name":"Глеб"}, "Дарья": {"name":"Дарья"} },
    "links": [{"parent":"a b","child":"ok"}, {"parent":"__proto__","child":"ok"}, {"parent":"toString","child":"ok"}],
    "pairs": [{"a":"a b","b":"__proto__"}],
    "sibs": [{"a":"ok","b":"Дарья"}],
    "hidden": ["a b", "valueOf"]
  }`);
  const s = normalize(raw);
  assert.deepEqual(Object.keys(s.people), ["a_b-2", "ok", "a_b-1", "proto-1", "p-1"], "made of the old id where it can be, never one taken");
  assert.deepEqual(Object.values(s.people).map((p) => p.name), ["Анна", "Борис", "Вера", "Глеб", "Дарья"]);
  assert.equal(s.people["a_b-2"].id, "a_b-2");
  assert.deepEqual(s.links, [{ parent: "a_b-2", child: "ok" }, { parent: "proto-1", child: "ok" }]);
  assert.deepEqual(s.pairs, [{ a: "a_b-2", b: "proto-1" }]);
  assert.deepEqual(s.sibs, [{ a: "ok", b: "p-1" }]);
  assert.deepEqual(s.hidden, ["a_b-2"]);
  assert.equal(Object.getPrototypeOf(s.people), Object.prototype, "no person reached the prototype");
  assert.deepEqual(treeToCards(s).ids, Object.keys(s.people), "the cards keep everyone");
  assert.deepEqual(canon(roundTrip(s)), canon(s));
  assert.deepEqual(normalize(raw), s, "the same tree always gets the same ids");
});

test("a field the app does not know survives read -> normalize -> save; the known fields win a clash", () => {
  const tree = cardsToTree([["a.json", '{"id":"a","name":"Анна","note":"x","source":{"book":3},"born":"1900"}']], assert.fail)!;
  const s = normalize(tree);
  assert.deepEqual(s.people.a.extra, { note: "x", source: { book: 3 } });
  // an edit, the way the app keeps its state and saves it
  const edited = reducer(initialAppState(s), { type: "update", id: "a", patch: { died: "01.02.1980" } }).tree;
  const kept = normalize(JSON.parse(JSON.stringify(edited)));
  assert.deepEqual(kept, edited, "localStorage and a JSON save read back the same");
  const card = JSON.parse(treeToCards(kept).cards[0][1]);
  assert.deepEqual([card.note, card.source, card.died, card.extra], ["x", { book: 3 }, "01.02.1980", undefined]);
  assert.deepEqual(normalize(cardsToTree([["a.json", treeToCards(kept).cards[0][1]]], assert.fail)).people.a.extra, s.people.a.extra);

  const clash = treeToCards({ people: { a: { name: "Анна", extra: { name: "Борис", parents: ["b"], years: "1900", note: "y" } } } });
  assert.deepEqual(JSON.parse(clash.cards[0][1]), { id: "a", name: "Анна", maiden: "", alt: [], born: "", died: "", sex: "u", n: 0, parents: [], spouses: [], siblings: [], note: "y" });

  const odd = treeToCards(normalize(cardsToTree([["a.json", '{"id":"a","name":"Анна","__proto__":{"x":1},"toString":"y"}']], assert.fail)));
  assert.match(odd.cards[0][1], /"__proto__": \{\n\s+"x": 1\n\s+\},\n\s+"toString": "y"/, "names of Object.prototype members are kept as plain fields");
  assert.equal(({} as Record<string, unknown>).x, undefined, "and reach no prototype");

  const old = normalize({ people: { a: { name: "Анна", years: "1900-1980" } } });
  assert.deepEqual([old.people.a.born, old.people.a.died], ["??.??.1900", "??.??.1980"]);
  assert.equal(old.people.a.extra, undefined, "the old \"years\" is read as the dates and dropped");
  assert.ok(Object.values(normalize(family).people).every((p) => !("extra" in p)), "nobody carries an empty extra");
});

/** The metrics reader over a folder with these files, next to the server's reading of them. */
function bothReaders(entries: [string, string][]) {
  const dir = mkdtempSync(join(tmpdir(), "cards-"));
  try {
    for (const [name, text] of entries) writeFileSync(join(dir, name), text);
    return { metrics: fromFolder(dir), server: normalize(cardsToTree(entries, assert.fail)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the metrics reader and the server read a saved tree alike", () => {
  const s = synthTree({ seed: 7, size: 60 });
  const { metrics, server } = bothReaders(files(treeToCards(s)));
  assert.deepEqual(canon(metrics), canon(server));
});

test("the metrics reader reads _view.json: the hidden and the gap count", () => {
  const s = normalize(family);
  s.hidden = [Object.keys(s.people)[0]];
  s.gap = 2;
  const { metrics, server } = bothReaders(files(treeToCards(s)));
  assert.deepEqual([metrics.hidden.length, metrics.gap], [1, 2]);
  assert.deepEqual(canon(metrics), canon(server));
});

test("the metrics reader takes ids from file names and checks them, as the server does", () => {
  const { metrics, server } = bothReaders([
    ["a.json", '{"name":"Анна"}'],
    ["b.json", '{"id":"b c","name":"Борис"}'],
    ["c.json", '{"theme":"dark"}'],
  ]);
  assert.deepEqual(Object.keys(metrics.people), ["a", "b"]);
  assert.deepEqual(canon(metrics), canon(server));
});

test("cardIdOf names exactly the people cardsToTree reads", () => {
  const files: [string, string][] = [
    ["a.json", '{"name":"Анна"}'],
    ["b.json", '{"id":"b2","name":"Борис"}'],
    ["c.json", "{ not json"],
    ["d e.json", "{}"],
    ["f.json", '{"id":"g h"}'],
    ["_notes.json", '{"id":"n"}'],
    [VIEW, '{"hidden":[]}'],
    // JSON that is no person's card: neither a string name nor a string id of its own
    ["settings.json", '{"theme":"dark"}'],
    ["list.json", '["a"]'],
    ["nothing.json", "null"],
    ["count.json", "7"],
    ["text.json", '"a"'],
    ["numbered.json", '{"id":7,"name":null}'],
    // a string name or a string id is enough
    ["k.json", '{"id":7,"name":"Кирилл"}'],
    ["only-id.json", '{"id":"m"}'],
    ["nameless.json", '{"name":""}'],
    // names of Object.prototype members are no ids, in the file name or in the card
    ["constructor.json", '{"name":"Иван"}'],
    ["toString.json", '{"id":"__proto__"}'],
    ["hasOwnProperty.json", '{"id":"valueOf","name":"Ольга"}'],
    ["q.json", '{"id":"isPrototypeOf","name":"Пётр"}'],
  ];
  const read = Object.keys(cardsToTree(files, () => {})!.people).sort();
  const named = files.map(([n, t]) => cardIdOf(n, t)).filter((id) => id !== null).sort();
  assert.deepEqual(named, read);
  assert.deepEqual(read, ["a", "b2", "f", "k", "m", "nameless", "q"]);
});

test("okId refuses every name of an Object.prototype member", () => {
  for (const name of Object.getOwnPropertyNames(Object.prototype)) {
    const tree = cardsToTree([[name + ".json", JSON.stringify({ name: "Иван" })], ["p1.json", JSON.stringify({ id: name, name: "Анна" })]], assert.fail)!;
    assert.deepEqual(Object.keys(tree.people), ["p1"], name);
    assert.equal(cardIdOf(name + ".json", '{"name":"Иван"}'), null, name);
  }
});

test("treeToCards drops ids named after Object.prototype members, and every link to them", () => {
  const person = (name: string) => ({ name, sex: "u", n: 1 });
  const set = treeToCards({
    people: { p1: person("Иван Петрович Орлов"), toString: person("Пётр Иванович Орлов"), constructor: person("Анна Сергеевна Орлова") },
    links: [
      { parent: "p1", child: "toString" },
      { parent: "constructor", child: "p1" },
    ],
    pairs: [{ a: "p1", b: "valueOf" }],
    sibs: [{ a: "toString", b: "p1" }],
    hidden: ["toString", "p1"],
  });
  assert.deepEqual(set.ids, ["p1"]);
  const p1 = JSON.parse(set.cards[0][1]);
  assert.deepEqual([p1.parents, p1.spouses, p1.siblings], [[], [], []]);
  assert.deepEqual(JSON.parse(set.view).hidden, ["p1"]);
});
