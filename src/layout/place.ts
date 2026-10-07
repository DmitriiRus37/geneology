/**
 * Placing cards along x once the order within the rows is already known.
 *
 * A row consists of blocks — spouses and explicit siblings stand as one piece. A
 * block has a single owner: the block above, where the parents stand of whichever
 * of its members came into the row as a child of their own family. That way the
 * "child + spouse" pair falls to one family. Blocks with no owner are the roots of
 * trees. The largest tree is the main one, the rest are in-laws: each hangs from an
 * anchor, its own child standing in a block of someone else's tree (the wife's
 * parents go above the wife).
 *
 * We lay it out the Reingold-Tilford way. A block's cluster is the block itself,
 * the clusters of its children and the in-laws hung from it. The children's
 * clusters are packed left to right tight against the contour: in every row no
 * closer than the normal gap. Parents stand over the middle of their children.
 * In-laws are packed around a child's already finished cluster, which does not move
 * — that way nobody takes anyone else's place, above or below, and there is no need
 * to guess in advance how much room the descendants will want.
 *
 * The single dispute: parents, having stood over their children, run into the
 * in-laws of one of those children (who stand in the same row). With two children
 * or more the children step aside — a gap is inserted between the clusters so that
 * the in-laws end up to the left or to the right of the parents, whichever is
 * cheaper. With an only child the in-laws are moved instead: the child exactly
 * under its parents matters more than the wife's parents exactly over her. If even
 * that is impossible, the parents themselves step away.
 */
import { extent, mean } from "../util.ts";
import type { Graph, Union, Unions } from "./families.ts";
import type { Gaps } from "./layout.ts";
import { NODE_W } from "./measure.ts";

export interface PlaceCtx {
  g: Graph;
  u: Unions;
  level: Record<string, number>;
  /** who came into the row as a child of their own family — the block's owner is chosen by them */
  asChild: Set<string>;
  gaps: Gaps;
}

interface Blk {
  l: number;
  ids: string[];
  /** the gap between the block's cards: small, and up to normal for a mother with two husbands */
  gap: number;
  /** width: the cards and the gaps between them */
  w: number;
  /** centre */
  x: number;
  owner: Blk | null;
  /** child blocks: its own, plus the anchor of a hung in-law tree; in row order */
  kids: Blk[];
  /** the roots of the in-law trees hung from this block */
  hung: Blk[];
  tree: number;
  /** the whole cluster: the block itself, the children's clusters, the hung in-laws */
  sub: Blk[];
  /** the cluster is packed and standing: the in-laws are packed around it */
  fixed: boolean;
  /** the place in the row, for ordering the children */
  key: number;
}

/** A cluster's contour: the left and right edges for each row. */
interface Cont {
  L: number[];
  R: number[];
}

const emptyCont = (n: number): Cont => ({ L: new Array(n).fill(Infinity), R: new Array(n).fill(-Infinity) });

const addTo = (c: Cont, bs: Blk[]): void => {
  for (const b of bs) {
    const l = b.x - b.w / 2;
    const r = b.x + b.w / 2;
    if (l < c.L[b.l]) c.L[b.l] = l;
    if (r > c.R[b.l]) c.R[b.l] = r;
  }
};

const shiftCont = (c: Cont, d: number): void => {
  for (let r = 0; r < c.L.length; r++) {
    if (c.L[r] !== Infinity) c.L[r] += d;
    if (c.R[r] !== -Infinity) c.R[r] += d;
  }
};

/** How far to shift cluster `k` right so it stands tight to the right of `acc`. */
const sep = (acc: Cont, k: Cont, gap: number): number => {
  let d = -Infinity;
  for (let r = 0; r < acc.L.length; r++) {
    if (acc.R[r] === -Infinity || k.L[r] === Infinity) continue;
    d = Math.max(d, acc.R[r] + gap - k.L[r]);
  }
  if (d !== -Infinity) return d;
  // no rows in common — put it to the right of everything there is
  const accR = Math.max(...acc.R);
  const kL = Math.min(...k.L);
  return accR === -Infinity || kL === Infinity ? 0 : accR + gap - kL;
};

const widthOf = (c: Cont): number => Math.max(...c.R) - Math.min(...c.L);

/** The moves within which the parents' dispute with the in-laws must be settled. */
const ROUNDS = 40;

