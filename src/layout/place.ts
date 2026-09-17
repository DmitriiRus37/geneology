/**
 * Расстановка карточек по x при уже известном порядке в рядах.
 *
 * Ряд состоит из блоков — супруги и явные братья с сёстрами стоят одним куском.
 * У блока один владелец: блок выше, где стоят родители того его члена, кто пришёл
 * в ряд ребёнком своей семьи. Так пара «ребёнок + супруг» достаётся одной семье.
 * Блоки без владельца — корни деревьев. Самое большое дерево — основное, остальные
 * — сваты: каждое подвешено к якорю, своему ребёнку, стоящему в блоке чужого дерева
 * (родители жены — над жёной).
 *
 * Кладём как Рейнгольд и Тилфорд. Гроздь блока — он сам, грозди его детей и
 * подвешенные к нему сваты. Грозди детей укладываются слева направо вплотную по
 * контуру: в каждом ряду не ближе обычного зазора. Родители встают над серединой
 * своих детей. Сваты укладываются вокруг уже готовой грозди ребёнка, она с места
 * не сходит — так никто ничьё место не занимает ни сверху, ни снизу, и место под
 * потомков не надо угадывать заранее.
 *
 * Единственный спор: родители, встав над детьми, налезают на сватов одного из детей
 * (те стоят в том же ряду). При двух и больше детях расступаются дети — между
 * гроздями вставляется зазор, чтобы сваты оказались слева или справа от родителей,
 * что дешевле. У единственного ребёнка отодвигаются сваты: ребёнок ровно под
 * родителями важнее, чем родители жены ровно над ней. Если и это невозможно,
 * отходят сами родители.
 */
import { extent, mean } from "../util.ts";
import type { Gaps, Graph, Union, Unions } from "./layout.ts";
import { NODE_W } from "./measure.ts";

export interface PlaceCtx {
  g: Graph;
  u: Unions;
  level: Record<string, number>;
  /** кто пришёл в ряд ребёнком своей семьи — по нему выбирается владелец блока */
  asChild: Set<string>;
  gaps: Gaps;
}

interface Blk {
  l: number;
  ids: string[];
  /** зазор между карточками блока: малый, у матери с двумя мужьями — до обычного */
  gap: number;
  /** ширина: карточки и зазоры между ними */
  w: number;
  /** центр */
  x: number;
  owner: Blk | null;
  /** дети-блоки: свои и якорь подвешенного дерева сватов; в порядке ряда */
  kids: Blk[];
  /** корни деревьев сватов, подвешенных к этому блоку */
  hung: Blk[];
  tree: number;
  /** вся гроздь: сам блок, грозди детей, подвешенные сваты */
  sub: Blk[];
  /** гроздь уложена и стоит: вокруг неё укладываются сваты */
  fixed: boolean;
  /** место в ряду, для порядка детей */
  key: number;
}

/** Контур грозди: по каждому ряду левый и правый края. */
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

/** На сколько сдвинуть гроздь `k` вправо, чтобы она встала вплотную справа от `acc`. */
const sep = (acc: Cont, k: Cont, gap: number): number => {
  let d = -Infinity;
  for (let r = 0; r < acc.L.length; r++) {
    if (acc.R[r] === -Infinity || k.L[r] === Infinity) continue;
    d = Math.max(d, acc.R[r] + gap - k.L[r]);
  }
  if (d !== -Infinity) return d;
  // общих рядов нет — ставим правее всего, что есть
  const accR = Math.max(...acc.R);
  const kL = Math.min(...k.L);
  return accR === -Infinity || kL === Infinity ? 0 : accR + gap - kL;
};

const widthOf = (c: Cont): number => Math.max(...c.R) - Math.min(...c.L);

/** Ходы, за которые спор родителей со сватами должен решиться. */
const ROUNDS = 40;

/**
 * Возвращает x центра каждой карточки компоненты; левый край не нормирован.
 * `rows[l]` — порядок ряда l, все ряды древа (пустые тоже).
 */
