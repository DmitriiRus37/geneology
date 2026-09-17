import type { TreeState } from "../model/types.ts";
import { download } from "./files.ts";

const API = "/api/tree";

/** The fingerprint of the folder we saw last. It is the one we write with. */
let rev = "";

/**
 * Where the server puts people: a folder on disk, or its own memory only.
 * In memory the tree lives until a restart — it is brought in and taken out
 * as an archive.
 */
export type Store = "disk" | "memory";

export interface DiskInfo {
  /** exactly where the files are written — we show this to the person */
  dir: string;
  store: Store;
  tree: TreeState | null;
  /** the server asks for a password: there is something to log out of */
  guarded: boolean;
  /** which account we came in as, "admin" among them; empty when nobody asked */
  role: string;
  /** an older server version: it knows no fingerprints, so it must not be written to */
  stale: boolean;
}

export type SaveResult = "ok" | "conflict" | "offline";

/**
 * Whether there is a local server alongside that can write into persons/. If the app was
 * opened as a file from disk, the request simply will not go out — we return null and keep
 * everything in the browser, as before.
 */
export async function probeDisk(): Promise<DiskInfo | null> {
  try {
    const r = await fetch(API, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!r.ok) return null;
    const body = await r.json();
    if (!body || !body.ok) return null;
    // an old server sends no fingerprint and would read a new write as "there are no people"
    const stale = typeof body.rev !== "string" || !body.rev;
    rev = stale ? "" : String(body.rev);
    return {
      dir: String(body.dir || "persons"),
      store: body.store === "memory" ? "memory" : "disk",
      tree: body.tree ?? null,
      guarded: !!body.guarded,
      role: String(body.role ?? ""),
      stale,
    };
  } catch {
    return null;
  }
}

/** Re-read the tree from disk and fall back into step with it. */
export async function reloadDisk(): Promise<TreeState | null> {
  const info = await probeDisk();
  return info ? info.tree : null;
}

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

/**
 * A write only goes through if nothing in the store changed since we last read
 * it. Otherwise the server refuses and we do not overwrite someone else's edits
 * — for example ones made in another tab while this one lay open.
 */
export function saveDisk(tree: TreeState): Promise<SaveResult> {
  const send = async (): Promise<SaveResult> => {
    try {
      const r = await fetch(API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rev, tree }),
      });
      const body = await r.json().catch(() => null);
      if (r.status === 409) return "conflict";
      if (!r.ok || !body || !body.ok) return "offline";
      if (body.rev) rev = String(body.rev);
      return "ok";
    } catch {
      return "offline";
    }
  };
  return inTurn(send);
}

/**
 * Hand the server an archive of cards: it replaces the whole tree in its memory.
 * We take the new fingerprint straight away, otherwise the very first edit runs
 * into a conflict.
 */
export function uploadZip(file: File): Promise<{ tree: TreeState } | { error: string }> {
  // in the same queue as the writes: an archive replaces the whole tree, and a
  // write still in flight would be answering about the tree it has just replaced
  return inTurn(async () => {
    try {
      const r = await fetch("/api/upload", { method: "POST", body: file });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body?.ok || !body.tree) return { error: String(body?.error || r.status) };
      if (body.rev) rev = String(body.rev);
      return { tree: body.tree as TreeState };
    } catch (e) {
      return { error: String((e as Error)?.message ?? e) };
    }
  });
}

/** Take the tree away as an archive — exactly the one that would lie in persons/. */
export async function downloadZip(): Promise<string | null> {
  try {
    const r = await fetch("/api/download", { cache: "no-store" });
    if (!r.ok) return String(r.status);
    download("persons.zip", await r.blob());
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

/** The last write as the tab closes: the browser will not wait for an ordinary fetch. */
export function flushDisk(tree: TreeState): void {
  try {
    navigator.sendBeacon(API, new Blob([JSON.stringify({ rev, tree })], { type: "application/json" }));
  } catch {
    /* we are closing — there is nobody left to complain to */
  }
}