const cardOff = (b: Blk, id: string): number => -b.w / 2 + NODE_W / 2 + b.ids.indexOf(id) * (NODE_W + b.gap);

const setGap = (b: Blk, gap: number): void => {
  b.gap = gap;
  b.w = NODE_W * b.ids.length + gap * (b.ids.length - 1);
};

const cardX = (blockOf: Map<string, Blk>, id: string): number => {
  const b = blockOf.get(id) as Blk;
  return b.x + cardOff(b, id);
};

/** Splits every row into blocks: spouses and explicit siblings stand as one piece. */
function buildBlocks(rows: string[][], u: Unions, gaps: Gaps): { blocks: Blk[]; blockOf: Map<string, Blk> } {
  const blocks: Blk[] = [];
  const blockOf = new Map<string, Blk>();
  rows.forEach((row, l) => {
    let a = 0;
    for (let i = 1; i <= row.length; i++) {
      if (i < row.length && u.isCouple(row[i - 1], row[i])) continue;
      const ids = row.slice(a, i);
      const b: Blk = {
        l,
        ids,
        gap: gaps.couple,
        w: NODE_W * ids.length + gaps.couple * (ids.length - 1),
        x: 0,
        owner: null,
        kids: [],
        hung: [],
        tree: -1,
        sub: [],
        fixed: false,
        key: (a + i) / 2 / row.length,
      };
      blocks.push(b);
      for (const id of ids) blockOf.set(id, b);
      a = i;
    }
  });
  return { blocks, blockOf };
}

/** A block's owner: the block above holding the parents of whichever member came in as a child. */
function assignOwners(blocks: Blk[], blockOf: Map<string, Blk>, g: Graph, asChild: Set<string>): void {
  const parentBlock = (id: string, l: number): Blk | null => {
    for (const p of g.parents[id]) {
      const pb = blockOf.get(p);
      if (pb && pb.l < l) return pb;
    }
    return null;
  };
  for (const b of blocks) {
    const pick = b.ids.find((id) => asChild.has(id) && parentBlock(id, b.l)) ?? b.ids.find((id) => parentBlock(id, b.l));
    if (!pick) continue;
    b.owner = parentBlock(pick, b.l);
    b.owner?.kids.push(b);
  }
}

/** The trees blocks make through their owners, and which of them is the main one (the largest). */
function growTrees(blocks: Blk[]): { roots: Blk[]; size: number[]; main: number } {
  const roots = blocks.filter((b) => !b.owner);
  roots.forEach((r, t) => {
    const stack = [r];
    while (stack.length) {
      const b = stack.pop() as Blk;
      b.tree = t;
      for (const k of b.kids) stack.push(k);
    }
  });
  const size = roots.map(() => 0);
  for (const b of blocks) size[b.tree] += b.ids.length;
  let main = 0;
  for (let t = 1; t < roots.length; t++) if (size[t] > size[main]) main = t;
  return { roots, size, main };
}

/**
 * Anchors: a child of someone from tree t, standing in a block of another tree.
 * A tree is hung from the first anchor inside an already hung tree; a ring of
 * in-laws is broken by size — such a tree stands next to the main one on its own.
 */
function hangInLaws(blocks: Blk[], blockOf: Map<string, Blk>, g: Graph, roots: Blk[], size: number[], main: number) {
  const cands: { C: Blk; P: Blk }[][] = roots.map(() => []);
  for (const P of blocks) {
    for (const id of P.ids) {
      for (const c of g.children[id]) {
        const C = blockOf.get(c);
        if (!C || C.tree === P.tree || C.l <= P.l) continue;
        if (!cands[P.tree].some((cd) => cd.C === C && cd.P === P)) cands[P.tree].push({ C, P });
      }
    }
  }
  const attached = roots.map((_, t) => t === main);
  const hungAt = new Map<number, Blk>();
  const free: Blk[] = [];
  /** for a block on the way from the in-law root to the anchor — the child in whose cluster the anchor stands */
  const pinnedKid = new Map<Blk, Blk>();
  for (let remaining = roots.length - 1; remaining > 0; remaining--) {
    let pick = -1;
    let cand: { C: Blk; P: Blk } | undefined;
    for (let t = 0; t < roots.length && pick < 0; t++) {
      if (attached[t]) continue;
      cand = cands[t].find((cd) => attached[cd.C.tree]);
      if (cand) pick = t;
    }
    if (pick >= 0 && cand) {
      attached[pick] = true;
      cand.P.kids.push(cand.C);
      cand.C.hung.push(roots[pick]);
      hungAt.set(pick, cand.C);
      let kid = cand.C;
      for (let X: Blk | null = cand.P; X; X = X.owner) {
        pinnedKid.set(X, kid);
        kid = X;
      }
    } else {
      for (let t = 0; t < roots.length; t++) if (!attached[t] && (pick < 0 || size[t] > size[pick])) pick = t;
      attached[pick] = true;
      free.push(roots[pick]);
    }
  }
  for (const b of blocks) b.kids.sort((p, q) => p.key - q.key || p.l - q.l);
  /** blocks on the way from the in-law root to the anchor (and the anchor itself): their cluster cannot be moved */
  const pinnedSet = new Set(pinnedKid.values());
  return { hungAt, free, pinnedKid, pinnedSet };
}

