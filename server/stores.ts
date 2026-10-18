/**
 * Where the cards lie: a folder on disk or a map in memory, behind one interface.
 * A store knows files and their fingerprint, nothing about people. Photos lie apart,
 * in `photos/`: they are named after their contents and never change, so they take
 * no part in the fingerprint.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PHOTOS } from "../src/model/cards.ts";

interface Common {
  /** the folder, or "server memory" */
  where: string;
  /** the `.json` files, or null when there is nothing at all yet */
  names(): Promise<string[] | null>;
  read(name: string): Promise<string>;
  /** false when the file already held exactly this */
  write(name: string, text: string): Promise<boolean>;
  remove(name: string): Promise<void>;
  /** The fingerprint of everything in the store: "empty" when there is nothing. */
  rev(): Promise<string>;
  /** a photo's bytes, or null when there is no such photo */
  photo(name: string): Promise<Buffer | null>;
  /** a photo is named after its contents: one already there is left as it is */
  putPhoto(name: string, bytes: Buffer): Promise<void>;
}

export interface DiskStore extends Common {
  kind: "disk";
}

export interface MemStore extends Common {
  kind: "memory";
  /** Everything at once: an uploaded archive replaces the whole tree, photos included. */
  replace(files: Map<string, string>, photos: Map<string, Buffer>): void;
}

export type Store = DiskStore | MemStore;

/** We write through a temporary file: an interrupted write will not spoil the existing one. */
async function writeAtomic(path: string, text: string | Buffer): Promise<void> {
  const tmp = path + ".tmp";
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/**
 * A folder on disk. The fingerprint comes from file mtime and size: the tab sends
 * the one it saw last, and if something on disk changed since then the write is
 * refused. Without this a forgotten open tab with an old tree used to overwrite
 * fresh edits.
 */
export function diskStore(dir: string): DiskStore {
  const store: DiskStore = {
    kind: "disk",
    where: dir,
    async names() {
      try {
        return (await readdir(dir)).filter((n) => n.endsWith(".json"));
      } catch {
        return null; // the directory does not exist yet — the app will seed it itself
      }
    },
    read: (name) => readFile(join(dir, name), "utf8"),
    async write(name, text) {
      await mkdir(dir, { recursive: true });
      let old = null;
      try {
        old = await readFile(join(dir, name), "utf8");
      } catch {
        /* no file yet — just create it */
      }
      // rewrite only if the file really changed: mtime is part of the fingerprint
      if (old === text) return false;
      await writeAtomic(join(dir, name), text);
      return true;
    },
    remove: (name) => unlink(join(dir, name)),
    async rev() {
      const names = await store.names();
      if (!names) return "empty";
      const parts = [];
      for (const n of names.sort()) {
        const st = await stat(join(dir, n));
        parts.push(n + ":" + Math.round(st.mtimeMs) + ":" + st.size);
      }
      return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
    },
    async photo(name) {
      try {
        return await readFile(join(dir, PHOTOS, name));
      } catch {
        return null;
      }
    },
    async putPhoto(name, bytes) {
      const path = join(dir, PHOTOS, name);
      if (await stat(path).then(() => true, () => false)) return;
      await mkdir(join(dir, PHOTOS), { recursive: true });
      await writeAtomic(path, bytes);
    },
  };
  return store;
}

/**
 * The same thing, but in memory: nothing reaches the disk. The fingerprint is
 * computed over the contents — there is no mtime to take here, and the meaning
 * of it is the same.
 */
export function memStore(): MemStore {
  let files = new Map<string, string>();
  let photos = new Map<string, Buffer>();
  return {
    kind: "memory",
    where: "server memory",
    async names() {
      return files.size ? [...files.keys()] : null;
    },
    async read(name) {
      return files.get(name) ?? "";
    },
    async write(name, text) {
      if (files.get(name) === text) return false;
      files.set(name, text);
      return true;
    },
    async remove(name) {
      files.delete(name);
    },
    async rev() {
      if (!files.size) return "empty";
      const sum = createHash("sha1");
      for (const n of [...files.keys()].sort()) sum.update(n).update(files.get(n) as string);
      return sum.digest("hex").slice(0, 16);
    },
    async photo(name) {
      return photos.get(name) ?? null;
    },
    async putPhoto(name, bytes) {
      if (!photos.has(name)) photos.set(name, bytes);
    },
    replace(next, nextPhotos) {
      files = next;
      photos = nextPhotos;
    },
  };
}
