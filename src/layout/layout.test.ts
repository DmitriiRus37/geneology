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

test("on the real family tree the cards do not collide", () => {
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

test("there is no NaN in the layout", () => {
  const { pos, level } = layout(real());
  for (const id of Object.keys(pos)) {
    const b = pos[id];
    assert.ok(finite(b.x) && finite(b.y) && finite(b.w) && finite(b.h), "coordinates of " + id);
    assert.ok(Number.isInteger(level[id]) && level[id] >= 0, "generation of " + id);
  }
  const b = bboxOf(pos);
  assert.ok(b && finite(b.w) && finite(b.h) && b.w > 0 && b.h > 0);
});

test("there is no NaN in the link geometry and every arrow is drawn", () => {
  const s = real();
  const { pos, level } = layout(s);
  const items = computeEdges(s, pos, level, null);
  assert.ok(items.length > 0);
  // a child of two parents gets one arrow: it leaves the family's shared point
  const arrows = items.filter((i) => i.kind === "path" && i.arrow).length;
  assert.equal(arrows, new Set(s.links.map((l) => l.child)).size, "one arrow per child");
  for (const it of items) {
    if (it.kind === "path") assert.ok(!/NaN|Infinity|undefined/.test(it.d), it.d);
    else assert.ok(finite(it.x) && finite(it.y));
  }
});

test("a child is always below its parent, and spouses are level", () => {
  const s = real();
  const { level } = layout(s);
  for (const l of s.links) assert.ok(level[l.child] > level[l.parent], l.parent + " → " + l.child);
  for (const p of s.pairs) assert.equal(level[p.a], level[p.b]);
});

test("the by-years mode: everyone has a year, and the estimates are marked", () => {
  const s = real();
  s.timeline = true;
  const { tl, pos } = layout(s);
  assert.ok(tl);
  for (const id of Object.keys(s.people)) {
    assert.ok(Number.isFinite(tl.year[id]), "year of " + id);
    assert.ok(Number.isFinite(pos[id].y));
  }
  const known = Object.keys(s.people).filter((id) => !tl.est[id]);
  assert.ok(known.length > 20, "for most of them the year is taken from the card rather than estimated");
  assert.ok(tl.min >= 1800 && tl.max <= 2100, "the scale of years stays within reason");
});

test("a drag pins the card in place", () => {
  const s = real();
  const id = Object.keys(s.people)[0];
  s.people[id].fx = 1234;
  s.people[id].fy = 567;
  const { pos } = layout(s);
  assert.equal(pos[id].x, 1234);
  assert.equal(pos[id].y, 567);
});

test("an empty tree does not bring the layout down", () => {
  const { pos, tl } = layout(normalize({ people: {}, links: [], pairs: [], timeline: true }));
  assert.deepEqual(pos, {});
  assert.equal(tl, null);
  assert.equal(bboxOf(pos), null);
});

test("those not yet placed stand below the tree, not past its right edge", () => {
  const s = real();
  const father = addPerson(s, { name: "Пермяков Александр Владимирович" });
  const mother = addPerson(s, { name: "Пермякова Анна Валерьевна" });
  addPair(s, father, mother);
  const { pos, lonePlate } = layout(s);

  // the original data already has unplaced people — we compare against those in the tree
  const inTree = new Set(s.links.flatMap((l) => [l.parent, l.child]));
  const kin = [...inTree];
  const nearest = Math.min(...kin.map((id) => Math.abs(pos[id].x - pos[father].x)));
  assert.ok(nearest < 400, "horizontally beside the tree rather than past its edge: " + Math.round(nearest));

  const bottom = Math.max(...kin.map((id) => pos[id].y + pos[id].h));
  assert.ok(pos[father].y > bottom, "the block lies below the tree");
  assert.ok(lonePlate && pos[father].y > lonePlate.y, "the block's caption stands above it");

  // the spouses stay side by side
  assert.ok(Math.abs(pos[father].x - pos[mother].x) < NODE_W * 1.6);
});

test("a linked parent stands right by their child rather than in the common block", () => {
  const s = real();
  const daughter = Object.keys(s.people).find((id) => s.people[id].name.includes("Екатерина Александровна"))!;
  const father = addPerson(s, { name: "Пермяков Александр Владимирович" });
  assert.equal(link(s, father, daughter).ok, true);
  const { pos, lonePlate } = layout(s);
  // the daughter now has two parents and stands between them
  const other = parentsOf(s, daughter).find((q) => q !== father)!;
  const leftX = Math.min(pos[father].x, pos[other].x);
  const rightX = Math.max(pos[father].x, pos[other].x);
  assert.ok(pos[daughter].x >= leftX - 1 && pos[daughter].x <= rightX + 1, "the daughter is between her parents");
  assert.ok(pos[father].y < pos[daughter].y, "and below them");
  assert.ok(!lonePlate || pos[father].y < lonePlate.y, "he is in the tree, not in the block of the unplaced");
});

test("by years: a spouse with a known date sets the year for the other", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;

  const alexey = id("Алексей Иванович Якунин"); // 28.02.1932
  const alina = id("Алина Александровна"); // дат нет, но у них общие дети
  const { tl, pos } = layout(s);
  assert.ok(tl);

  assert.equal(tl.year[alexey], 1932);
  assert.equal(tl.year[alina], 1932, "the wife stood level with her husband rather than by the average of her kin");
  assert.ok(tl.est[alina], "the year is marked as an estimate");
  const centreOf = (k: string) => pos[k].y + pos[k].h / 2;
  assert.ok(Math.abs(centreOf(alexey) - centreOf(alina)) < 0.6, "and on the canvas at the same height");
});

test("by years: the same rule works for a recorded marriage too", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;
  const lidia = id("Лидия Лесняк");
  const leonid = id("Леонид Иванович"); // 16.10.1957, в браке с Лидией
  s.people[lidia].born = ""; // her date was forgotten
  const { tl } = layout(s);
  assert.equal(tl!.year[leonid], 1957);
  assert.equal(tl!.year[lidia], 1957, "they have no shared children, but they are a couple — so the year is the same");
});