export function placeComponent(rows: string[][], ctx: PlaceCtx): Record<string, number> {
  const { g, u, asChild, gaps } = ctx;
  const nRows = rows.length;

  // блоки
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
  if (!blocks.length) return {};
  const cardOff = (b: Blk, id: string): number => -b.w / 2 + NODE_W / 2 + b.ids.indexOf(id) * (NODE_W + b.gap);
  const setGap = (b: Blk, gap: number): void => {
    b.gap = gap;
    b.w = NODE_W * b.ids.length + gap * (b.ids.length - 1);
  };
  const cardX = (id: string): number => {
    const b = blockOf.get(id) as Blk;
    return b.x + cardOff(b, id);
  };

  // владельцы
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

  // деревья
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

  // Якоря: ребёнок человека из дерева t, стоящий в блоке другого дерева. Дерево
  // подвешивается к первому якорю в уже подвешенном дереве; кольцо сватовства
  // разрывается по размеру — такое дерево встаёт рядом с основным само по себе.
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
  /** у блока на пути от корня сватов к якорю — тот ребёнок, в чьей грозди стоит якорь */
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
  /** блоки на пути от корня сватов к якорю (и сам якорь): их гроздь с места не сдвинуть */
  const pinnedSet = new Set(pinnedKid.values());

  // укладка
  /**
   * Сваты, которых родители отодвинули от их ребёнка: центр блока не левее (dir 1)
   * или не правее (dir −1) точки, заданной относительно якоря их дерева. Обычный
   * блок отодвигается при укладке у своего родителя — вместе со своей гроздью и
   * не налезая на соседей; блок на пути к якорю и корень дерева — сами по себе,
   * когда встают над детьми: их грозди с места не сдвинуть.
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
     * Уложить детей в этом порядке, встать над ними и решить споры со сватами.
     * Возвращает, удалось ли соблюсти все ограничения на детей.
     */
    const arrange = (order: Blk[]): boolean => {
      const extra = order.map(() => 0);
      let ok = true;
      const pack = (): void => {
        const acc = emptyCont(nRows);
        const packed: Blk[] = [];
        let afterPin = false;
        ok = true;
        /** сдвинуть уже уложенных: якорь стоит, ограничения «не левее» у них могут нарушиться */
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
            // якорь с места не сходит — подвинем уложенных до него
            shiftPacked(-sep(acc, contOf(K.sub), gaps.h + extra[i]));
            if (!packed.every(holds)) ok = false;
          } else {
            let d = sep(acc, contOf(K.sub), gaps.h + extra[i]);
            if (lim && lim.dir > 0) d = Math.max(d, lim.at - K.x);
            if (lim && lim.dir < 0 && K.x + d > lim.at) {
              // «не правее»: отодвигаем всех уложенных влево; за якорем это невозможно
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
        // Семьи блока, чьи дети стоят в детских блоках. Первой — та, что ровно под
        // своими родителями: полная пара раньше одного из супругов, меньше детей
        // раньше большего.
        type Fam = { idx: number; mid: number; np: number; n: number };
        const fams: Fam[] = [];
        const seen = new Set<Union>();
        for (const id of B.ids) {
          for (const un of u.byParent[id] ?? []) {
            if (seen.has(un)) continue;
            seen.add(un);
            const xs = un.children.filter((c) => order.includes(blockOf.get(c) as Blk)).map(cardX);
            if (!xs.length) continue;
            const inB = un.parents.filter((p) => B.ids.includes(p));
            const [lo, hi] = extent(xs, (v) => v);
            fams.push({ idx: mean(inB.map((p) => B.ids.indexOf(p))) as number, mid: (lo + hi) / 2, np: inB.length, n: xs.length });
          }
        }
        fams.sort((p, q) => q.np - p.np || p.n - q.n);
        // Вторая семья блока тоже встанет ровно, если раздвинуть его карточки: у матери
        // с двумя мужьями оба ребёнка отвесно, когда мужья стоят от неё на обычном
        // зазоре, а не на малом. Раздвигаем все зазоры поровну — но только если так
        // ровно встанут обе семьи и зазор не больше обычного: пара должна читаться как
        // пара, а ради половины поправки её растягивать не стоит.
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
      /** насколько блок U из грозди ребёнка налез на B (с зазором); ≤ 0 — не налез */
      const depth = (U: Blk): number => (U.w + B.w) / 2 + gaps.h - Math.abs(U.x - B.x);
      const conflict = (): { U: Blk; j: number } | null => {
        for (let j = 0; j < order.length; j++) {
          for (const U of order[j].sub) if (U.l === B.l && depth(U) > 0.5) return { U, j };
        }
        return null;
      };
      /** ближайшее к нынешнему место в ряду, где блок никого из гроздей детей не задевает */
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
        // расступиться детям: сваты слева от нас или справа — что дешевле
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
        // отодвинуть сватов от их ребёнка: гроздь ребёнка укладывается заново
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
        // отойти самим — на ближайшее свободное место
        if (!done) stepAside();
      }
      if (conflict()) stepAside();
      B.sub = [B, ...order.flatMap((K) => K.sub)];
      return ok;
    };

    // Свободные дети сватов вправе встать по любую сторону от якоря: порядок ряда
    // про них ничего не знает, он сложился обходом. Берём вариант, где гроздь уже;
    // при равенстве — порядок ряда.
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
      // сначала те, где ограничения соблюдены, среди них — уже
      if (!best || (ok && !best.ok) || (ok === best.ok && width < best.width - 0.5)) best = { order, width, ok };
      if (orders.length > 1) {
        // пробный заход мог отодвинуть сватов внутри грозди ребёнка — возвращаем как было
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
  for (const b of blocks) for (const id of b.ids) out[id] = cardX(id);
  return out;
}
