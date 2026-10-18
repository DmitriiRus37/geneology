/** The order within rows, before the untangling. */
import { siblingsOf } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import type { Graph, Unions } from "./families.ts";

/** The order within rows: a top-down traversal, a couple and its children stay together. */
export function orderRows(
  state: TreeState,
  ids: string[],
  g: Graph,
  u: Unions,
  level: Record<string, number>,
  maxLevel: number,
  /** those the traversal put in the row as a child of their own family, not as a spouse */
  asChild: Set<string>,
): string[][] {
  const rows: string[][] = [];
  for (let l = 0; l <= maxLevel; l++) rows[l] = [];
  const seen: Record<string, 1> = {};
  const inSet: Record<string, 1> = {};
  for (const id of ids) inSet[id] = 1;

  const visit = (id: string): void => {
    if (seen[id] || !inSet[id]) return;
    seen[id] = 1;
    const uns = u.byParent[id] || [];
    // Whoever has two families gets one to the left and the other to the right:
    // otherwise the lines to the children of different spouses run the same way and
    // tangle.
    if (uns.length > 1) for (const p of uns[0].parents) visit(p);
    rows[level[id]].push(id); // we take our place in our own row straight away
    // The spouse takes their place in the row first. If we went up to the parents
    // first, their other kin (the person's siblings) would take the places between
    // the spouses, the couple would sprawl across half a row and the child would
    // hang between them.
    for (const un of u.byParent[id] || []) for (const p of un.parents) visit(p);
    for (const sb of siblingsOf(state, id)) visit(sb); // explicit siblings stand next to them
    for (const p of g.parents[id]) visit(p); // the other half's family stands above them
    for (const un of u.byParent[id] || []) {
      for (const c of un.children) {
        if (!seen[c]) asChild.add(c);
        visit(c);
      }
    }
  };

  ids
    .filter((id) => !g.parents[id].length)
    .sort((a, b) => state.people[a].n - state.people[b].n)
    .forEach(visit);
  ids.slice().sort((a, b) => state.people[a].n - state.people[b].n).forEach(visit);
  return rows;
}