test("by years: one's own date always outweighs a spouse's", () => {
  const s = real();
  s.timeline = true;
  const id = (part: string) => Object.keys(s.people).find((k) => s.people[k].name.includes(part))!;
  const { tl } = layout(s);
  const anna = id("Анна Фёдоровна"); // 1904, жена Ивана Егоровича 1902
  assert.equal(tl!.year[anna], 1904);
  assert.ok(!tl!.est[anna]);
});

/** The cards' rectangles — we check against them that the lines touch nobody. */
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

test("the crossing check itself works", () => {
  const rect: Rect = { x1: 0, y1: 0, x2: 100, y2: 50 };
  assert.ok(hitsCard([{ x: 50, y: -20 }, { x: 50, y: 70 }], [rect]), "a line straight through is a crossing");
  assert.equal(hitsCard([{ x: 50, y: -20 }, { x: 50, y: -5 }], [rect]), null, "a line above is not");
  assert.equal(hitsCard([{ x: 120, y: -20 }, { x: 120, y: 70 }], [rect]), null, "a line to the side is not");
});

test("not one link passes through a card", () => {
  assert.deepEqual(crossings(real()).map((i) => i.d), []);
});

test("a marriage carried someone down — their kin move with them instead of staying at the head of the tree", () => {
  // exactly the reported case: he married a girl from a deeper branch. Her parents used
  // to stay right at the top, four rows away from their daughter.
  const s = real();
  const dmitry = Object.keys(s.people).find((id) => s.people[id].name.includes("Дмитрий Сергеевич"))!;
  const deepest = Object.entries(layout(s).level).sort((a, b) => b[1] - a[1])[0][0];
  const wife = addPerson(s, { name: "Пермякова Анастасия Александровна" });
  const wifesFather = addPerson(s, { name: "Пермяков Александр Владимирович" });
  assert.equal(link(s, deepest, wife).ok, true);
  assert.equal(link(s, wifesFather, wife).ok, true);
  addPair(s, dmitry, wife);

  const { level, pos } = layout(s);
  assert.equal(level[wife] - level[wifesFather], 1, "the wife's father is exactly one row above his daughter");
  assert.ok(pos[wifesFather].y < pos[wife].y, "and above her on the canvas");
  assert.deepEqual(crossings(s).map((i) => i.d), []);
});

test("every parent is exactly one row above their children", () => {
  const s = real();
  const { level } = layout(s);
  const farApart = s.links
    .filter((l) => level[l.child] - level[l.parent] !== 1)
    .map((l) => s.people[l.parent].name + " → " + s.people[l.child].name);
  assert.deepEqual(farApart, []);
});

test("a card was dragged to an empty spot — the lines to it touched nobody", () => {
  const s = real();
  const id = Object.keys(s.people).find((k) => s.people[k].name.includes("Екатерина Александровна"))!;
  const b = bboxOf(layout(s).pos)!;
  s.people[id].fx = b.x1 - 420; // to the left of the whole tree, where it is empty
  s.people[id].fy = b.y2 + 60; // and below the parents: going up, the line would leave their own card
  assert.deepEqual(crossings(s).map((i) => i.d), []);
});

test("an only child stands exactly under its parents — the line runs vertically", () => {
  for (const byYears of [false, true]) onlyChildrenStandStraight({ ...real(), timeline: byYears }, byYears);
});

