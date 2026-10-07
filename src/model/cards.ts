/**
 * The storage format: one JSON card per person plus `_view.json` with the canvas
 * settings, and the tree those cards turn into on `/api/tree`. The server stores the
 * cards (on disk or in memory), the app only ever sees the tree.
 *
 * This file imports nothing: the server runs it as it is, with no build step, and it
 * has to stay loadable by Node on its own.
 */

/** Canvas settings; does not look like a person, hence the underscore. */
export const VIEW = "_view.json";

/** An id ends up in a file name, so only harmless ones get through. */
export const okId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/** The file a person's card is kept in. */
export const cardName = (id: string): string => id + ".json";

/** One person as written to `<id>.json`. Links are kept in both cards they join. */
export interface Card {
  id: string;
  name: string;
  maiden: string;
  alt: string[];
  born: string;
  died: string;
  sex: string;
  n: number;
  parents: string[];
  spouses: string[];
  siblings: string[];
  fx?: number;
  fy?: number;
}

/** `_view.json`. */
export interface ViewCard {
  timeline: boolean;
  gap: number;
  hidden: string[];
}

export interface WirePair {
  a: string;
  b: string;
}

/**
 * The tree as the server hands it out. A person is its card without the link lists
 * and with anything else the card carried, unchecked: the app normalizes it.
 */
export interface WireTree {
  people: Record<string, Record<string, unknown> & { id: string }>;
  links: { parent: string; child: string }[];
  pairs: WirePair[];
  sibs: WirePair[];
  timeline: boolean;
  gap: number;
  hidden: string[];
  seq: number;
}

/** A mutual link is written in both cards — it reaches the tree once. */
function collect(others: unknown[], id: string, kind: string, seen: Set<string>, out: WirePair[]): void {
  for (const b of others) {
    if (!okId(b)) continue;
    const key = kind + "|" + [id, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: id, b });
  }
}

/**
 * Cards to the tree. `files` is every `.json` in the store, name -> text; a file that
 * does not parse is reported through `warn` and skipped. Null when the store is empty:
 * the app will seed it itself.
 */
export function cardsToTree(files: [name: string, text: string][] | null, warn: (line: string) => void): WireTree | null {
  if (!files) return null;
  const people: WireTree["people"] = {};
  const links: WireTree["links"] = [];
  const pairs: WirePair[] = [];
  const sibs: WirePair[] = [];
  const seen = new Set<string>();
  // anything may lie in a file: the checks below are all there is
  let view: any = {};

  for (const [name, text] of [...files].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    let raw: any;
    try {
      raw = JSON.parse(text);
    } catch (e) {
      warn("skipping " + name + ": " + (e as Error).message);
      continue;
    }
    if (name === VIEW) {
      view = raw || {};
      continue;
    }
    if (name.startsWith("_")) continue;
    const id = okId(raw?.id) ? raw.id : name.slice(0, -5);
    if (!okId(id)) continue;
    const { parents = [], spouses = [], siblings = [], ...person } = raw || {};
    people[id] = { ...person, id };
    for (const p of parents) if (okId(p)) links.push({ parent: p, child: id });
    // a marriage and an explicit kinship are written in both cards — take each pair once
    collect(spouses, id, "sp", seen, pairs);
    collect(siblings, id, "sib", seen, sibs);
  }

  // links to people who disappeared are dropped silently
  const alive = (id: string) => Object.hasOwn(people, id);
  return {
    people,
    links: links.filter((l) => alive(l.parent) && alive(l.child)),
    pairs: pairs.filter((p) => alive(p.a) && alive(p.b)),
    sibs: sibs.filter((p) => alive(p.a) && alive(p.b)),
    timeline: !!view.timeline,
    gap: typeof view.gap === "number" ? view.gap : 1,
    hidden: Array.isArray(view.hidden) ? view.hidden.filter((id: unknown) => okId(id) && alive(id)) : [],
    seq: Object.values(people).reduce((m, p) => Math.max(m, (p.n as number) || 0), 0),
  };
}

/**
 * The id a file of the store stands for, read the way `cardsToTree` reads it; null when
 * the file is no person's card — the view, a file that does not parse, or one with no
 * usable id. A file like that was never shown to anybody, so nothing may delete it.
 */
export function cardIdOf(name: string, text: string): string | null {
  if (name === VIEW || name.startsWith("_")) return null;
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const id = okId(raw?.id) ? raw.id : name.slice(0, -5);
  return okId(id) ? id : null;
}

/** What a save writes: every card in the order of the people, then the view. */
export interface CardSet {
  ids: string[];
  cards: [name: string, text: string][];
  view: string;
}

/**
 * The tree to cards. `tree` is the body of a save, unchecked: an id outside `okId`
 * is dropped, and so is a link to someone who is not there.
 */
export function treeToCards(tree: any): CardSet {
  const people = tree?.people && typeof tree.people === "object" ? tree.people : {};
  const ids = Object.keys(people).filter(okId);

  const blank = (): Record<string, string[]> => Object.fromEntries(ids.map((id) => [id, []]));
  const parents = blank();
  const spouses = blank();
  const siblings = blank();

  /** A mutual link is written into both cards — otherwise half of it is lost. */
  const both = (list: any, into: Record<string, string[]>) => {
    for (const p of list || []) {
      if (!people[p.a] || !people[p.b] || !into[p.a] || !into[p.b]) continue;
      if (!into[p.a].includes(p.b)) into[p.a].push(p.b);
      if (!into[p.b].includes(p.a)) into[p.b].push(p.a);
    }
  };

  for (const l of tree.links || []) {
    if (parents[l.child] && people[l.parent] && !parents[l.child].includes(l.parent)) {
      parents[l.child].push(l.parent);
    }
  }
  both(tree.pairs, spouses);
  both(tree.sibs, siblings);

  const cards: CardSet["cards"] = [];
  for (const id of ids) {
    const p = people[id];
    const doc: Card = {
      id,
      name: String(p.name ?? ""),
      maiden: p.maiden || "",
      alt: Array.isArray(p.alt) ? p.alt : [],
      born: p.born || "",
      died: p.died || "",
      sex: p.sex || "u",
      n: p.n || 0,
      parents: parents[id],
      spouses: spouses[id],
      siblings: siblings[id],
    };
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      doc.fx = Math.round(p.fx * 100) / 100;
      doc.fy = Math.round(p.fy * 100) / 100;
    }
    cards.push([cardName(id), JSON.stringify(doc, null, 2) + "\n"]);
  }

  const hidden = Array.isArray(tree.hidden) ? tree.hidden.filter((id: unknown) => okId(id) && people[id]) : [];
  const view: ViewCard = { timeline: !!tree.timeline, gap: tree.gap ?? 1, hidden };
  return { ids, cards, view: JSON.stringify(view, null, 2) + "\n" };
}
