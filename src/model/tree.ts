import { msg, type Msg } from "../i18n.ts";
import { normalizeDateInput, splitRange } from "./dates.ts";
import { guessSex } from "./names.ts";
import { emptyState, isPair, otherIn, type Pair, type Person, type Sex, type TreeState } from "./types.ts";

export const clone = <T,>(v: T): T => structuredClone(v);

export function uid(state: TreeState): string {
  state.seq = (state.seq || 0) + 1;
  return "p" + state.seq + "-" + Math.random().toString(36).slice(2, 6);
}

export interface PersonSpec {
  name: string;
  maiden?: string;
  alt?: string[];
  born?: string;
  died?: string;
  sex?: Sex;
}

export function addPerson(state: TreeState, spec: PersonSpec): string {
  const id = uid(state);
  state.people[id] = {
    id,
    name: spec.name.trim(),
    maiden: spec.maiden || "",
    alt: (spec.alt || []).slice(),
    born: spec.born || "",
    died: spec.died || "",
    sex: spec.sex || guessSex(spec.name),
    n: state.seq,
  };
  return id;
}

export const parentsOf = (state: TreeState, id: string): string[] =>
  state.links.filter((l) => l.child === id).map((l) => l.parent);

export const childrenOf = (state: TreeState, id: string): string[] =>
  state.links.filter((l) => l.parent === id).map((l) => l.child);

/** Who is recorded next to `id` in a list of pairs — marriage and explicit siblinghood work alike. */
function linkedIn(state: TreeState, list: Pair[], id: string): string[] {
  const out: string[] = [];
  for (const p of list) {
    const who = otherIn(p, id);
    if (who !== null && state.people[who]) out.push(who);
  }
  return out;
}

export const partnersOf = (state: TreeState, id: string): string[] => linkedIn(state, state.pairs, id);

export function isDescendant(state: TreeState, ancestorId: string, id: string, seen: Record<string, 1> = {}): boolean {
  if (ancestorId === id) return true;
  if (seen[id]) return false;
  seen[id] = 1;
  return parentsOf(state, id).some((p) => isDescendant(state, ancestorId, p, seen));
}

export type LinkResult = { ok: true; already?: boolean } | { ok: false; reason: Msg };

/** Parent -> child. A loop ("the parent is already lower down the tree") is never created. */
export function link(state: TreeState, parentId: string, childId: string): LinkResult {
  if (parentId === childId) return { ok: false, reason: msg("reason.selfParent") };
  if (!state.people[parentId] || !state.people[childId]) return { ok: false, reason: msg("reason.notFound") };
  if (state.links.some((l) => l.parent === parentId && l.child === childId)) return { ok: true, already: true };
  if (isDescendant(state, childId, parentId)) {
    return { ok: false, reason: msg("reason.loop", { name: state.people[parentId].name }) };
  }
  state.links.push({ parent: parentId, child: childId });
  return { ok: true };
}

export type PairResult = { ok: true; already?: boolean } | { ok: false; reason: Msg };

const SAME_SEX = { m: "reason.bothMen", f: "reason.bothWomen" };

/** Marriage. Same sex is refused; if the sex of either one is unknown, we do not interfere. */
export function addPair(state: TreeState, a: string, b: string): PairResult {
  if (!a || !b || a === b) return { ok: false, reason: msg("reason.selfSpouse") };
  const pa = state.people[a];
  const pb = state.people[b];
  if (!pa || !pb) return { ok: false, reason: msg("reason.notFound") };
  if (pa.sex === pb.sex && (pa.sex === "m" || pa.sex === "f")) {
    return { ok: false, reason: msg(SAME_SEX[pa.sex], { a: pa.name, b: pb.name }) };
  }
  if (state.pairs.some((p) => isPair(p, a, b))) return { ok: true, already: true };
  state.pairs.push({ a, b });
  return { ok: true };
}

/** Ready lists of parents and children — the layout has counted them already, no point counting twice. */
export interface Adjacency {
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
}

/**
 * Spouses: a recorded marriage and simply a shared child are equal links. Most
 * couples in the tree rest on the shared child alone and have no separate marriage
 * record at all.
 */
export function spousesOf(state: TreeState, id: string, adj?: Adjacency): string[] {
  const out = new Set(partnersOf(state, id));
  for (const c of adj ? adj.children[id] : childrenOf(state, id)) {
    for (const q of adj ? adj.parents[c] : parentsOf(state, c)) if (q !== id) out.add(q);
  }
  return [...out];
}

/** Siblings recorded explicitly (there are no shared parents in the tree). */
export const siblingsOf = (state: TreeState, id: string): string[] =>
  linkedIn(state, state.sibs || [], id);

/** All siblings: both through a shared parent and recorded explicitly. */
export function allSiblingsOf(state: TreeState, id: string): string[] {
  const out = new Set(siblingsOf(state, id));
  for (const p of parentsOf(state, id)) for (const c of childrenOf(state, p)) if (c !== id) out.add(c);
  return [...out];
}

/**
 * An explicit "brother/sister" kinship. It is needed when there are no shared parents
 * in the tree: otherwise it is simpler to tie the siblings to the same parents, which
 * is what "Add" does.
 */
export function addSibling(state: TreeState, a: string, b: string): PairResult {
  if (!a || !b || a === b) return { ok: false, reason: msg("reason.selfSibling") };
  if (!state.people[a] || !state.people[b]) return { ok: false, reason: msg("reason.notFound") };
  if (isDescendant(state, a, b) || isDescendant(state, b, a)) {
    return { ok: false, reason: msg("reason.lineage", { a: state.people[a].name, b: state.people[b].name }) };
  }
  if (parentsOf(state, a).some((p) => parentsOf(state, b).includes(p))) return { ok: true, already: true };
  if ((state.sibs || []).some((s) => isPair(s, a, b))) return { ok: true, already: true };
  state.sibs.push({ a, b });
  return { ok: true };
}

