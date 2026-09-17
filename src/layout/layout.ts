import type { Lang } from "../i18n.ts";
import { birthKey, yearOfBirth } from "../model/dates.ts";
import { siblingsOf, visibleState } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { NODE_W, sizeOf, type CardLine } from "./measure.ts";
import type { Rect } from "./route.ts";
import { roundsFor, tidyTies, untangle } from "./order.ts";
import { placeComponent } from "./place.ts";
import { applyTimeline, type Timeline } from "./timeline.ts";
import { extent, Merge, push } from "../util.ts";

export interface Box {
  x: number; // центр карточки
  y: number; // верх карточки
  w: number;
  h: number;
  lines: CardLine[];
}

/** Карточка как препятствие для линий. */
export const rectOf = (b: Box): Rect => ({ x1: b.x - b.w / 2, y1: b.y, x2: b.x + b.w / 2, y2: b.y + b.h });

export interface Graph {
  parents: Record<string, string[]>;
  children: Record<string, string[]>;
}

export interface Union {
  parents: string[];
  children: string[];
  key: string;
  first: number;
}

export interface Unions {
  list: Union[];
  byParent: Record<string, Union[]>;
  isCouple: (a: string, b: string) => boolean;
}

export interface LayoutResult {
  pos: Record<string, Box>;
  level: Record<string, number>;
  tl: Timeline | null;
  graph: Graph;
  /** где подписать блок людей без единой связи */
  lonePlate: { x: number; y: number; w: number } | null;
}

const H_GAP0 = 58;
const COUPLE_GAP0 = 24;
const V_GAP0 = 124;
const COMP_GAP0 = 180;

export interface Gaps {
  h: number;
  couple: number;
  v: number;
  comp: number;
}

const gapsFor = (k: number): Gaps => ({
  h: Math.round(H_GAP0 * k),
  couple: Math.round(COUPLE_GAP0 * k),
  v: Math.round(V_GAP0 * k),
  comp: Math.round(COMP_GAP0 * k),
});

export function graphOf(state: TreeState): Graph {
  const parents: Record<string, string[]> = {};
  const children: Record<string, string[]> = {};
  for (const id of Object.keys(state.people)) {
    parents[id] = [];
    children[id] = [];
  }
  for (const l of state.links) {
    if (!state.people[l.parent] || !state.people[l.child]) continue;
    if (parents[l.child].indexOf(l.parent) < 0) parents[l.child].push(l.parent);
    if (children[l.parent].indexOf(l.child) < 0) children[l.parent].push(l.child);
  }
  return { parents, children };
}

