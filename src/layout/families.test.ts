import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "../model/tree.ts";
import { graphOf, lineFamilies, unions } from "./families.ts";

test("a link written twice is one parent for the lines and the layout alike; the lines keep link order, the layout birth order", () => {
  const s = normalize({
    people: {
      a: { name: "Анна", sex: "f" },
      b: { name: "Борис", sex: "m" },
      young: { name: "Вера", born: "1990" },
      old: { name: "Глеб", born: "1950" },
    },
    links: [
      { parent: "a", child: "young" },
      { parent: "a", child: "old" },
      { parent: "a", child: "old" },
    ],
    pairs: [{ a: "a", b: "b" }],
  });

  const layoutView = unions(s, graphOf(s), null).list.map((u) => ({ key: u.key, parents: u.parents, children: u.children }));
  assert.deepEqual(layoutView, [
    { key: "a", parents: ["a"], children: ["old", "young"] },
    { key: "a|b", parents: ["a", "b"], children: [] },
  ]);

  assert.deepEqual(lineFamilies(s, s.people), {
    a: { parents: ["a"], children: ["young", "old"] },
    "a|b": { parents: ["a", "b"], children: [] },
  });
});
