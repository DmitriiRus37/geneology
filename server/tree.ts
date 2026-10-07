/**
 * The tree over a store: cards in and out through src/model/cards.ts, and the
 * write queue with the fingerprint check that keeps a stale tab from overwriting
 * fresh edits.
 */
import { cardIdOf, cardsToTree, okId, treeToCards, VIEW, type WireTree } from "../src/model/cards.ts";
import type { Store } from "./stores.ts";

/**
 * From the archive we take cards only. The folder inside the archive does not
 * matter — we take the short name, so both `persons/p1.json` and plain `p1.json`
 * land the same way. macOS litter (`__MACOSX`, `._name`, `.DS_Store`) is dropped
 * silently: it is always in there.
 */
export function cardsOf(entries: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, text] of entries) {
    if (name.includes("__MACOSX/")) continue;
    const base = name.slice(name.lastIndexOf("/") + 1);
    if (base.startsWith("._") || base === ".DS_Store" || !base.endsWith(".json")) continue;
    if (base !== VIEW && !okId(base.slice(0, -5))) continue;
    out.set(base, text);
  }
  return out;
}

export type SaveResult =
  | { conflict: true; rev: string }
  | { conflict?: undefined; written: number; removed: number; total: number; rev: string };

export interface Tree {
  store: Store;
  read(): Promise<WireTree | null>;
  /** Write `tree` if the store is still at `rev`; writes go in turn. */
  save(rev: string, tree: unknown): Promise<SaveResult>;
  /** Replace everything with the cards of an archive (memory only), in turn with the writes. */
  upload(cards: Map<string, string>): Promise<{ tree: WireTree | null; rev: string }>;
  /** Every file of the store by name, in name order. */
  files(): Promise<Map<string, string>>;
}

export function createTree(store: Store): Tree {
  let queue: Promise<unknown> = Promise.resolve(); // writes go in turn so they do not step on each other
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next;
    return next;
  };

  async function read() {
    const names = await store.names();
    if (!names) return cardsToTree(null, console.warn);
    const files: [string, string][] = [];
    for (const name of [...names].sort()) files.push([name, await store.read(name)]);
    return cardsToTree(files, console.warn);
  }

  async function write(tree: unknown) {
    const { ids, cards, view } = treeToCards(tree);
    let written = 0;
    for (const [name, text] of cards) if (await store.write(name, text)) written++;
    await store.write(VIEW, view);

    // deleted people leave together with their files; a file that was nobody's card
    // stays where it is: it was never shown, so nobody can have meant to delete it
    let removed = 0;
    const keep = new Set(cards.map(([name]) => name));
    for (const name of (await store.names()) ?? []) {
      if (name.startsWith("_") || keep.has(name)) continue;
      if (!cardIdOf(name, await store.read(name))) continue;
      await store.remove(name);
      removed++;
    }
    return { written, removed, total: ids.length };
  }

  return {
    store,
    read,
    save: (rev, tree) =>
      inTurn(async (): Promise<SaveResult> => {
        const now = await store.rev();
        if (rev !== now) return { conflict: true, rev: now };
        const st = await write(tree);
        return { ...st, rev: await store.rev() };
      }),
    upload: (cards) =>
      inTurn(async () => {
        if (store.kind === "memory") store.replace(cards);
        return { tree: await read(), rev: await store.rev() };
      }),
    async files() {
      const out = new Map<string, string>();
      for (const n of [...((await store.names()) ?? [])].sort()) out.set(n, await store.read(n));
      return out;
    },
  };
}