/** Поколение: ребёнок всегда ниже самого «молодого» из родителей, супруги — вровень. */
function computeLevels(state: TreeState, g: Graph): Record<string, number> {
  const ids = Object.keys(state.people);
  const level: Record<string, number> = {};
  for (const id of ids) level[id] = 0;
  const guard = ids.length + 6;
  /** Кому положено стоять в одном ряду: супруги и явные брат с сестрой. */
  const sideBySidePairs = [...state.pairs, ...state.sibs].filter(
    (pr) => state.people[pr.a] && state.people[pr.b],
  );

  /**
   * Ребёнок ниже родителей, супруги вровень, братья и сёстры вровень — до покоя.
   * Возвращает, сошлось ли: брак поперёк поколений (женился на правнучке
   * двоюродной сестры) делает правила несовместимыми, и уровни уходят вниз без
   * конца — тогда братьев не выравниваем, как было до этого правила.
   */
  const relax = (siblings: boolean): boolean => {
  for (let it = 0; it < guard; it++) {
    let changed = false;
    for (const id of ids) {
      const ps = g.parents[id];
      if (!ps.length) continue;
      let m = 0;
      for (const p of ps) if (level[p] > m) m = level[p];
      for (const p of ps) {
        if (level[p] < m) {
          level[p] = m;
          changed = true;
        }
      }
      if (level[id] < m + 1) {
        level[id] = m + 1;
        changed = true;
      }
    }
    // супруги вровень; явное братство держится тем же правилом
    for (const pr of sideBySidePairs) {
      const m = Math.max(level[pr.a], level[pr.b]);
      for (const who of [pr.a, pr.b]) {
        if (level[who] < m) {
          level[who] = m;
          changed = true;
        }
      }
    }
    // Братья и сёстры — одно поколение, один ряд. Иначе брат, которого брак увёл
    // вниз, оказывался на три ряда ниже брата-холостяка, а их родители зависали в
    // шапке: подтягивание к детям смотрит на самого верхнего ребёнка. Вниз двигать
    // всегда можно — правило «ребёнок ниже родителя» от этого не страдает.
    for (const id of siblings ? ids : []) {
      const kids = g.children[id];
      if (kids.length < 2) continue;
      let m = 0;
      for (const c of kids) if (level[c] > m) m = level[c];
      for (const c of kids) {
        if (level[c] < m) {
          level[c] = m;
          changed = true;
        }
      }
    }
    if (!changed) return true;
  }
  return false;
  };

  // Второй проход: подтягиваем родителей вплотную к детям. Без этого человек,
  // которого брак увёл на несколько рядов вниз, оставляет всю свою родню в самом
  // верху древа. Делаем это отдельно от первого прохода: там правило «супруги
  // вровень» гонялось с этим наперегонки и в итоге ставило родителя вровень с
  // собственным ребёнком. Здесь дети уже не двигаются, гонки быть не может.
  //
  // Но подтянутый вниз родитель — чей-то брат: его братья и сёстры и их родители
  // должны съехать за ним, иначе Анна Пермякова стояла на два ряда ниже Сергея и
  // Марии Лузиных. Поэтому проходы чередуются до покоя: подтянули — снова
  // выровняли — снова подтянули. Уровни только растут, так что это сходится.
  const kin = new Merge<string>();
  for (const pr of sideBySidePairs) kin.join(pr.a, pr.b);
  const clusters = kin.parts(ids);
  const pullDown = (): boolean => {
    let any = false;
    for (let pass = 0; pass < 12; pass++) {
      let moved = false;
      for (const cluster of clusters) {
        let hi = Infinity;
        let cur = -Infinity;
        for (const m of cluster) {
          const kids = g.children[m];
          if (kids.length) hi = Math.min(hi, Math.min(...kids.map((c) => level[c])) - 1);
          cur = Math.max(cur, level[m]);
        }
        if (!Number.isFinite(hi) || hi <= cur) continue;
        for (const m of cluster) {
          if (level[m] < hi) {
            level[m] = hi;
            moved = true;
            any = true;
          }
        }
      }
      if (!moved) break;
    }
    return any;
  };

  const settle = (siblings: boolean): boolean => {
    for (const id of ids) level[id] = 0;
    if (!relax(siblings)) return false;
    for (let round = 0; round < guard; round++) {
      if (!pullDown()) return true;
      if (!relax(siblings)) return false;
    }
    return false;
  };
  if (!settle(true)) settle(false);

  alignIslandsByYear(state, level);

  // после подтягивания сверху могут остаться пустые ряды — убираем их
  const used = [...new Set(ids.map((id) => level[id]))].sort((a, b) => a - b);
  const packed = new Map(used.map((v, i) => [v, i]));
  for (const id of ids) level[id] = packed.get(level[id]) as number;
  return level;
}

/** Столько лет считаем между поколениями, когда ряд не с чем сравнить. */
const YEARS_PER_ROW = 28;

