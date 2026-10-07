/**
 * Keeping the open tree in step with the server, or with the browser when there is
 * no server. Plain TypeScript with no React and no browser in it: everything from
 * outside — the network, timers, localStorage, `sendBeacon` — comes in as `SyncDeps`,
 * and everything the engine has to say goes out through `SyncOut`.
 *
 * What it keeps: the fingerprint of the store as last seen (a write carries it, and
 * the server refuses one made against an older store), the queue that sends writes
 * one at a time, and the autosave — a second after the last edit, at once after a
 * hurry (another person selected, a text field left). Where the tree lives and
 * whether writing is blocked is `Where`, React state on the other side: the engine
 * asks for changes to it and is told what it is on every commit.
 */
import { msg, type Msg } from "../i18n.ts";
import { normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { beaconBody, getTree, getZip, postTree, postZip, TREE_URL, type Fetch, type ServerInfo, type Store } from "./api.ts";

export type Where =
  | { kind: "disk"; dir: string; store: Store; guarded: boolean; role: string; blocked: null | "conflict" | "stale" }
  | { kind: "browser" }
  | null;

/** A write goes out this long after the last edit, so as not to write a file for every letter. */
export const SAVE_DELAY = 1000;
/** A server that has not answered by then is taken to be absent. */
export const PROBE_TIMEOUT = 2500;

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

export type SaveResult = "ok" | "conflict" | "offline";

export interface Sync {
  /** Ask the server what there is; `current` is the open tree, to seed an empty folder with. Returns what makes the answer go unheard. */
  start(current: () => TreeState): () => void;
  /** Every commit of the interface: the autosave looks at what changed since the last one. */
  commit(tree: TreeState, where: Where, flushSeq: number): void;
  /** Drop a pending autosave and forget the last commit. */
  stop(): void;
  /** Read the tree from the server again and fall back into step with it. */
  reread(): Promise<void>;
  /** The last write as the tab closes. */
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
  const read = async (): Promise<ServerInfo | null> => {
    const ctrl = new AbortController();
    const cancel = deps.later(() => ctrl.abort(), PROBE_TIMEOUT);
    try {
      const info = await getTree(deps.fetch, ctrl.signal);
      if (info) rev = info.rev;
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
  const save = (tree: TreeState): Promise<SaveResult> =>
    inTurn(async () => {
      const a = await postTree(deps.fetch, rev, tree);
      if (a.kind === "ok" && a.rev) rev = a.rev;
      return a.kind;
    });

  /** What has already gone to the store: we do not write the same tree twice. */
  let lastSaved: TreeState | null = null;
  /** The hurry counter as the autosave last used it. */
  let flushSeen = 0;
  let cancelSave: (() => void) | null = null;
  /** What the autosave depended on at the last commit: it reacts to a change in any of it. */
  let seen: { tree: TreeState; where: Where; flushSeq: number } | null = null;

  const stop = () => {
    cancelSave?.();
    cancelSave = null;
    seen = null;
  };

  return {
    start(current) {
      let alive = true;
      void read().then((info) => {
        if (!alive) return;
        if (!info) {
          out.setWhere({ kind: "browser" });
          return;
        }
        out.setWhere({
          kind: "disk",
          dir: info.dir,
          store: info.store,
          guarded: info.guarded,
          role: info.role,
          blocked: info.stale ? "stale" : null,
        });
        if (info.tree && Object.keys(info.tree.people).length) {
          out.load(normalize(info.tree));
        } else if (info.store === "memory") {
          // A server that keeps people in memory starts empty and stays empty until
          // an archive is uploaded. Seeding it with the sample tree would put names
          // on a machine that was never meant to hold them.
          out.load(normalize({}));
        } else if (!info.stale) {
          // The folder is empty — we seed it with whatever is open. We mark the tree
          // as sent straight away: otherwise the autosave would get a second request
          // out behind it, still carrying the old fingerprint, and answer itself with
          // a conflict.
          lastSaved = current();
          void save(current());
        }
        if (info.stale) out.notice(msg("notice.staleServer"));
      });
      return () => {
        alive = false;
      };
    },

    commit(tree, where, flushSeq) {
      if (seen && seen.tree === tree && seen.where === where && seen.flushSeq === flushSeq) return;
      seen = { tree, where, flushSeq };
      cancelSave?.();
      cancelSave = null;
      if (!where) return;
      if (where.kind === "disk" && where.blocked) return; // until it is mended, we do not write
      if (lastSaved === tree) return; // there is nothing to write
      const now = flushSeq !== flushSeen;
      flushSeen = flushSeq;
      cancelSave = deps.later(
        () => {
          cancelSave = null;
          lastSaved = tree;
          if (where.kind !== "disk") {
            deps.keep(tree);
            return;
          }
          void save(tree).then((r) => {
            if (r !== "conflict") return;
            out.setWhere({ ...where, blocked: "conflict" });
            out.notice(msg("notice.conflict"));
          });
        },
        now ? 0 : SAVE_DELAY,
      );
    },

    stop,

    async reread() {
      const info = await read();
      const tree = info ? info.tree : null;
      if (!tree) return;
      out.load(normalize(tree), msg("notice.reread"));
      out.setWhere((w) => (w && w.kind === "disk" ? { ...w, blocked: null } : w));
    },

    flush(tree) {
      try {
        deps.beacon(TREE_URL, beaconBody(rev, tree));
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