export function removeSibling(state: TreeState, a: string, b: string): void {
  state.sibs = (state.sibs || []).filter((s) => !isPair(s, a, b));
}

export function removePair(state: TreeState, a: string, b: string): void {
  state.pairs = state.pairs.filter((p) => !isPair(p, a, b));
}

export function removePerson(state: TreeState, id: string): void {
  delete state.people[id];
  state.links = state.links.filter((l) => l.parent !== id && l.child !== id);
  state.pairs = state.pairs.filter((p) => p.a !== id && p.b !== id);
  state.sibs = (state.sibs || []).filter((s) => s.a !== id && s.b !== id);
  state.hidden = (state.hidden || []).filter((h) => h !== id);
}

/**
 * Who to hide in order to cut the tree upwards from a person: all of their ancestors,
 * everything growing down from those (brothers, sisters, cousins) and those people's
 * spouses — except the person themselves, their descendants and those descendants'
 * spouses. A spouse stays with their own kin: the husband's ancestors are not the
 * wife's.
 */
export function cutAbove(state: TreeState, id: string): string[] {
  const parents = (x: string) => parentsOf(state, x);
  const children = (x: string) => childrenOf(state, x);
  const spouses = (x: string) => spousesOf(state, x);
  const closure = (seeds: string[], step: (x: string) => string[]): Set<string> => {
    const out = new Set<string>();
    const queue = seeds.slice();
    while (queue.length) {
      const x = queue.pop() as string;
      for (const y of step(x)) {
        if (!out.has(y) && state.people[y]) {
          out.add(y);
          queue.push(y);
        }
      }
    }
    return out;
  };
  const ancestors = closure([id], parents);
  ancestors.delete(id);
  if (!ancestors.size) return [];

  const keep = closure([id], children);
  keep.add(id);
  for (const k of [...keep]) for (const sp of spouses(k)) keep.add(sp);

  const hide = closure([...ancestors], children);
  for (const a of ancestors) hide.add(a);
  for (const h of [...hide]) for (const sp of spouses(h)) hide.add(sp);
  for (const k of keep) hide.delete(k);
  return [...hide];
}

/** The tree without the hidden: the layout works on this, and the rest knows nothing of them. */
export function visibleState(state: TreeState): TreeState {
  const hidden = new Set((state.hidden || []).filter((id) => state.people[id]));
  if (!hidden.size) return state;
  const people: Record<string, Person> = {};
  for (const id of Object.keys(state.people)) if (!hidden.has(id)) people[id] = state.people[id];
  return {
    ...state,
    people,
    links: state.links.filter((l) => !hidden.has(l.parent) && !hidden.has(l.child)),
    pairs: state.pairs.filter((p) => !hidden.has(p.a) && !hidden.has(p.b)),
    sibs: (state.sibs || []).filter((s) => !hidden.has(s.a) && !hidden.has(s.b)),
    hidden: [],
  };
}

export function clearPins(state: TreeState): void {
  for (const id of Object.keys(state.people)) {
    delete state.people[id].fx;
    delete state.people[id].fy;
  }
}

/** Brings anything from a file or the store to a valid state. */
export function normalize(raw: unknown): TreeState {
  const d = (raw || {}) as Record<string, unknown>;
  const s = emptyState();
  s.timeline = !!d.timeline;
  s.gap = typeof d.gap === "number" ? d.gap : 1;
  s.seq = typeof d.seq === "number" ? d.seq : 0;

  const people = (d.people || {}) as Record<string, Record<string, unknown>>;
  for (const id of Object.keys(people)) {
    const p = people[id] || {};
    let born = typeof p.born === "string" ? p.born : "";
    let died = typeof p.died === "string" ? p.died : "";
    if (!born && !died && typeof p.years === "string") {
      // the old format: a single "years" field
      const pr = splitRange(p.years);
      born = pr[0];
      died = pr[1];
    }
    const person: Person = {
      id,
      name: String(p.name || "?"),
      maiden: typeof p.maiden === "string" ? p.maiden : "",
      alt: Array.isArray(p.alt) ? (p.alt as unknown[]).map(String) : [],
      // a bare year becomes "??.??.1970" in old records too: the app will rewrite them
      // to disk on the very first save
      born: normalizeDateInput(born),
      died: normalizeDateInput(died),
      sex: p.sex === "m" || p.sex === "f" ? p.sex : "u",
      n: typeof p.n === "number" ? p.n : ++s.seq,
    };
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      person.fx = p.fx;
      person.fy = p.fy;
    }
    s.people[id] = person;
    if (person.n > s.seq) s.seq = person.n;
  }

  for (const l of (d.links || []) as { parent?: string; child?: string }[]) {
    if (l && l.parent && l.child && s.people[l.parent] && s.people[l.child]) {
      s.links.push({ parent: l.parent, child: l.child });
    }
  }
  /** Pairs and explicit siblinghood lie in the file alike — and are read alike. */
  const readPairs = (raw: unknown): Pair[] =>
    ((raw || []) as { a?: string; b?: string }[])
      .filter((p) => p && p.a && p.b && s.people[p.a] && s.people[p.b] && p.a !== p.b)
      .map((p) => ({ a: p.a as string, b: p.b as string }));
  s.pairs = readPairs(d.pairs);
  s.sibs = readPairs(d.sibs);
  s.hidden = Array.isArray(d.hidden)
    ? [...new Set((d.hidden as unknown[]).map(String).filter((id) => s.people[id]))]
    : [];
  return s;
}
