/**
 * The server's HTTP API, one request per function. Nothing is kept here: the version
 * fingerprint goes in as a parameter and comes back in the answer, and `fetch` comes
 * from the caller, so the tests can put a server of their own behind it.
 */
import type { TreeState } from "../model/types.ts";

export type Fetch = typeof fetch;

export const TREE_URL = "/api/tree";

/**
 * Where the server puts people: a folder on disk, or its own memory only.
 * In memory the tree lives until a restart — it is brought in and taken out
 * as an archive.
 */
export type Store = "disk" | "memory";

export interface ServerInfo {
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
  /** the fingerprint of the store as read; "" from a stale server */
  rev: string;
}

/**
 * The tree and everything about the server. Null when there is no server to ask —
 * the app was opened as a file, the request failed or the server answered with an
 * error. "timeout" when `signal` gave up on it first: a server may well be there,
 * only slow, and it is worth asking again.
 */
export async function getTree(fetch: Fetch, signal?: AbortSignal): Promise<ServerInfo | "timeout" | null> {
  try {
    const r = await fetch(TREE_URL, { signal, cache: "no-store" });
    if (!r.ok) return null;
    const body = await r.json();
    if (!body || !body.ok) return null;
    // an old server sends no fingerprint and would read a new write as "there are no people"
    const stale = typeof body.rev !== "string" || !body.rev;
    return {
      dir: String(body.dir || "persons"),
      store: body.store === "memory" ? "memory" : "disk",
      tree: body.tree ?? null,
      guarded: !!body.guarded,
      role: String(body.role ?? ""),
      stale,
      rev: stale ? "" : String(body.rev),
    };
  } catch {
    return signal?.aborted ? "timeout" : null;
  }
}

/**
 * `rev` is the new fingerprint when the server sent one; with a conflict it is the
 * fingerprint the store is really at ("empty" when it holds nothing at all).
 * "offline" is any write that did not go through for another reason: no answer, or
 * an error.
 */
export type SaveAnswer = { kind: "ok"; rev: string | null } | { kind: "conflict"; rev: string | null } | { kind: "offline" };

/** The fingerprint of a store with nothing in it. */
export const EMPTY_REV = "empty";

/** A write that only goes through if the store is still at `rev`. */
export async function postTree(fetch: Fetch, rev: string, tree: TreeState): Promise<SaveAnswer> {
  try {
    const r = await fetch(TREE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, tree }),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 409) return { kind: "conflict", rev: typeof body?.rev === "string" ? body.rev : null };
    if (!r.ok || !body || !body.ok) return { kind: "offline" };
    return { kind: "ok", rev: body.rev ? String(body.rev) : null };
  } catch {
    return { kind: "offline" };
  }
}

/** An archive of cards for a server that keeps the tree in memory: it replaces the whole tree. */
export async function postZip(
  fetch: Fetch,
  file: Blob,
): Promise<{ tree: TreeState; rev: string | null } | { error: string }> {
  try {
    const r = await fetch("/api/upload", { method: "POST", body: file });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok || !body.tree) return { error: String(body?.error || r.status) };
    return { tree: body.tree as TreeState, rev: body.rev ? String(body.rev) : null };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}

/**
 * Take the tree away as an archive — exactly the one that would lie in persons/ —
 * and hand it to `save`. Returns what went wrong, or null.
 */
export async function getZip(fetch: Fetch, save: (name: string, blob: Blob) => void): Promise<string | null> {
  try {
    const r = await fetch("/api/download", { cache: "no-store" });
    if (!r.ok) return String(r.status);
    save("persons.zip", await r.blob());
    return null;
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}

/** The most `navigator.sendBeacon` takes: a bigger body is refused, and only `false` says so. */
export const BEACON_LIMIT = 65536;

/** The body of the last write as the tab closes, for `navigator.sendBeacon`. */
export const beaconBody = (rev: string, tree: TreeState): Blob =>
  new Blob([JSON.stringify({ rev, tree })], { type: "application/json" });

/** Where the app fetches a photo from; the session cookie goes along by itself. */
export const photoUrl = (name: string): string => "/api/photo/" + name;

/** Store a JPEG on the server: the name it is kept under, or what went wrong. */
export async function postPhoto(fetch: Fetch, jpeg: Blob): Promise<{ photo: string } | { error: string }> {
  try {
    const r = await fetch("/api/photo", { method: "POST", headers: { "content-type": "image/jpeg" }, body: jpeg });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.ok || typeof body.photo !== "string") return { error: String(body?.error || r.status) };
    return { photo: body.photo };
  } catch (e) {
    return { error: String((e as Error)?.message ?? e) };
  }
}
