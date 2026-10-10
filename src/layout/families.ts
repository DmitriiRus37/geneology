/**
 * Who belongs together: the parent and child lists, the connected pieces of the
 * tree and the families. There are two groupings of families. `unions` is the
 * layout's: children in birth order, a childless marriage is a family too, and it
 * knows who stands tight together. `lineFamilies` is what the lines are drawn from:
 * children in link order, over the cards actually shown. Both take each parent
 * once per child however many times the link was written; the child order is the
 * one difference, and a test pins it.
 */
import { birthKey } from "../model/dates.ts";
import { pairKey, type TreeState } from "../model/types.ts";
import { Merge } from "../util.ts";

export interface Graph {
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
}

/** A family unit: a set of parents and their shared children. */
export interface Union {
  parents: string[];
  children: string[];
  key: string;
  first: number;
}

export interface Unions {
  list: Union[];
  byParent: Record<string, Union[]>;
  isCouple: (a: string, b: string) => boolean;
}

export function graphOf(state: TreeState): Graph {
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(state.people)) {
    parents[id] = [];
    children[id] = [];
  }
  for (const l of state.links) {
    if (!state.people[l.parent] || !state.people[l.child]) continue;
    if (parents[l.child].indexOf(l.parent) < 0) parents[l.child].push(l.parent);
    if (children[l.parent].indexOf(l.child) < 0) children[l.parent].push(l.child);
  }
  return { parents, children };
}

/** The connected pieces of the tree — laid out independently and spread horizontally. */
export function components(state: TreeState): string[][] {
  const merge = new Merge<string>();
  for (const l of state.links) if (state.people[l.parent] && state.people[l.child]) merge.join(l.parent, l.child);
  for (const pr of [...state.pairs, ...state.sibs]) if (state.people[pr.a] && state.people[pr.b]) merge.join(pr.a, pr.b);
  const oldest = (c: string[]) => Math.min(...c.map((i) => state.people[i].n));
  return merge.parts(Object.keys(state.people)).sort((a, b) => oldest(a) - oldest(b));
}

/** A family unit: a set of parents and their shared children. A childless marriage is a unit too. */
export function unions(state: TreeState, g: Graph, xhint: Record<string, number> | null): Unions {
  const srcX = (u: Union): number => {
    let s = 0;
    let n = 0;
    for (const p of u.parents) {
      if (xhint && xhint[p] !== undefined) {
        s += xhint[p];
        n++;
      }
    }
    return n ? s / n : 0;
  };

  const byKey: Record<string, Union> = {};
  for (const cid of Object.keys(state.people)) {
    const ps = g.parents[cid];
    if (!ps.length) continue;
    const key = ps.slice().sort().join("|");
    if (!byKey[key]) byKey[key] = { parents: ps.slice(), children: [], key, first: 1e9 };
    byKey[key].children.push(cid);
  }
  const list = Object.keys(byKey).map((k) => byKey[k]);

  const byParent: Record<string, Union[]> = {};
  // who stands tight together: spouses, and explicit siblings, who share the same small gap
  const pairGap: Record<string, 1> = {};
  for (const sb of state.sibs) {
    if (state.people[sb.a] && state.people[sb.b]) pairGap[[sb.a, sb.b].sort().join("|")] = 1;
  }
  for (const pr of state.pairs) {
    if (!state.people[pr.a] || !state.people[pr.b]) continue;
    const key = [pr.a, pr.b].sort().join("|");
    pairGap[key] = 1;
    if (!byKey[key]) {
      byKey[key] = { parents: [pr.a, pr.b], children: [], key, first: 1e9 };
      list.push(byKey[key]);
    }
  }

  for (const u of list) {
    // the elder to the left, and those without dates in the order they were entered
    u.children.sort((a, b) => {
      const ka = birthKey(state.people[a]);
      const kb = birthKey(state.people[b]);
      if (ka !== null && kb !== null && ka !== kb) return ka - kb;
      if (ka !== null && kb === null) return -1;
      if (ka === null && kb !== null) return 1;
      return state.people[a].n - state.people[b].n;
    });
    u.first = u.children.length ? state.people[u.children[0]].n : 1e9;
    for (const p of u.parents) (byParent[p] = byParent[p] || []).push(u);
    for (let i = 0; i < u.parents.length; i++) {
      for (let j = i + 1; j < u.parents.length; j++) {
        pairGap[[u.parents[i], u.parents[j]].sort().join("|")] = 1;
      }
    }
  }

  for (const p of Object.keys(byParent)) {
    byParent[p].sort((a, b) => {
      if (xhint) {
        // second pass: by now we know where the line will start from
        const d = srcX(a) - srcX(b);
        if (Math.abs(d) > 1) return d;
      }
      return a.first - b.first;
    });
  }

  return {
    list,
    byParent,
    isCouple: (a, b) => !!pairGap[[a, b].sort().join("|")],
  };
}

/** A family as the lines see it. */
export interface LineFamily {
  parents: string[];
  children: string[];
}

/**
 * The families the lines are drawn for, by key: the parents of every child shown,
 * in link order and each once (a link written twice is still one parent, as in
 * `graphOf`), and every marriage between two people shown. `shown` holds whoever
 * has a card.
 */
export function lineFamilies(state: TreeState, shown: Record<string, unknown>): Record<string, LineFamily> {
  const byChild: Record<string, string[]> = {};
  const uni: Record<string, LineFamily> = {};

  for (const l of state.links) {
    if (!shown[l.parent] || !shown[l.child]) continue;
    const ps = (byChild[l.child] = byChild[l.child] || []);
    if (ps.indexOf(l.parent) < 0) ps.push(l.parent);
  }
  for (const cid of Object.keys(byChild)) {
    const key = byChild[cid].slice().sort().join("|");
    if (!uni[key]) uni[key] = { parents: byChild[cid], children: [] };
    uni[key].children.push(cid);
  }
  for (const pr of state.pairs) {
    if (!shown[pr.a] || !shown[pr.b]) continue;
    const key = pairKey(pr.a, pr.b);
    if (!uni[key]) uni[key] = { parents: [pr.a, pr.b], children: [] };
  }
  return uni;
}
