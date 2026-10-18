/**
 * The browser's own copy of the tree, in localStorage: what the app opens with when
 * there is no server to read from.
 */
import { normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";

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
