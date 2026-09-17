import {
  addPair,
  addPerson,
  addSibling,
  clearPins,
  clone,
  cutAbove,
  link,
  normalize,
  parentsOf,
  removePair,
  removePerson,
  removeSibling,
  type PairResult,
  type PersonSpec,
} from "./tree.ts";
import { msg, type Msg } from "../i18n.ts";
import { emptyState, type Link, type Person, type TreeState } from "./types.ts";

export type Relation = "child" | "parent" | "spouse" | "sibling";

export interface AppState {
  tree: TreeState;
  selected: string | null;
  /** snapshots for undo */
  history: TreeState[];
  /** the message at the bottom of the screen (a dictionary key); seq is what makes an identical one show twice */
  notice: { msg: Msg; seq: number } | null;
  /** grows whenever the layout has to be fitted to the screen again */
  fitSeq: number;
  /** who to bring into view without touching the zoom */
  focus: { id: string; seq: number } | null;
}

export type Action =
  | { type: "load"; tree: TreeState; notice?: Msg; silent?: boolean }
  | { type: "select"; id: string | null }
  | { type: "add"; spec: PersonSpec; relation?: { mode: Relation; to: string } }
  | { type: "connect"; mode: Relation; from: string; to: string }
  | { type: "update"; id: string; patch: Partial<Person>; quiet?: boolean }
  | { type: "remove"; id: string }
  | { type: "cut"; parent: string; child: string }
  | { type: "unlinkParents"; id: string }
  | { type: "unlinkPartner"; a: string; b: string }
  | { type: "unlinkSibling"; a: string; b: string }
  | { type: "pin"; id: string; x: number; y: number }
  | { type: "rearrange" }
  | { type: "hideAbove"; id: string }
  | { type: "unhideAll" }
  | { type: "setGap"; gap: number }
  | { type: "setTimeline"; on: boolean }
  | { type: "undo" }
  | { type: "wipe" }
  | { type: "notice"; msg: Msg }
  | { type: "fit" };

const HISTORY_MAX = 60;

export const initialAppState = (tree: TreeState): AppState => ({
  tree,
  selected: null,
  history: [],
  notice: null,
  fitSeq: 0,
  focus: null,
});

const say = (s: AppState, m: Msg): AppState => ({
  ...s,
  notice: { msg: m, seq: (s.notice?.seq ?? 0) + 1 },
});

type EditOut =
  | { ok: false; notice?: Msg }
  | { ok: true; notice?: Msg; select?: string | null; fit?: boolean; focus?: string };

/**
 * An edit after which the layout has to be built anew: the pinned cards are released,
 * otherwise the new kin stand on top of the old places.
 */
function relink(s: AppState, fn: (draft: TreeState) => EditOut): AppState {
  return edit(s, (d) => {
    const out = fn(d);
    if (out.ok) clearPins(d);
    return out;
  });
}

/** Remove links by a condition; if nothing was removed, there was no change. */
function dropLinks(d: TreeState, drop: (l: Link) => boolean): boolean {
  const before = d.links.length;
  d.links = d.links.filter((l) => !drop(l));
  return d.links.length !== before;
}

