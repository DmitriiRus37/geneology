/**
 * The tree over a store: cards in and out through src/model/cards.ts, and the
 * write queue with the fingerprint check that keeps a stale tab from overwriting
 * fresh edits.
 */
import { cardIdOf, cardsToTree, okId, okPhoto, PHOTOS, treeToCards, VIEW, type WireTree } from "../src/model/cards.ts";
import type { Store } from "./stores.ts";

/**
 * From the archive we take cards only. The folder inside the archive does not
 * matter — we take the short name, so both `persons/p1.json` and plain `p1.json`
 * land the same way. macOS litter (`__MACOSX`, `._name`, `.DS_Store`) is dropped
 * silently: it is always in there.
 */
export function cardsOf(entries: Map<string, Buffer>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, bytes] of entries) {
    if (name.includes("__MACOSX/")) continue;
    const base = name.slice(name.lastIndexOf("/") + 1);
    if (base.startsWith("._") || base === ".DS_Store" || !base.endsWith(".json")) continue;
    if (base !== VIEW && !okId(base.slice(0, -5))) continue;
    out.set(base, bytes.toString("utf8"));
  }
  return out;
}

/** Whether these bytes start the way every JPEG does. */
export const isJpeg = (b: Buffer): boolean => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** The photos of an archive: JPEGs in a `photos/` folder, under the names the app gives them. */
export function photosOf(entries: Map<string, Buffer>): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [name, bytes] of entries) {
    if (name.includes("__MACOSX/")) continue;
    const parts = name.split("/");
    const base = parts[parts.length - 1];
    if (parts[parts.length - 2] === PHOTOS && okPhoto(base) && isJpeg(bytes)) out.set(base, bytes);
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
  /**
   * Take in the cards and photos of an archive, in turn with the writes. In memory they
   * replace everything; a folder takes them only while it holds nobody's card, so an
   * archive can fill an empty folder but never overwrite a tree. Null when refused.
   */
  upload(cards: Map<string, string>, photos: Map<string, Buffer>): Promise<{ tree: WireTree | null; rev: string } | null>;
  /** Every file of the store by name, in name order. */
  files(): Promise<Map<string, string>>;
  /** The photos the cards show, by name; one a card names but the store lacks is left out. */
  photos(): Promise<Map<string, Buffer>>;
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
    upload: (cards, photos) =>
      inTurn(async () => {
        if (store.kind === "memory") store.replace(cards, photos);
        else {
          for (const name of (await store.names()) ?? []) if (cardIdOf(name, await store.read(name))) return null;
          for (const [name, bytes] of photos) await store.putPhoto(name, bytes);
          for (const [name, text] of cards) await store.write(name, text);
        }
        return { tree: await read(), rev: await store.rev() };
      }),
    async files() {
      const out = new Map<string, string>();
      for (const n of [...((await store.names()) ?? [])].sort()) out.set(n, await store.read(n));
      return out;
    },
    async photos() {
      const out = new Map<string, Buffer>();
      const names = Object.values((await read())?.people ?? {}).map((p) => p.photo);
      for (const name of [...new Set(names.filter(okPhoto))].sort()) {
        const bytes = await store.photo(name);
        if (bytes) out.set(name, bytes);
      }
      return out;
    },
  };
}
