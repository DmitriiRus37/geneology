import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fromFolder } from "../../tools/metrics.ts";
import { synthTree } from "../testing/trees.ts";
import { cardsToTree, treeToCards, VIEW, type CardSet } from "./cards.ts";
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

test("known issue: the metrics reader ignores _view.json", () => {
  const s = normalize(family);
  s.hidden = [Object.keys(s.people)[0]];
  s.gap = 2;
  const { metrics, server } = bothReaders(files(treeToCards(s)));
  assert.deepEqual([server.hidden.length, server.gap], [1, 2]);
  assert.deepEqual([metrics.hidden.length, metrics.gap], [0, 1]);
});

test("known issue: the metrics reader takes no id from the file name and no okId check", () => {
  const { metrics, server } = bothReaders([
    ["a.json", '{"name":"Анна"}'],
    ["b.json", '{"id":"b c","name":"Борис"}'],
  ]);
  assert.deepEqual(Object.keys(server.people), ["a", "b"]);
  assert.deepEqual(Object.keys(metrics.people).sort(), ["b c", "undefined"]);
});