/** The shared frame of a change: a snapshot into history, work on a copy, the new state out. */
function edit(s: AppState, fn: (draft: TreeState) => EditOut): AppState {
  const draft = clone(s.tree);
  const out = fn(draft);
  if (!out.ok) return out.notice ? say(s, out.notice) : s;

  const history = s.history.concat([s.tree]);
  if (history.length > HISTORY_MAX) history.shift();
  const wanted = out.select !== undefined ? out.select : s.selected;
  const next: AppState = {
    ...s,
    tree: draft,
    history,
    selected: wanted && draft.people[wanted] ? wanted : null,
    fitSeq: out.fit ? s.fitSeq + 1 : s.fitSeq,
    focus: out.focus && draft.people[out.focus] ? { id: out.focus, seq: (s.focus?.seq ?? 0) + 1 } : s.focus,
  };
  return out.notice ? say(next, out.notice) : next;
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "load":
      return {
        ...s,
        tree: a.tree,
        selected: null,
        history: a.silent ? s.history : s.history.concat([s.tree]).slice(-HISTORY_MAX),
        fitSeq: s.fitSeq + 1,
        notice: a.notice ? { msg: a.notice, seq: (s.notice?.seq ?? 0) + 1 } : s.notice,
      };

    case "select":
      return { ...s, selected: a.id };

    case "add":
      return relink(s, (d) => {
        const id = addPerson(d, a.spec);
        if (a.relation && d.people[a.relation.to]) {
          const r = relate(d, a.relation.mode, a.relation.to, id);
          if (!r.ok) return { ok: false, notice: r.reason };
        }
        return { ok: true, select: id, focus: id };
      });

    case "connect":
      return relink(s, (d) => {
        if (!d.people[a.from] || !d.people[a.to] || a.from === a.to) return { ok: false };
        const from = d.people[a.from].name;
        const to = d.people[a.to].name;
        const r = relate(d, a.mode, a.from, a.to);
        if (!r.ok) return { ok: false, notice: r.reason };
        return { ok: true, focus: a.to, notice: msg(CONNECTED[a.mode], { a: from, b: to, from, to }) };
      });

    case "update": {
      if (!s.tree.people[a.id]) return s;
      // field edits go without a snapshot: otherwise undo would roll back letter by letter
      if (a.quiet) {
        const tree = clone(s.tree);
        Object.assign(tree.people[a.id], a.patch);
        return { ...s, tree };
      }
      return edit(s, (d) => {
        Object.assign(d.people[a.id], a.patch);
        return { ok: true };
      });
    }

    case "cut":
      return relink(s, (d) =>
        dropLinks(d, (l) => l.parent === a.parent && l.child === a.child)
          ? { ok: true, notice: msg("msg.linkRemoved") }
          : { ok: false },
      );

    case "remove":
      return relink(s, (d) => {
        if (!d.people[a.id]) return { ok: false };
        removePerson(d, a.id);
        return { ok: true, select: s.selected === a.id ? null : s.selected };
      });

    case "unlinkParents":
      return relink(s, (d) =>
        dropLinks(d, (l) => l.child === a.id)
          ? { ok: true, notice: msg("msg.parentsRemoved") }
          : { ok: false },
      );

    case "unlinkSibling":
      return relink(s, (d) => {
        removeSibling(d, a.a, a.b);
        return { ok: true, notice: msg("msg.siblingRemoved") };
      });

    case "unlinkPartner":
      return relink(s, (d) => {
        removePair(d, a.a, a.b);
        return { ok: true, notice: msg("msg.marriageRemoved") };
      });

    case "pin":
      return edit(s, (d) => {
        const p = d.people[a.id];
        if (!p) return { ok: false };
        p.fx = a.x;
        p.fy = a.y;
        return { ok: true };
      });

    case "rearrange":
      return relink(s, () => ({ ok: true, fit: true }));

    case "hideAbove":
      return relink(s, (d) => {
        if (!d.people[a.id]) return { ok: false };
        const more = cutAbove(d, a.id).filter((id) => !d.hidden.includes(id));
        if (!more.length) return { ok: false, notice: msg("msg.nothingAbove") };
        d.hidden = d.hidden.concat(more);
        return { ok: true, fit: true, notice: msg("msg.hidden", { n: more.length }) };
      });

    case "unhideAll":
      return relink(s, (d) => {
        if (!d.hidden.length) return { ok: false };
        d.hidden = [];
        return { ok: true, fit: true, notice: msg("msg.unhidden") };
      });

    case "setGap":
      return { ...s, tree: { ...s.tree, gap: a.gap, people: unpin(s.tree.people) }, fitSeq: s.fitSeq + 1 };

    case "setTimeline":
      return {
        ...s,
        tree: { ...s.tree, timeline: a.on, people: unpin(s.tree.people) },
        fitSeq: s.fitSeq + 1,
        notice: {
          msg: msg(a.on ? "msg.byYears" : "msg.byGenerations"),
          seq: (s.notice?.seq ?? 0) + 1,
        },
      };

    case "undo": {
      if (!s.history.length) return say(s, msg("msg.nothingToUndo"));
      const history = s.history.slice();
      const tree = history.pop() as TreeState;
      return {
        ...say({ ...s, tree, history }, msg("msg.undone")),
        selected: s.selected && tree.people[s.selected] ? s.selected : null,
      };
    }

    case "wipe":
      return edit(s, (d) => {
        if (!Object.keys(d.people).length) return { ok: false };
        const fresh = emptyState();
        d.people = fresh.people;
        d.links = fresh.links;
        d.pairs = fresh.pairs;
        return { ok: true, select: null };
      });

    case "notice":
      return say(s, a.msg);

    case "fit":
      return { ...s, fitSeq: s.fitSeq + 1 };
  }
}

/** What to say about a new link. */
const CONNECTED: Record<Relation, string> = {
  spouse: "msg.marriage",
  sibling: "msg.siblingOf",
  child: "msg.childOf",
  parent: "msg.parentOf",
};

/** Relate two people the chosen way. `from` is the one the link was dragged from. */
function relate(d: TreeState, mode: Relation, from: string, to: string): PairResult {
  if (mode === "spouse") return addPair(d, from, to);
  if (mode === "sibling") return sibling(d, from, to);
  return mode === "child" ? link(d, from, to) : link(d, to, from);
}

/**
 * A brother or sister for `to`. If that person has parents in the tree, the new person
 * becomes their child and these are ordinary arrows. If there are no parents, we record
 * the kinship itself, and it is drawn dashed.
 */
function sibling(d: TreeState, to: string, id: string): PairResult {
  const ps = parentsOf(d, to);
  if (!ps.length) return addSibling(d, to, id);
  for (const p of ps) {
    const r = link(d, p, id);
    if (!r.ok) return r;
  }
  return { ok: true };
}

function unpin(people: Record<string, Person>): Record<string, Person> {
  const out: Record<string, Person> = {};
  for (const id of Object.keys(people)) {
    const { fx: _fx, fy: _fy, ...rest } = people[id];
    out[id] = rest;
  }
  return out;
}

/* ============================= the store ============================ */

const KEY = "genealogy:v3";

export function loadStored(): TreeState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.people || !Object.keys(d.people).length) return null;
    return normalize(d);
  } catch {
    return null; // a broken store must not stop the tree from opening
  }
}

export function store(tree: TreeState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(tree));
  } catch {
    /* private mode, quota exceeded — we will live */
  }
}
