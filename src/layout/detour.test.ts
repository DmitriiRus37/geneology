import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "../model/tree.ts";
import { nodeCards } from "../testing/cards.ts";
import { detour } from "./detour.ts";
import { computeEdges } from "./edges.ts";
import { layout, rectOf } from "./layout.ts";
import { hitsCard, type Pt, type Rect } from "./route.ts";

const orthogonal = (pts: Pt[]): boolean =>
  pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);

test("a detour gets to a child standing level with its parent without entering a card, and comes down onto it", () => {
  // down, across and down cannot work here: the child's top is above the parent's bottom
  const parent: Rect = { x1: 0, y1: 0, x2: 200, y2: 80 };
  const child: Rect = { x1: 260, y1: 20, x2: 460, y2: 100 };
  const between: Rect = { x1: 120, y1: 110, x2: 320, y2: 190 }; // and somebody stands right under both
  const cards = [parent, child, between];
  const pts = detour({ x: 100, y: 80 }, 1, { x: 360, y: 17 }, 1, cards, [parent, child]);
  assert.ok(pts, "there is a way");
  assert.equal(hitsCard(pts, cards), null, "it enters no card");
  assert.ok(orthogonal(pts), "no slanted segment");
  assert.ok(pts[1].y > pts[0].y && Math.abs(pts[1].x - pts[0].x) < 0.01, "it leaves the parent downwards");
  const [p, q] = pts.slice(-2);
  assert.ok(Math.abs(p.x - q.x) < 0.01 && p.y < q.y, "the arrow comes down onto the child from above");
});

test("a detour gives up rather than run through a card when there is no way out", () => {
  const parent: Rect = { x1: 0, y1: 0, x2: 200, y2: 80 };
  const lid: Rect = { x1: -500, y1: 82, x2: 700, y2: 160 }; // a card flush under the parent
  const child: Rect = { x1: 260, y1: 300, x2: 460, y2: 380 };
  assert.equal(detour({ x: 100, y: 80 }, 1, { x: 360, y: 297 }, 1, [parent, lid, child], [parent, child]), null);
});

test("by years, a child dated a year after her father gets a line that keeps off every card", () => {
  // a typing error on a card: the daughter of his first marriage "born" a year after him.
  // The line from his bottom edge used to go up through his own card.
  const s = normalize({
    people: {
      dad: { name: "Иван Петрович Орлов", sex: "m", born: "12.03.1950" },
      mom: { name: "Анна Сергеевна Орлова", sex: "f", born: "01.07.1952" },
      kid: { name: "Мария Ивановна Орлова", sex: "f", born: "05.05.1951" },
      son: { name: "Пётр Иванович Орлов", sex: "m", born: "09.09.1975" },
      aunt: { name: "Ольга Петровна Орлова", sex: "f", born: "02.02.1951" },
      gran: { name: "Пётр Николаевич Орлов", sex: "m", born: "03.03.1925" },
    },
    links: [
      { parent: "dad", child: "kid" },
      { parent: "dad", child: "son" },
      { parent: "mom", child: "son" },
      { parent: "gran", child: "dad" },
      { parent: "gran", child: "aunt" },
    ],
    pairs: [{ a: "dad", b: "mom" }],
    timeline: true,
  });
  const { pos, level } = layout(s, nodeCards());
  assert.ok(pos.kid.y < pos.dad.y + pos.dad.h, "the daughter does stand above her father's bottom edge");
  const rects = Object.keys(pos).map((id) => rectOf(pos[id]));
  const through = computeEdges(s, pos, level, null).filter((it) => it.kind === "path" && hitsCard(it.pts, rects));
  assert.deepEqual(through.map((it) => (it.kind === "path" ? it.d : "")), []);
});