interface Packing {
  nRows: number;
  gaps: Gaps;
  u: Unions;
  blockOf: Map<string, Blk>;
  hungAt: Map<number, Blk>;
  pinnedKid: Map<Blk, Blk>;
  pinnedSet: Set<Blk>;
}

/**
 * The packing: `lay` stands a block's cluster up — its children packed tight against
 * the contour, the block over the middle of them, the disputes with the in-laws
 * settled. `shift` and `contOf` are what the caller needs to put trees side by side.
 */
function packer({ nRows, gaps, u, blockOf, hungAt, pinnedKid, pinnedSet }: Packing) {
  /**
   * In-laws that the parents pushed away from their child: the block's centre is
   * no further left (dir 1) or no further right (dir −1) than a point given
   * relative to their tree's anchor. An ordinary block is pushed while being packed
   * at its own parent — together with its cluster and without running into its
   * neighbours; a block on the way to the anchor, and the root of a tree, are moved
   * on their own, as they stand over their children: their clusters cannot be moved.
   */
  const constraints = new Map<Blk, { anchor: Blk; off: number; dir: 1 | -1 }>();
  const limitOf = (K: Blk): { at: number; dir: 1 | -1 } | null => {
    const c = constraints.get(K);
    return c ? { at: c.anchor.x + c.off, dir: c.dir } : null;
  };
  const shift = (bs: Blk[], d: number): void => {
    for (const b of bs) b.x += d;
  };
  const contOf = (bs: Blk[]): Cont => {
    const c = emptyCont(nRows);
    addTo(c, bs);
    return c;
  };

  const lay = (B: Blk): void => {
    if (B.fixed) return;
    for (const K of B.kids) lay(K);
    const pinned = pinnedKid.get(B) ?? null;

    /**
     * Pack the children in this order, stand over them and settle the disputes with
     * the in-laws. Returns whether every constraint on the children was met.
     */
    const arrange = (order: Blk[]): boolean => {
      const extra = order.map(() => 0);
      let ok = true;
      const pack = (): void => {
        const acc = emptyCont(nRows);
        const packed: Blk[] = [];
        let afterPin = false;
        ok = true;
        /** shift those already packed: the anchor stands still, so their "no further left" constraints may break */
        const shiftPacked = (d: number): void => {
          for (const P of packed) shift(P.sub, d);
          shiftCont(acc, d);
        };
        const holds = (P: Blk): boolean => {
          const lim = limitOf(P);
          return !lim || P === pinned || (lim.dir > 0 ? P.x >= lim.at - 0.5 : P.x <= lim.at + 0.5);
        };
        order.forEach((K, i) => {
          const lim = K === pinned ? null : limitOf(K);
          if (!packed.length) {
            if (lim && (lim.dir > 0 ? K.x < lim.at : K.x > lim.at)) shift(K.sub, lim.at - K.x);
          } else if (K === pinned) {
            // the anchor does not move — so we shift those packed before it
            shiftPacked(-sep(acc, contOf(K.sub), gaps.h + extra[i]));
            if (!packed.every(holds)) ok = false;
          } else {
            let d = sep(acc, contOf(K.sub), gaps.h + extra[i]);
            if (lim && lim.dir > 0) d = Math.max(d, lim.at - K.x);
            if (lim && lim.dir < 0 && K.x + d > lim.at) {
              // "no further right": push everyone packed to the left; past the anchor that is impossible
              if (afterPin) ok = false;
              else shiftPacked(lim.at - (K.x + d));
            }
            shift(K.sub, d);
          }
          if (K === pinned) afterPin = true;
          addTo(acc, K.sub);
          packed.push(K);
        });
      };
      const center = (): void => {
        // The block's families whose children stand in the child blocks. First comes
        // the one exactly under its own parents: a full couple before a single
        // spouse, fewer children before more.
        type Fam = { idx: number; mid: number; np: number; n: number };
        const fams: Fam[] = [];
        const seen = new Set<Union>();
        for (const id of B.ids) {
          for (const un of u.byParent[id] ?? []) {
            if (seen.has(un)) continue;
            seen.add(un);
            const xs = un.children.filter((c) => order.includes(blockOf.get(c) as Blk)).map((c) => cardX(blockOf, c));
            if (!xs.length) continue;
            const inB = un.parents.filter((p) => B.ids.includes(p));
            const [lo, hi] = extent(xs, (v) => v);
            fams.push({ idx: mean(inB.map((p) => B.ids.indexOf(p))) as number, mid: (lo + hi) / 2, np: inB.length, n: xs.length });
          }
        }
        fams.sort((p, q) => q.np - p.np || p.n - q.n);
        // The block's second family will stand straight too if its cards are spread
        // apart: for a mother with two husbands both children hang vertically once
        // the husbands stand a normal gap away from her rather than a small one. We
        // spread every gap equally — but only if both families come out straight
        // that way and the gap is no wider than normal: a couple must read as a
        // couple, and stretching it for half a fix is not worth it.
        let gap = gaps.couple;
        if (fams.length >= 2 && Math.abs(fams[1].idx - fams[0].idx) > 1e-6) {
          const need = (fams[1].mid - fams[0].mid) / (fams[1].idx - fams[0].idx) - NODE_W;
          if (need > gaps.couple && need <= gaps.h + 0.5) gap = need;
        }
        setGap(B, gap);
        if (fams.length) B.x = fams[0].mid - (fams[0].idx - (B.ids.length - 1) / 2) * (NODE_W + gap);
        const lim = !B.owner || pinnedSet.has(B) ? limitOf(B) : null;
        if (lim) B.x = lim.dir > 0 ? Math.max(B.x, lim.at) : Math.min(B.x, lim.at);
      };
      /** by how much block U from a child's cluster runs into B (gap included); <= 0 — it does not */
      const depth = (U: Blk): number => (U.w + B.w) / 2 + gaps.h - Math.abs(U.x - B.x);
      const conflict = (): { U: Blk; j: number } | null => {
        for (let j = 0; j < order.length; j++) {
          for (const U of order[j].sub) if (U.l === B.l && depth(U) > 0.5) return { U, j };
        }
        return null;
      };
      /** the place in the row nearest the current one where the block touches none of the children's clusters */
      const stepAside = (): void => {
        const row = order.flatMap((K) => K.sub).filter((U) => U.l === B.l);
        const from = B.x;
        const clear = (x: number): boolean => row.every((U) => Math.abs(U.x - x) >= (U.w + B.w) / 2 + gaps.h - 0.5);
        let best = clear(from) ? from : NaN;
        for (const U of row) {
          for (const x of [U.x - U.w / 2 - gaps.h - B.w / 2, U.x + U.w / 2 + gaps.h + B.w / 2]) {
            if (clear(x) && (Number.isNaN(best) || Math.abs(x - from) < Math.abs(best - from))) best = x;
          }
        }
        if (!Number.isNaN(best)) B.x = best;
      };

      pack();
      center();
      for (let it = 0; it < ROUNDS; it++) {
        const hit = conflict();
        if (!hit) break;
        const { U, j } = hit;
        const d0 = depth(U);
        const n = order.length - 1;
        let done = false;
        // let the children step aside: in-laws to our left or to our right, whichever is cheaper
        if (order.length >= 2) {
          const opts: { i: number; d: number }[] = [];
          if (j < n) opts.push({ i: j + 1, d: 2 * (U.x + U.w / 2 + gaps.h - (B.x - B.w / 2)) });
          if (j > 0) opts.push({ i: j, d: 2 * (B.x + B.w / 2 + gaps.h - (U.x - U.w / 2)) });
          opts.sort((p, q) => p.d - q.d);
          for (const o of opts) {
            extra[o.i] += o.d;
            pack();
            center();
            if (depth(U) < d0 - 0.5) {
              done = true;
              break;
            }
            extra[o.i] -= o.d;
            pack();
            center();
          }
        }
        // push the in-laws away from their child: the child's cluster is packed again
        if (!done && !order[j].fixed) {
          const anchor = hungAt.get(U.tree);
          if (anchor) {
            const right = U.x >= B.x;
            const target = right ? B.x + B.w / 2 + gaps.h + U.w / 2 : B.x - B.w / 2 - gaps.h - U.w / 2;
            const prev = constraints.get(U);
            constraints.set(U, { anchor, off: target - anchor.x, dir: right ? 1 : -1 });
            lay(order[j]);
            pack();
            center();
            if (depth(U) < d0 - 0.5) done = true;
            else {
              if (prev) constraints.set(U, prev);
              else constraints.delete(U);
              lay(order[j]);
              pack();
              center();
            }
          }
        }
        // step away ourselves — to the nearest free place
        if (!done) stepAside();
      }
      if (conflict()) stepAside();
      B.sub = [B, ...order.flatMap((K) => K.sub)];
      return ok;
    };

    // The in-laws' free children may stand on either side of the anchor: the row
    // order knows nothing about them, it came out of the traversal. We take the
    // variant with the narrower cluster; on a tie, the row order.
    const freeKids = pinned ? B.kids.filter((K) => K !== pinned) : [];
    const orders: Blk[][] = [B.kids];
    if (pinned && freeKids.length && freeKids.length <= 4) {
      for (let mask = 0; mask < 1 << freeKids.length; mask++) {
        const left: Blk[] = [];
        const right: Blk[] = [];
        freeKids.forEach((K, i) => ((mask >> i) & 1 ? right : left).push(K));
        const order = [...left, pinned, ...right];
        if (!order.every((K, i) => K === B.kids[i])) orders.push(order);
      }
    }
    let best: { order: Blk[]; width: number; ok: boolean } | null = null;
    for (const order of orders) {
      const before = new Map(constraints);
      const ok = arrange(order);
      const width = widthOf(contOf(B.sub));
      // first the ones where the constraints hold, and among those the narrower
      if (!best || (ok && !best.ok) || (ok === best.ok && width < best.width - 0.5)) best = { order, width, ok };
      if (orders.length > 1) {
        // a trial run may have pushed in-laws inside the child's cluster — put it back
        const changed = [...constraints.keys()].filter((k) => constraints.get(k) !== before.get(k));
        if (changed.length || before.size !== constraints.size) {
          constraints.clear();
          for (const [k, v] of before) constraints.set(k, v);
          for (const K of B.kids) lay(K);
        }
      }
    }
    if (best && orders.length > 1) arrange(best.order);

    for (const R of B.hung) {
      B.fixed = true;
      lay(R);
      B.fixed = false;
      B.sub = R.sub;
    }
  };
  return { lay, shift, contOf };
}

/**
 * Returns the x of the centre of every card in the component; the left edge is not
 * normalised. `rows[l]` is the order of row l, all rows of the tree (empty ones too).
 */
export function placeComponent(rows: string[][], ctx: PlaceCtx): Record<string, number> {
  const { g, u, asChild, gaps } = ctx;
  const { blocks, blockOf } = buildBlocks(rows, u, gaps);
  if (!blocks.length) return {};
  assignOwners(blocks, blockOf, g, asChild);
  const { roots, size, main } = growTrees(blocks);
  const { hungAt, free, pinnedKid, pinnedSet } = hangInLaws(blocks, blockOf, g, roots, size, main);
  const { lay, shift, contOf } = packer({ nRows: rows.length, gaps, u, blockOf, hungAt, pinnedKid, pinnedSet });

  const root = roots[main];
  lay(root);
  const all = root.sub.slice();
  const acc = contOf(all);
  for (const R of free) {
    lay(R);
    shift(R.sub, sep(acc, contOf(R.sub), gaps.h));
    addTo(acc, R.sub);
    all.push(...R.sub);
  }

  const out: Record<string, number> = {};
  for (const b of blocks) for (const id of b.ids) out[id] = cardX(blockOf, id);
  return out;
}