/**
 * Остров — кусок древа, не связанный с основным ни одной связью, — сам по себе
 * начинается с верхнего ряда: у его старшего нет родителей, значит, он «в шапке».
 * Так внук 2020 года рождения оказывался в одном ряду с прадедами. Поэтому каждый
 * остров сдвигаем целиком на столько рядов, чтобы годы рождения его людей легли
 * на годы соответствующих рядов основного древа. Основное — самый крупный кусок;
 * год ряда — медиана годов рождения его людей в этом ряду, для пустых рядов —
 * от соседних с шагом YEARS_PER_ROW. Остров без единой даты остаётся где был.
 */
function alignIslandsByYear(state: TreeState, level: Record<string, number>): void {
  const comps = components(state).filter((c) => c.length > 1);
  if (comps.length < 2) return;
  const year = (id: string): number | null => yearOfBirth(state.people[id]);
  const main = comps.reduce((a, b) => (b.length > a.length ? b : a));
  const byRow = new Map<number, number[]>();
  for (const id of main) {
    const y = year(id);
    if (y !== null) push(byRow, level[id], y);
  }
  if (byRow.size < 2) return; // не с чем сравнивать
  const rows = [...byRow.keys()].sort((a, b) => a - b);
  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const known = new Map(rows.map((r) => [r, median(byRow.get(r)!)]));
  const yearOfRow = (r: number): number => {
    const k = known.get(r);
    if (k !== undefined) return k;
    // ближайший известный ряд и шаг в поколение
    let best = rows[0];
    for (const q of rows) if (Math.abs(q - r) < Math.abs(best - r)) best = q;
    return known.get(best)! + (r - best) * YEARS_PER_ROW;
  };

  for (const comp of comps) {
    if (comp === main) continue;
    const dated = comp.filter((id) => year(id) !== null);
    if (!dated.length) continue;
    const [lo, hi] = extent(comp, (id) => level[id]);
    let bestShift = 0;
    let bestCost = Infinity;
    // остров не выше шапки и не ниже ряда под последним рядом основного древа
    const maxRow = rows[rows.length - 1] + 1;
    for (let shift = -lo; shift <= maxRow - hi; shift++) {
      let cost = 0;
      for (const id of dated) cost += Math.abs((year(id) as number) - yearOfRow(level[id] + shift));
      if (cost < bestCost - 0.5) {
        bestCost = cost;
        bestShift = shift;
      }
    }
    for (const id of comp) level[id] += bestShift;
  }
}

/** Связные куски древа — их раскладываем независимо и разносим по горизонтали. */
function components(state: TreeState): string[][] {
  const merge = new Merge<string>();
  for (const l of state.links) if (state.people[l.parent] && state.people[l.child]) merge.join(l.parent, l.child);
  for (const pr of [...state.pairs, ...state.sibs]) if (state.people[pr.a] && state.people[pr.b]) merge.join(pr.a, pr.b);
  const oldest = (c: string[]) => Math.min(...c.map((i) => state.people[i].n));
  return merge.parts(Object.keys(state.people)).sort((a, b) => oldest(a) - oldest(b));
}

