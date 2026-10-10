/**
 * Keeping the open tree in step with the server, or with the browser when there is
 * no server. Plain TypeScript with no React and no browser in it: everything from
 * outside — the network, timers, localStorage, `sendBeacon` — comes in as `SyncDeps`,
 * and everything the engine has to say goes out through `SyncOut`.
 *
 * What it keeps: the fingerprint of the store as last seen (a write carries it, and
 * the server refuses one made against an older store), the queue that sends writes
 * one at a time, and the autosave — a second after the last edit, at once after a
 * hurry (another person selected, a text field left). A write that fails is tried
 * again until it goes through. Where the tree lives and whether writing is blocked
 * is `Where`, React state on the other side: the engine asks for changes to it and
 * is told what it is on every commit.
 */
import { msg, type Msg } from "../i18n.ts";
import { normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import {
  BEACON_LIMIT,
  beaconBody,
  EMPTY_REV,
  getTree,
  getZip,
  postTree,
  postZip,
  TREE_URL,
  type Fetch,
  type SaveAnswer,
  type ServerInfo,
  type Store,
} from "./api.ts";

export type Where =
  | { kind: "disk"; dir: string; store: Store; guarded: boolean; role: string; blocked: null | "conflict" | "stale" }
  | { kind: "browser" }
  | null;

type OnServer = Extract<Where, { kind: "disk" }>;

/** A write goes out this long after the last edit, so as not to write a file for every letter. */
export const SAVE_DELAY = 1000;
/** A server that has not answered by then is asked again. */
export const PROBE_TIMEOUT = 2500;
/** A server that kept silent this many times in a row is taken to be absent. */
export const PROBE_TRIES = 3;
/** A write that failed is tried again this long after, and again for as long as it fails. */
export const RETRY_DELAY = 5000;

export interface SyncDeps {
  fetch: Fetch;
  /** Run `fn` in `ms` milliseconds; returns what cancels it. */
  later(fn: () => void, ms: number): () => void;
  /** The browser's own copy of the tree, when there is no server. */
  keep(tree: TreeState): void;
  /** `navigator.sendBeacon`: the browser does not wait for an ordinary request as a tab closes. */
  beacon(url: string, body: Blob): boolean;
  /** Hand a downloaded file to the person. */
  save(name: string, blob: Blob): void;
}

export interface SyncOut {
  /** React's setState for `Where`: a value, or an update of the latest one. */
  setWhere(next: Where | ((w: Where) => Where)): void;
  /** A tree read from the server replaces the open one, without an undo step. */
  load(tree: TreeState, notice?: Msg): void;
  notice(m: Msg): void;
}

export interface Sync {
  /** Ask the server what there is; `current` is the open tree, to seed an empty folder with. Returns what makes the answer go unheard. */
  start(current: () => TreeState): () => void;
  /** Every commit of the interface: the autosave looks at what changed since the last one. */
  commit(tree: TreeState, where: Where, flushSeq: number): void;
  /** Drop a pending write and forget the last commit. */
  stop(): void;
  /** Read the tree from the server again and fall back into step with it. */
  reread(): Promise<void>;
  /** The page was hidden: a pending write goes out at once, while the page is still alive to send it. */
  hide(): void;
  /** Something meant for the server has not reached it: a pending autosave, a write in flight or a failed one. */
  unsaved(): boolean;
  /** The closing write of `tree` fits into a beacon: the browser refuses a bigger one. */
  fitsBeacon(tree: TreeState): boolean;
  /** The tab is closing with something unsaved that a beacon cannot carry: the page should ask first. */
  askOnClose(tree: TreeState): boolean;
  /** The last write as the tab closes — only when something is unsaved. */
  flush(tree: TreeState): void;
  upload(file: Blob): Promise<{ tree: TreeState } | { error: string }>;
  /** Returns what went wrong, or null. */
  download(): Promise<string | null>;
}

export function createSync(deps: SyncDeps, out: SyncOut): Sync {
  /** The fingerprint of the store we saw last. It is the one we write with. */
  let rev = "";

  /**
   * Writes go one at a time. A new fingerprint only arrives with the response, so
   * two overlapping writes would carry the same one and the server would honestly
   * refuse the second as stale. On your own machine the answer comes back in a
   * millisecond and there is barely anything to overlap; to a remote machine it
   * takes far longer, and without this queue an edit made right after the previous
   * one would drop the tab into an imaginary conflict.
   */
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => {}); // one slip must not block the queue
    return next;
  };

  /** The tree and the server's state; the fingerprint is taken from every answer. */
  const read = async (): Promise<ServerInfo | "timeout" | null> => {
    const ctrl = new AbortController();
    const cancel = deps.later(() => ctrl.abort(), PROBE_TIMEOUT);
    try {
      const info = await getTree(deps.fetch, ctrl.signal);
      if (info && info !== "timeout") rev = info.rev;
      return info;
    } finally {
      cancel();
    }
  };

  /**
   * A write only goes through if nothing in the store changed since we last read
   * it. Otherwise the server refuses and we do not overwrite someone else's edits
   * — for example ones made in another tab while this one lay open.
   */
  const save = (tree: TreeState): Promise<SaveAnswer> =>
    inTurn(async () => {
      const a = await postTree(deps.fetch, rev, tree);
      if (a.kind === "ok" && a.rev) rev = a.rev;
      return a;
    });

  /** What the store is known to hold: set by a write the server said yes to, never sooner. */
  let lastSaved: TreeState | null = null;
  /** The tree of the last write sent, while any write is in flight. */
  let sending: TreeState | null = null;
  let inFlight = 0;
  /** The last write failed — not refused: failed — and none has gone through since. */
  let failing = false;
  /** The hurry counter as the autosave last used it. */
  let flushSeen = 0;
  /** Cancels the next write: the autosave or, while writes fail, the retry. */
  let cancelNext: (() => void) | null = null;
  /** The next write is the retry of a failed one. */
  let retrying = false;
  /** What the autosave depended on at the last commit: it reacts to a change in any of it. */
  let seen: { tree: TreeState; where: Where; flushSeq: number } | null = null;

  const cancel = () => {
    cancelNext?.();
    cancelNext = null;
    retrying = false;
  };

  /** Writing to the server is possible right now: there is one and it is not blocked. */
  const writable = (where: Where | undefined): where is OnServer => where?.kind === "disk" && !where.blocked;

  const blocked = () => {
    failing = false;
    cancel();
    out.setWhere((w) => (w && w.kind === "disk" ? { ...w, blocked: "conflict" } : w));
    out.notice(msg("notice.conflict"));
  };

  /**
   * One write of `tree`. Said yes to: the store holds it. Refused: someone else wrote
   * first, and writing stops until the tree is read again — unless the server keeps
   * the tree in memory and has nothing at all: then a restart has wiped it, this tab
   * holds the only copy, and it goes back at once. Failed: the change stays unsaved
   * and is tried again in RETRY_DELAY, with whatever is newest by then.
   * `restoring` marks that write-back; a refusal of it is an ordinary conflict.
   */
  const write = (tree: TreeState, where: OnServer, restoring = false): void => {
    sending = tree;
    inFlight++;
    void save(tree).then((a) => {
      if (--inFlight === 0) sending = null;
      if (a.kind === "ok") {
        lastSaved = tree;
        if (restoring) out.notice(msg("notice.restarted"));
        else if (failing) out.notice(msg("notice.saved"));
        failing = false;
        // a retry has nothing left to do: edits newer than this write get an ordinary autosave
        if (retrying) cancel();
        if (!cancelNext) plan();
        return;
      }
      if (a.kind === "conflict") {
        if (!restoring && a.rev === EMPTY_REV && where.store === "memory") {
          rev = EMPTY_REV;
          write(seen?.tree ?? tree, where, true);
          return;
        }
        blocked();
        return;
      }
      if (!failing) out.notice(msg("notice.saveFailed"));
      failing = true;
      if (!retrying) {
        cancel();
        cancelNext = deps.later(fire, RETRY_DELAY);
        retrying = true;
      }
    });
  };

  /** The autosave or the retry: the newest committed tree goes to wherever it lives. */
  const fire = () => {
    cancelNext = null;
    retrying = false;
    const s = seen;
    if (!s || !s.where) return;
    const { tree, where } = s;
    if (where.kind !== "disk") {
      lastSaved = tree;
      deps.keep(tree);
      return;
    }
    if (where.blocked) return;
    if (inFlight && tree === sending) return; // its answer decides what comes next
    if (tree === lastSaved) {
      // the edits were taken back to exactly what the store holds
      if (failing) out.notice(msg("notice.saved"));
      failing = false;
      return;
    }
    write(tree, where);
  };

  /** Arm the next write for the latest commit: in a second, or at once after a hurry. */
  const plan = () => {
    const s = seen;
    if (retrying) {
      // While writes fail, the retry is the only write: it takes whatever is newest
      // by then, and edits do not bring it forward — a server that is down is not
      // asked again every second.
      if (!writable(s?.where)) {
        failing = false;
        cancel();
      }
      return;
    }
    cancel();
    if (!s || !s.where) return;
    if (s.where.kind === "disk" && s.where.blocked) return; // until it is mended, we do not write
    if (s.tree === lastSaved || s.tree === sending) return; // there is nothing to write
    const now = s.flushSeq !== flushSeen;
    flushSeen = s.flushSeq;
    cancelNext = deps.later(fire, now ? 0 : SAVE_DELAY);
  };

  const stop = () => {
    cancel();
    seen = null;
  };

  const unsaved = () => writable(seen?.where) && (cancelNext !== null || inFlight > 0 || failing);
  const fitsBeacon = (tree: TreeState) => beaconBody(rev, tree).size <= BEACON_LIMIT;

  return {
    start(current) {
      let alive = true;
      void (async () => {
        // A slow server is not an absent one: it is asked again before the tree is
        // left to the browser. Until then `where` stays unknown and nothing is written.
        let info: ServerInfo | "timeout" | null = "timeout";
        for (let i = 0; i < PROBE_TRIES && info === "timeout"; i++) {
          info = await read();
          if (!alive) return;
        }
        if (info === "timeout" || !info) {
          out.setWhere({ kind: "browser" });
          // no server at all (a file, a refused connection) is the ordinary case and says nothing
          if (info === "timeout") out.notice(msg("notice.serverSilent"));
          return;
        }
        const where: OnServer = {
          kind: "disk",
          dir: info.dir,
          store: info.store,
          guarded: info.guarded,
          role: info.role,
          blocked: info.stale ? "stale" : null,
        };
        out.setWhere(where);
        if (info.tree && Object.keys(info.tree.people).length) {
          out.load(normalize(info.tree));
        } else if (info.store === "memory") {
          // A server that keeps people in memory starts empty and stays empty until
          // an archive is uploaded. Seeding it with the sample tree would put names
          // on a machine that was never meant to hold them.
          out.load(normalize({}));
        } else if (!info.stale) {
          // The folder is empty — we seed it with whatever is open. The write counts
          // as in flight at once, so the autosave does not send the same tree again.
          write(current(), where);
        }
        if (info.stale) out.notice(msg("notice.staleServer"));
      })();
      return () => {
        alive = false;
      };
    },

    commit(tree, where, flushSeq) {
      if (seen && seen.tree === tree && seen.where === where && seen.flushSeq === flushSeq) return;
      seen = { tree, where, flushSeq };
      plan();
    },

    stop,

    async reread() {
      const info = await read();
      if (!info || info === "timeout") return;
      const open = seen?.tree;
      if (info.store === "memory" && info.rev === EMPTY_REV && open && Object.keys(open.people).length) {
        // A server in memory with nothing at all has lost its tree in a restart: the
        // tree open here is the only copy left, and it goes back rather than being
        // swapped for nothing.
        const where = seen?.where;
        if (where?.kind !== "disk") return;
        failing = false;
        cancel();
        out.setWhere((w) => (w && w.kind === "disk" ? { ...w, blocked: null } : w));
        write(open, { ...where, blocked: null }, true);
        return;
      }
      if (!info.tree) return;
      failing = false;
      out.load(normalize(info.tree), msg("notice.reread"));
      // a server still in its old version stays one that must not be written to
      out.setWhere((w) => (w && w.kind === "disk" ? { ...w, blocked: info.stale ? "stale" : null } : w));
    },

    hide() {
      if (!cancelNext) return;
      cancel();
      fire();
    },

    unsaved,
    fitsBeacon,
    askOnClose: (tree) => unsaved() && !fitsBeacon(tree),

    flush(tree) {
      if (!unsaved()) return;
      try {
        // What the beacon carried no longer waits for its turn: hiding the page comes
        // right after, and it would send the same tree again.
        if (deps.beacon(TREE_URL, beaconBody(rev, tree))) cancel();
      } catch {
        /* we are closing — there is nobody left to complain to */
      }
    },

    upload(file) {
      // in the same queue as the writes: an archive replaces the whole tree, and a
      // write still in flight would be answering about the tree it has just replaced
      return inTurn(async () => {
        const r = await postZip(deps.fetch, file);
        if ("error" in r) return r;
        if (r.rev) rev = r.rev;
        return { tree: r.tree };
      });
    },

    download: () => getZip(deps.fetch, deps.save),
  };
}
