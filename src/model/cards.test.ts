import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fromFolder } from "../../tools/metrics.ts";
import { synthTree } from "../testing/trees.ts";
import { cardIdOf, cardsToTree, treeToCards, VIEW, type CardSet } from "./cards.ts";
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

test("known issue: normalize accepts an id that the cards silently drop", () => {
  const s = normalize({ people: { "a b": { name: "Анна" }, ok: { name: "Борис" } } });
  assert.deepEqual(Object.keys(s.people), ["a b", "ok"]);
  assert.deepEqual(treeToCards(s).ids, ["ok"]);
});

test("known issue: the cards keep unknown fields, normalize drops them, the next save loses them", () => {
  const tree = cardsToTree([["a.json", '{"id":"a","name":"Анна","note":"x"}']], assert.fail)!;
  assert.equal(tree.people.a.note, "x");
  assert.equal("note" in normalize(tree).people.a, false);
  assert.doesNotMatch(treeToCards(normalize(tree)).cards[0][1], /note/);
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
