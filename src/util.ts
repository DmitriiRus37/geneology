/**
 * Small things that would otherwise be rewritten in every other file: lists by key,
 * the mean, the extent, merging into connected pieces.
 */

/** Put a value into the list under a key, creating the list on first use. */
export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The mean; an empty list gives null, not zero: "no kin" and "kin at zero" are different things. */
export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

/** The smallest and the largest value; an empty list gives [Infinity, -Infinity]. */
export function extent<T>(items: Iterable<T>, of: (item: T) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of items) {
    const v = of(it);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/**
 * A disjoint-set structure: it is what gathers the connected pieces of the tree —
 * components, the kin of one generation, overlapping buses. Path compression is done by
 * halving, so no recursion is needed on a deep tree.
 */
export class Merge<T> {
  private up = new Map<T, T>();

  root(a: T): T {
    let x = a;
    let up = this.up.get(x);
    while (up !== undefined && up !== x) {
      const gp = this.up.get(up) ?? up;
      this.up.set(x, gp);
      x = gp;
      up = this.up.get(x);
    }
    return x;
  }

  join(a: T, b: T): void {
    const ra = this.root(a);
    const rb = this.root(b);
    if (ra !== rb) this.up.set(ra, rb);
  }

  /** The pieces in order of the first appearance of their people in the input list. */
  parts(items: readonly T[]): T[][] {
    const byRoot = new Map<T, T[]>();
    for (const it of items) push(byRoot, this.root(it), it);
    return [...byRoot.values()];
  }
}