/** Семейная ячейка: набор родителей и их общие дети. Брак без детей — тоже ячейка. */
function unions(state: TreeState, g: Graph, xhint: Record<string, number> | null): Unions {
  const srcX = (u: Union): number => {
    let s = 0;
    let n = 0;
    for (const p of u.parents) {
      if (xhint && xhint[p] !== undefined) {
        s += xhint[p];
        n++;
      }
    }
    return n ? s / n : 0;
  };

  const byKey: Record<string, Union> = {};
  for (const cid of Object.keys(state.people)) {
    const ps = g.parents[cid];
    if (!ps.length) continue;
    const key = ps.slice().sort().join("|");
    if (!byKey[key]) byKey[key] = { parents: ps.slice(), children: [], key, first: 1e9 };
    byKey[key].children.push(cid);
  }
  const list = Object.keys(byKey).map((k) => byKey[k]);

  const byParent: Record<string, Union[]> = {};
  // кто стоит вплотную: супруги — и явные братья с сёстрами, у них тот же малый зазор
  const pairGap: Record<string, 1> = {};
  for (const sb of state.sibs) {
    if (state.people[sb.a] && state.people[sb.b]) pairGap[[sb.a, sb.b].sort().join("|")] = 1;
  }
  for (const pr of state.pairs) {
    if (!state.people[pr.a] || !state.people[pr.b]) continue;
    const key = [pr.a, pr.b].sort().join("|");
    pairGap[key] = 1;
    if (!byKey[key]) {
      byKey[key] = { parents: [pr.a, pr.b], children: [], key, first: 1e9 };
      list.push(byKey[key]);
    }
  }

  for (const u of list) {
    // старшие слева, без дат — в порядке ввода
    u.children.sort((a, b) => {
      const ka = birthKey(state.people[a]);
      const kb = birthKey(state.people[b]);
      if (ka !== null && kb !== null && ka !== kb) return ka - kb;
      if (ka !== null && kb === null) return -1;
      if (ka === null && kb !== null) return 1;
      return state.people[a].n - state.people[b].n;
    });
    u.first = u.children.length ? state.people[u.children[0]].n : 1e9;
    for (const p of u.parents) (byParent[p] = byParent[p] || []).push(u);
    for (let i = 0; i < u.parents.length; i++) {
      for (let j = i + 1; j < u.parents.length; j++) {
        pairGap[[u.parents[i], u.parents[j]].sort().join("|")] = 1;
      }
    }
  }

  for (const p of Object.keys(byParent)) {
    byParent[p].sort((a, b) => {
      if (xhint) {
        // второй проход: уже знаем, откуда пойдёт линия
        const d = srcX(a) - srcX(b);
        if (Math.abs(d) > 1) return d;
      }
      return a.first - b.first;
    });
  }

  return {
    list,
    byParent,
    isCouple: (a, b) => !!pairGap[[a, b].sort().join("|")],
  };
}

/** Порядок в рядах: обход сверху вниз, пара и её дети держатся вместе. */
function orderRows(
  state: TreeState,
  ids: string[],
  g: Graph,
  u: Unions,
  level: Record<string, number>,
  maxLevel: number,
  /** сюда попадают те, кого обход поставил в ряд как ребёнка своей семьи, а не как супруга */
  asChild: Set<string>,
): string[][] {
  const rows: string[][] = [];
  for (let l = 0; l <= maxLevel; l++) rows[l] = [];
  const seen: Record<string, 1> = {};
  const inSet: Record<string, 1> = {};
  for (const id of ids) inSet[id] = 1;

  const visit = (id: string): void => {
    if (seen[id] || !inSet[id]) return;
    seen[id] = 1;
    const uns = u.byParent[id] || [];
    // У кого две семьи, тому одну ставим слева, другую справа: иначе линии к детям
    // от разных супругов идут в одну сторону и перехлёстываются.
    if (uns.length > 1) for (const p of uns[0].parents) visit(p);
    rows[level[id]].push(id); // место в своём ряду занимаем сразу
    // Супруг встаёт в ряд первым. Если сначала уйти к родителям, их вторая родня
    // (братья и сёстры человека) успеет занять места между супругами, и пара
    // расползётся на полряда, а ребёнок повиснет между ними.
    for (const un of u.byParent[id] || []) for (const p of un.parents) visit(p);
    for (const sb of siblingsOf(state, id)) visit(sb); // явные братья и сёстры — рядом
    for (const p of g.parents[id]) visit(p); // семья второй половины встаёт над ней
    for (const un of u.byParent[id] || []) {
      for (const c of un.children) {
        if (!seen[c]) asChild.add(c);
        visit(c);
      }
    }
  };

  ids
    .filter((id) => !g.parents[id].length)
    .sort((a, b) => state.people[a].n - state.people[b].n)
    .forEach(visit);
  ids.slice().sort((a, b) => state.people[a].n - state.people[b].n).forEach(visit);
  return rows;
}

