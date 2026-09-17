import assert from "node:assert/strict";
import { test } from "node:test";
import { addPerson, link, normalize } from "../model/tree.ts";
import { edgeStats } from "./crossings.ts";
import { computeEdges } from "./edges.ts";
import { layout } from "./layout.ts";

/**
 * Узел с реального древа: семья с тремя детьми и пара с одним ребёнком делят полосу
 * между рядами. Исток пары попал внутрь размаха шины первой семьи, а спуск к третьему
 * ребёнку — внутрь размаха шины пары. Если шину пары уложить ниже — два пересечения,
 * если выше — ни одного. Карточки приколочены, чтобы не зависеть от раскладки.
 */
test("шина, чей исток внутри чужого размаха, ложится выше чужой", () => {
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
  pin(e3, 900, 200); // третий ребёнок ушёл вправо, под пару
  pin(R, 700, 0);
  pin(St, 926, 0);
  pin(m, 1300, 200);

  const { pos, level } = layout(s);
  const items = computeEdges(s, pos, level, null);
  const rects = Object.keys(pos).map((id) => ({
    x1: pos[id].x - pos[id].w / 2,
    y1: pos[id].y,
    x2: pos[id].x + pos[id].w / 2,
    y2: pos[id].y + pos[id].h,
  }));
  const st = edgeStats(items, rects);
  assert.equal(st.crossings, 0, "спуск пары не режет шину семьи, спуск к Екатерине не режет шину пары");
  assert.equal(st.through, 0);
  assert.equal(st.busNear, 0, "шины разведены не ближе 12 px");

  // и именно так: шина пары выше шины семьи
  const busY = (child: string): number => {
    const it = items.find((i) => i.kind === "path" && i.ref?.kind === "child" && i.ref.child === child);
    assert.ok(it && it.kind === "path");
    const hor = it.pts.filter((p, i) => i > 0 && Math.abs(p.y - it.pts[i - 1].y) < 0.6);
    return hor[0].y;
  };
  assert.ok(busY(m) < busY(e3), "шина Раисы и Степана легла выше шины Елены");
});
