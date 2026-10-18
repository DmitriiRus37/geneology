import assert from "node:assert/strict";
import { test } from "node:test";
import { addPerson, link, normalize } from "../model/tree.ts";
import { edgeStats } from "./crossings.ts";
import { computeEdges } from "./edges.ts";
import { layout } from "./layout.ts";
import { nodeCards } from "../testing/cards.ts";

/**
 * A knot from a real tree: a family with three children and a couple with one child share
 * the band between the rows. The couple's source fell inside the span of the first
 * family's bus, and the descent to the third child fell inside the span of the couple's
 * bus. Lay the couple's bus lower and there are two crossings; lay it higher and there
 * are none. The cards are pinned so as not to depend on the layout.
 */
test("a bus whose source is inside another's span lies above that other one", () => {
  const s = normalize({});
  const E = addPerson(s, { name: "Елена Ивановна", sex: "f" });
  const e1 = addPerson(s, { name: "Анна Валерьевна", sex: "f" });
  const e2 = addPerson(s, { name: "Марина Александровна", sex: "f" });
  const e3 = addPerson(s, { name: "Екатерина Александровна", sex: "f" });
  const R = addPerson(s, { name: "Раиса Алексеевна", sex: "f" });
  const St = addPerson(s, { name: "Степан Андреевич", sex: "m" });
  const m = addPerson(s, { name: "Мария Степановна", sex: "f" });
  for (const c of [e1, e2, e3]) link(s, E, c);
  link(s, R, m);
  link(s, St, m);
  const pin = (id: string, x: number, y: number) => {
    s.people[id].fx = x;
    s.people[id].fy = y;
  };
  pin(E, 300, 0);
  pin(e1, 0, 200);
  pin(e2, 260, 200);
  pin(e3, 900, 200); // the third child went off to the right, under the couple
  pin(R, 700, 0);
  pin(St, 926, 0);
  pin(m, 1300, 200);

  const { pos, level } = layout(s, nodeCards());
  const items = computeEdges(s, pos, level, null);
  const rects = Object.keys(pos).map((id) => ({
    x1: pos[id].x - pos[id].w / 2,
    y1: pos[id].y,
    x2: pos[id].x + pos[id].w / 2,
    y2: pos[id].y + pos[id].h,
  }));
  const st = edgeStats(items, rects);
  assert.equal(st.crossings, 0, "the couple's descent does not cut the family's bus, and the descent to the third child does not cut the couple's");
  assert.equal(st.through, 0);
  assert.equal(st.busNear, 0, "the buses are kept no closer than 12 px apart");

  // and in exactly this way: the couple's bus above the family's
  const busY = (child: string): number => {
    const it = items.find((i) => i.kind === "path" && i.ref?.kind === "child" && i.ref.child === child);
    assert.ok(it && it.kind === "path");
    const hor = it.pts.filter((p, i) => i > 0 && Math.abs(p.y - it.pts[i - 1].y) < 0.6);
    return hor[0].y;
  };
  assert.ok(busY(m) < busY(e3), "the couple's bus lies above the family's");
});