export function layout(full: TreeState, lang: Lang = "ru"): LayoutResult {
  const state = visibleState(full); // скрытых для раскладки не существует
  const gaps = gapsFor(state.gap || 1);
  const g = graphOf(state);
  const level = computeLevels(state, g);
  const pos: Record<string, Box> = {};
  const ids = Object.keys(state.people);

  let maxLevel = 0;
  for (const id of ids) {
    const s = sizeOf(state.people[id], lang);
    pos[id] = { x: 0, y: 0, w: NODE_W, h: s.h, lines: s.lines };
    if (level[id] > maxLevel) maxLevel = level[id];
  }

  // высоты рядов и их Y
  const rowH: number[] = [];
  const rowY: number[] = [];
  for (let l = 0; l <= maxLevel; l++) rowH[l] = 46;
  for (const id of ids) if (pos[id].h > rowH[level[id]]) rowH[level[id]] = pos[id].h;
  let y = 0;
  for (let l = 0; l <= maxLevel; l++) {
    rowY[l] = y;
    y += rowH[l] + gaps.v;
  }

  // Кого ещё не связали «родитель — ребёнок», тот не должен растягивать холст:
  // такие уезжали за правый край древа на тысячи пикселей. Кладём их отдельным
  // блоком под древом — и одиночек, и супругов, никуда пока не пристроенных.
  const tied = new Set<string>();
  for (const l of state.links) {
    if (state.people[l.parent] && state.people[l.child]) {
      tied.add(l.parent);
      tied.add(l.child);
    }
  }
  const comps = components(state);
  const rooted = comps.filter((c) => c.some((id) => tied.has(id)));
  const loose = comps
    .filter((c) => !c.some((id) => tied.has(id)))
    .map((c) => c.slice().sort((a, b) => state.people[a].n - state.people[b].n));

  // Кто пришёл в ряд ребёнком своей семьи: по этому решается, какой семье
  // принадлежит пара «ребёнок + супруг», когда родители есть у обоих.
  const asChild = new Set<string>();
  const orderAll = (u: Unions): string[][][] => {
    asChild.clear();
    return rooted.map((compIds) =>
      orderRows(state, compIds, g, u, level, maxLevel, asChild).map((row) => tidyTies(row, u)),
    );
  };

  /** Расстановка по x при уже известном порядке в рядах; от прежних x не зависит. */
  const placeRows = (u: Unions, rowsByComp: string[][][]): void => {
    let offset = 0;
    rooted.forEach((compIds, ci) => {
      const xs = placeComponent(rowsByComp[ci], { g, u, level, asChild, gaps });
      let [minX, maxX] = extent(compIds, (id) => xs[id] ?? 0);
      minX -= NODE_W / 2;
      maxX += NODE_W / 2;
      if (!Number.isFinite(minX)) {
        minX = 0;
        maxX = 0;
      }
      for (const id of compIds) pos[id].x = (xs[id] ?? 0) - minX + offset;
      offset += maxX - minX + gaps.comp;
    });
  };

  let u = unions(state, g, null);
  placeRows(u, orderAll(u));
  const xhint: Record<string, number> = {};
  for (const id of Object.keys(pos)) xhint[id] = pos[id].x;
  u = unions(state, g, xhint); // второй заход уже знает, откуда пойдут линии
  const rows = orderAll(u);
  placeRows(u, rows);

  for (const id of ids) pos[id].y = rowY[level[id]] + (rowH[level[id]] - pos[id].h) / 2;

  /** Блок непристроенных под древом; зависит от того, где кончилось древо. */
  let lonePlate: { x: number; y: number; w: number } | null = null;
  const placeLoose = (): void => {
    lonePlate = null;
    if (!loose.length) return;
    let x1 = Infinity;
    let x2 = -Infinity;
    let y2 = -Infinity;
    for (const c of rooted) {
      for (const id of c) {
        x1 = Math.min(x1, pos[id].x - pos[id].w / 2);
        x2 = Math.max(x2, pos[id].x + pos[id].w / 2);
        y2 = Math.max(y2, pos[id].y + pos[id].h);
      }
    }
    if (x1 === Infinity) {
      x1 = 0;
      x2 = NODE_W * 4 + gaps.h * 3;
      y2 = -gaps.v;
    }
    const wide = Math.max(x2 - x1, NODE_W * 3 + gaps.h * 2);
    const top = y2 + gaps.v;
    let cx = x1;
    let cy = top + 26;
    let tall = 0;
    for (const comp of loose) {
      // супругов не разрываем переносом строки
      const need = comp.length * NODE_W + (comp.length - 1) * gaps.couple;
      if (cx > x1 && cx + need > x1 + wide) {
        cx = x1;
        cy += tall + gaps.v / 2;
        tall = 0;
      }
      comp.forEach((id, i) => {
        if (i) cx += gaps.couple;
        pos[id].x = cx + NODE_W / 2;
        pos[id].y = cy;
        tall = Math.max(tall, pos[id].h);
        cx += NODE_W;
      });
      cx += gaps.h;
    }
    lonePlate = { x: x1, y: top, w: wide };
  };

  // Порядок обхода оставляет пересечения линий: спуск одной семьи попадает внутрь
  // размаха шины другой. Переставляем людей в рядах и оставляем тот порядок, при
  // котором пересечений меньше всего — считая их по той картинке, которую увидит
  // пользователь: по годам карточки стоят иначе, чем по поколениям.
  const rootedIds = rooted.flat();
  const posRooted: Record<string, Box> = {};
  for (const id of rootedIds) posRooted[id] = pos[id];
  const view = (): Record<string, Box> => {
    if (!state.timeline) return posRooted; // непристроенные ещё не расставлены
    placeLoose();
    const copy: Record<string, Box> = {};
    for (const id of ids) copy[id] = { ...pos[id] };
    applyTimeline(state, g, level, copy, gaps);
    return copy;
  };
  const [gx1, gx2] = extent(rootedIds, (id) => pos[id].x);
  const genWidth = rootedIds.length ? gx2 - gx1 : 0;
  const placeBy = (r: string[][][]) => placeRows(u, r);
  const rounds = roundsFor(ids.length);
  // По годам сначала ищем порядок, хороший по поколениям: он часто лучше исходного и
  // там, а оценка по годам сама решит, брать ли его за отправную точку.
  const starts: string[][][][] = [];
  if (state.timeline && rounds > 0) {
    starts.push(
      untangle(state, g, u, level, rows, pos, rootedIds, { place: placeBy, view: () => posRooted, widthFloor: genWidth, strictAlign: true }, rounds),
    );
  }
  placeRows(
    u,
    untangle(
      state, g, u, level, rows, pos, rootedIds,
      { place: placeBy, view, widthFloor: genWidth, strictAlign: !state.timeline },
      rounds,
      starts,
    ),
  );

  placeLoose();

  let tl: Timeline | null = null;
  if (state.timeline) tl = applyTimeline(state, g, level, pos, gaps);

  // приколотые перетаскиванием карточки стоят там, где их оставили
  for (const id of ids) {
    const p = state.people[id];
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      pos[id].x = p.fx;
      pos[id].y = p.fy;
    }
  }

  return { pos, level, tl, graph: g, lonePlate: state.timeline ? null : lonePlate };
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
}

export function bboxOf(pos: Record<string, Box>): BBox | null {
  const ids = Object.keys(pos);
  if (!ids.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const id of ids) {
    const b = pos[id];
    x1 = Math.min(x1, b.x - b.w / 2);
    x2 = Math.max(x2, b.x + b.w / 2);
    y1 = Math.min(y1, b.y);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}