/**
 * By years the cards are spread sideways so people of the same age do not land on
 * top of each other, and putting them back used to be judged by the full gap: a
 * child with fifty pixels of clear air beside it was still refused its place under
 * its parents and kept a jog in its arrow. Both modes owe the same promise.
 */
function onlyChildrenStandStraight(s: TreeState, byYears: boolean): void {
  const { pos, level } = layout(s);
  const byChild: Record<string, string[]> = {};
  for (const l of s.links) (byChild[l.child] ||= []).push(l.parent);

  const crooked: string[] = [];
  for (const child of Object.keys(byChild)) {
    const ps = byChild[child];
    const key = ps.slice().sort().join("|");
    const onlyChild = Object.keys(byChild).filter((c) => byChild[c].slice().sort().join("|") === key).length === 1;
    if (!onlyChild) continue;
    // if either parent has a second family, two only children pull in opposite
    // directions — they cannot both stand vertically
    const shareParent = ps.some((p) =>
      Object.keys(byChild).some((c) => byChild[c].includes(p) && byChild[c].slice().sort().join("|") !== key),
    );
    if (shareParent) continue;
    const middle = ps.reduce((sum, p) => sum + pos[p].x, 0) / ps.length;
    if (Math.abs(middle - pos[child].x) > 1) {
      crooked.push(s.people[child].name + " is off by " + Math.round(Math.abs(middle - pos[child].x)) + " px");
    }
  }
  assert.deepEqual(crooked, [], byYears ? "by years" : "by generations");
  assert.ok(Object.keys(level).length > 0);
}

test("the arrows to children never run at a slant", () => {
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
        "the segment is neither horizontal nor vertical: " + JSON.stringify([a, b]),
      );
    }
  }
});

test("an island with no links to the tree lands in a row by year of birth, not at the head", () => {
  // the main tree: three generations with dates
  const s = normalize({});
  const grandad = addPerson(s, { name: "Пётр Иванович Старший", born: "1900" });
  const grandma = addPerson(s, { name: "Анна Петровна Старшая", born: "1902" });
  const father = addPerson(s, { name: "Иван Петрович Средний", born: "1930" });
  const grandson = addPerson(s, { name: "Пётр Иванович Младший", born: "1960" });
  link(s, grandad, father);
  link(s, grandma, father);
  link(s, father, grandson);
  // the island: a father born in 1958 and his son born in 1990, linked to nobody
  const outsider = addPerson(s, { name: "Артём Александрович Гость", born: "1958" });
  const son = addPerson(s, { name: "Макар Артёмович Гость", born: "1990" });
  link(s, outsider, son);

  const { level } = layout(s);
  assert.equal(level[outsider], level[grandson], "1958 is the grandson's row (1960)");
  assert.equal(level[son], level[grandson] + 1, "and his son one row below");
  assert.ok(level[grandad] === 0 && level[father] === 1, "the main tree did not shift");
});

test("an island without a single date stays at the head", () => {
  const s = normalize({});
  const grandad = addPerson(s, { name: "Пётр Иванович Старший", born: "1900" });
  const father = addPerson(s, { name: "Иван Петрович Средний", born: "1930" });
  link(s, grandad, father);
  const outsider = addPerson(s, { name: "Некто Безымянный" });
  const son = addPerson(s, { name: "Сын Безымянный" });
  link(s, outsider, son);
  const { level } = layout(s);
  assert.equal(level[outsider], 0);
  assert.equal(level[son], 1);
});

test("a sister was carried down by her daughter's marriage — her siblings move with her, the parents above all three", () => {
  const s = normalize({});
  const mother = addPerson(s, { name: "Татьяна Лузина" });
  const father = addPerson(s, { name: "Валерий Лузин" });
  const anna = addPerson(s, { name: "Анна Валерьевна" });
  const sergey = addPerson(s, { name: "Сергей Валерьевич" });
  const maria = addPerson(s, { name: "Мария Валерьевна" });
  for (const c of [anna, sergey, maria]) {
    link(s, mother, c);
    link(s, father, c);
  }
  const daughter = addPerson(s, { name: "Анастасия Александровна" });
  link(s, anna, daughter);
  // a deep branch: five generations, the youngest marries Anna's daughter
  let top = addPerson(s, { name: "Пращур" });
  for (let i = 0; i < 4; i++) {
    const next = addPerson(s, { name: "Потомок " + i });
    link(s, top, next);
    top = next;
  }
  addPair(s, top, daughter);

  const { level } = layout(s);
  assert.equal(level[anna], level[sergey], "the brother is in his sister's row");
  assert.equal(level[anna], level[maria], "and the second sister too");
  assert.equal(level[mother], level[anna] - 1, "the parents exactly one row above");
  assert.equal(level[father], level[anna] - 1);
  assert.equal(level[daughter], level[anna] + 1);
  assert.equal(level[daughter], level[top], "the spouses are level");
});
