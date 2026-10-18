import { msg, type Msg } from "../i18n.ts";
import { normalizeDateInput, splitRange } from "./dates.ts";
import { guessSex } from "./names.ts";
import { okId, okPhoto, PERSON_FIELDS } from "./cards.ts";
import { emptyState, isPair, otherIn, pairKey, type Pair, type Person, type Sex, type TreeState } from "./types.ts";

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
  // The new link puts everyone above the parent over everyone below the child. A married
  // couple split between the two would become parent and descendant, which addPair refuses.
  const up = lineOf(parentId, (x) => parentsOf(state, x));
  const down = lineOf(childId, (x) => childrenOf(state, x));
  const clash = state.pairs.find((p) => (up.has(p.a) && down.has(p.b)) || (up.has(p.b) && down.has(p.a)));
  if (clash) {
    const name = (id: string) => state.people[id]?.name ?? "?";
    return { ok: false, reason: msg("reason.spouseLineage", { a: name(clash.a), b: name(clash.b) }) };
  }
  state.links.push({ parent: parentId, child: childId });
  return { ok: true };
}

/** `id` and everyone reached from it by `step`. */
function lineOf(id: string, step: (x: string) => string[]): Set<string> {
  const out = new Set([id]);
  const queue = [id];
  while (queue.length) {
    for (const y of step(queue.pop() as string)) {
      if (!out.has(y)) {
        out.add(y);
        queue.push(y);
      }
    }
  }
  return out;
}

export type PairResult = { ok: true; already?: boolean } | { ok: false; reason: Msg };

const SAME_SEX = { m: "reason.bothMen", f: "reason.bothWomen" };

/**
 * Marriage. Refused between a person and anyone of their own line, up or down, and
 * between two people of the same sex; if the sex of either one is unknown, we do not
 * interfere.
 */
export function addPair(state: TreeState, a: string, b: string): PairResult {
  if (!a || !b || a === b) return { ok: false, reason: msg("reason.selfSpouse") };
  const pa = state.people[a];
  const pb = state.people[b];
  if (!pa || !pb) return { ok: false, reason: msg("reason.notFound") };
  if (isDescendant(state, a, b) || isDescendant(state, b, a)) {
    return { ok: false, reason: msg("reason.lineage", { a: pa.name, b: pb.name }) };
  }
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A list from a file; anything but an array is an empty one. */
const listOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const FIELDS = new Set(PERSON_FIELDS);

/**
 * A new id for someone whose own one the cards cannot keep (see `okId`): made of what
 * can be kept of the old one plus a number, and never one that is already taken. The
 * same tree always gets the same ids.
 */
function freshId(bad: string, taken: Set<string>): string {
  const base = bad.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "p";
  for (let k = 1; ; k++) {
    const id = base + "-" + k;
    if (okId(id) && !taken.has(id)) return id;
  }
}

/**
 * Brings anything from a file or the store to a valid state. A container of the wrong
 * type counts as empty; a person whose id the cards cannot keep gets a new one, and
 * their links come along; a link, a marriage or a siblinghood written twice is kept
 * once; the fields of a person the app does not know are kept in their `extra`.
 */
export function normalize(raw: unknown): TreeState {
  const d = isObject(raw) ? raw : {};
  const s = emptyState();
  s.timeline = !!d.timeline;
  s.gap = typeof d.gap === "number" ? d.gap : 1;
  s.seq = typeof d.seq === "number" ? d.seq : 0;

  const people = isObject(d.people) ? d.people : {};
  const ids = Object.keys(people);
  // old id -> the id in the tree; a Map, so that no id can be taken for a member of Object.prototype
  const rename = new Map<string, string>();
  const taken = new Set(ids.filter(okId));
  for (const id of ids) {
    const fresh = okId(id) ? id : freshId(id, taken);
    taken.add(fresh);
    rename.set(id, fresh);
  }
  const who = (v: unknown): string | undefined => (typeof v === "string" ? rename.get(v) : undefined);

  for (const old of ids) {
    const id = rename.get(old) as string;
    const p = isObject(people[old]) ? people[old] : {};
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
    if (okPhoto(p.photo)) person.photo = p.photo;
    // what the app does not know: from a card, its own fields; from the app's own state,
    // the `extra` it already keeps
    const extra = Object.entries(isObject(p.extra) ? p.extra : {})
      .concat(Object.entries(p))
      .filter(([k]) => !FIELDS.has(k));
    if (extra.length) person.extra = Object.fromEntries(extra);
    s.people[id] = person;
    if (person.n > s.seq) s.seq = person.n;
  }

  const seen = new Set<string>();
  for (const l of listOf(d.links)) {
    const parent = isObject(l) ? who(l.parent) : undefined;
    const child = isObject(l) ? who(l.child) : undefined;
    if (!parent || !child || seen.has(parent + ">" + child)) continue;
    seen.add(parent + ">" + child);
    s.links.push({ parent, child });
  }
  /** Pairs and explicit siblinghood lie in the file alike — and are read alike. */
  const readPairs = (list: unknown): Pair[] => {
    const out: Pair[] = [];
    const keys = new Set<string>();
    for (const p of listOf(list)) {
      const a = isObject(p) ? who(p.a) : undefined;
      const b = isObject(p) ? who(p.b) : undefined;
      if (!a || !b || a === b || keys.has(pairKey(a, b))) continue;
      keys.add(pairKey(a, b));
      out.push({ a, b });
    }
    return out;
  };
  s.pairs = readPairs(d.pairs);
  s.sibs = readPairs(d.sibs);
  s.hidden = [...new Set(listOf(d.hidden).map(who).filter((id) => id !== undefined))];
  return s;
}
