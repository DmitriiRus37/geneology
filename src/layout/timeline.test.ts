import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "../model/tree.ts";
import { nodeCards } from "../testing/cards.ts";
import { graphOf } from "./families.ts";
import { layout, type Box } from "./layout.ts";
import { NODE_W } from "./measure.ts";
import { applyTimeline } from "./timeline.ts";

const yearsOf = (raw: unknown) => {
  const { tl } = layout(normalize(raw), nodeCards());
  assert.ok(tl);
  return tl;
};

test("by years: a guess from the death date does not put a father after his own son", () => {
  // died at 46: the death year less sixty would be the son's own year
  const tl = yearsOf({
    people: {
      dad: { name: "Иван Петрович Орлов", sex: "m", died: "??.??.1946" },
      son: { name: "Пётр Иванович Орлов", sex: "m", born: "13.09.1886" },
    },
    links: [{ parent: "dad", child: "son" }],
    timeline: true,
  });
  assert.equal(tl.year.son, 1886, "the son's year is from his card");
  assert.ok(tl.year.dad <= 1886 - 16, "the father is a generation older, not " + tl.year.dad);
  assert.ok(tl.est.dad, "and his year is still an estimate");
});

test("by years: «19??» on a card follows the parents within its century, while their exact years stay", () => {
  const tl = yearsOf({
    people: {
      dad: { name: "Иван Петрович Орлов", sex: "m", born: "16.01.1954" },
      mom: { name: "Анна Сергеевна Орлова", sex: "f", born: "21.05.1957" },
      kid: { name: "Мария Ивановна Орлова", sex: "f", born: "22.02.19??" },
    },
    links: [
      { parent: "dad", child: "kid" },
      { parent: "mom", child: "kid" },
    ],
    pairs: [{ a: "dad", b: "mom" }],
    timeline: true,
  });
  assert.equal(tl.year.dad, 1954);
  assert.equal(tl.year.mom, 1957);
  assert.ok(tl.year.kid >= 1957 + 16 && tl.year.kid <= 1999, "after her parents and still in the 1900s: " + tl.year.kid);
  assert.ok(tl.est.kid);
});

test("by years: exact years on the cards are never moved, even when they disagree", () => {
  const tl = yearsOf({
    people: {
      dad: { name: "Иван Петрович Орлов", sex: "m", born: "12.03.1950" },
      kid: { name: "Мария Ивановна Орлова", sex: "f", born: "05.05.1951" },
    },
    links: [{ parent: "dad", child: "kid" }],
    timeline: true,
  });
  assert.equal(tl.year.dad, 1950);
  assert.equal(tl.year.kid, 1951);
});

test("by years: an only child whose spouse is in the way goes back under its parent together with the spouse", () => {
  // Someone a year older stands too close to the spouse: the spreading pushes the
  // spouse aside, and the spouse pushes the child out from under its father. The child
  // alone could come back only as far as the spouse let it.
  const s = normalize({
    people: {
      dad: { name: "Иван Петрович Орлов", sex: "m", born: "??.??.1847" },
      kid: { name: "Пётр Иванович Орлов", sex: "m", born: "??.??.1875" },
      wife: { name: "Анна Сергеевна Орлова", sex: "f", born: "??.??.1875" },
      other: { name: "Ольга Петровна Белкина", sex: "f", born: "??.??.1874" },
    },
    links: [{ parent: "dad", child: "kid" }],
    pairs: [{ a: "kid", b: "wife" }],
    timeline: true,
  });
  const box = (x: number): Box => ({ x, y: 0, w: NODE_W, h: 66, lines: [] });
  const pos: Record<string, Box> = { dad: box(1000), kid: box(1000), wife: box(774), other: box(534) };
  applyTimeline(s, graphOf(s), { dad: 0, kid: 1, wife: 1, other: 1 }, pos, { h: 58, couple: 24, v: 124, comp: 180 });
  assert.ok(Math.abs(pos.kid.x - pos.dad.x) < 1, "the son stands under his father, off by " + Math.round(pos.kid.x - pos.dad.x));
  assert.ok(pos.kid.x - pos.wife.x >= NODE_W + 20, "his wife still stands beside him, a gap apart");
  assert.ok(pos.wife.x - pos.other.x >= NODE_W + 20, "and nobody is crowded");
});
