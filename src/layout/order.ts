/**
 * Порядок людей в рядах ради меньшего числа пересечений линий.
 *
 * Пересечение шины одной семьи со спуском другой рождается не прокладкой, а тем,
 * кто за кем стоит в ряду: спуск попадает внутрь размаха шины. Поэтому здесь
 * переставляются люди, а линии не трогаются. Кандидаты порядка рождаются
 * барицентром родни в соседних рядах, но оценивается каждый по реальной
 * геометрии: расставили по x той же процедурой, что и всегда, проложили линии,
 * посчитали ту же метрику, что в tools/metrics.ts. Исходный порядок обхода —
 * всегда один из кандидатов, так что хуже него по пересечениям не станет.
 *
 * Что сохраняется: супруги рядом (блок неделим, растянутую пару отбрасываем),
 * у кого две семьи — один супруг слева, другой справа (цепочка либо прямая, либо
 * обратная), братья и сёстры по старшинству, единственный ребёнок под родителями,
 * линии не сквозь карточки, шины не сближаются, древо не шире прежнего больше
 * чем на десятую часть. Без DOM.
 */
import { pairKey, type TreeState } from "../model/types.ts";
import { extent, mean, push } from "../util.ts";
import { overlapY, sideBySide } from "./couple.ts";
import { edgeStats } from "./crossings.ts";
import { computeEdges } from "./edges.ts";
import { rectOf, type Box, type Graph, type Unions } from "./layout.ts";

/** Блок — человек с супругами, стоит в ряду одним куском. */
interface Block {
  members: string[];
  /** барицентр по родне соседнего ряда; null — родни там нет, блок стоит где стоял */
  bary: number | null;
  /** где стоит сейчас — устойчивая сортировка */
  cur: number;
}

type Dir = "down" | "up" | "both";

export interface Score {
  visual: number;
  crossings: number;
  width: number;
  /** единственные дети, съехавшие из-под родителей */
  misaligned: Set<string>;
  /** пары супругов, между которыми зазор больше положенного */
  apart: Set<string>;
  through: number;
  busNear: number;
  overlaps: number;
}

export interface UntangleDeps {
  /** расставить людей по x по заданным порядкам рядов (по компонентам) */
  place: (rowsByComp: string[][][]) => void;
  /**
   * Карточки так, как их увидит пользователь: по поколениям — сама расстановка,
   * по годам — её копия, пересчитанная по годам рождения.
   */
  view: () => Record<string, Box>;
  /**
   * Ширина, до которой древо вправе расти без оглядки: по годам оно уже, чем по
   * поколениям, и мерить его прирост от собственной узкой базы несправедливо.
   */
  widthFloor: number;
  /**
   * Единственные дети под родителями — строгое обещание раскладки по поколениям:
   * ни один выровненный не должен съехать. По годам выравнивание и так
   * приблизительное, там достаточно, чтобы съехавших не стало больше.
   */
  strictAlign: boolean;
}

/** Сколько раундов позволить себе: оценка стоит раскладки, на больших древах экономим. */
export function roundsFor(people: number): number {
  if (people <= 120) return 3;
  if (people <= 300) return 1;
  return 0;
}

/** Насколько древо вправе стать шире ради пересечений. */
const WIDEN = 1.1;

/**
 * Возвращает лучший найденный порядок рядов; pos при выходе соответствует ему.
 */
export function untangle(
  state: TreeState,
  g: Graph,
  u: Unions,
  level: Record<string, number>,
  rowsByComp: string[][][],
  pos: Record<string, Box>,
  rootedIds: string[],
  deps: UntangleDeps,
  rounds: number,
  /** ещё порядки, с которых стоит попробовать начать — например, лучший по поколениям */
  extraStarts: string[][][][] = [],
): string[][][] {
  if (rounds <= 0 || !rootedIds.length) return rowsByComp;

  // Смотрим только на пристроенных: непристроенные ещё не расставлены.
  const rooted = new Set(rootedIds);
  // единственные дети: им положено стоять ровно под родителями
  const onlyChildren: { child: string; parents: string[] }[] = [];
  for (const un of u.list) {
    if (un.children.length !== 1 || !rooted.has(un.children[0])) continue;
    if (!un.parents.every((p) => level[p] === level[un.children[0]] - 1)) continue;
    onlyChildren.push({ child: un.children[0], parents: un.parents });
  }
  const couples: [string, string][] = [];
  for (const un of u.list) {
    const [a, b] = un.parents;
    if (un.parents.length === 2 && level[a] === level[b] && rooted.has(a) && rooted.has(b)) couples.push([a, b]);
  }

  const evaluate = (): Score => {
    const shown = deps.view();
    const ids = Object.keys(shown);
    const rects = ids.map((id) => rectOf(shown[id]));
    const st = edgeStats(computeEdges(state, shown, level, null), rects);
    const [minX, maxX] = extent(rootedIds, (id) => shown[id].x);
    const misaligned = new Set<string>();
    for (const oc of onlyChildren) {
      const mid = mean(oc.parents.map((p) => shown[p].x)) as number;
      if (Math.abs(mid - shown[oc.child].x) > 1) misaligned.add(oc.child);
    }
    // Пара разорвана, если скобку между супругами уже не нарисовать: далеко
    // или кто-то из их ряда встал между ними — то же условие, что и в edges.ts,
    // одной функцией на двоих. Супруги на разной высоте (по годам) скобки не
    // имеют — их не считаем.
    const apart = new Set<string>();
    for (const [a, b] of couples) {
      if (overlapY(shown[a], shown[b]) < 20) continue;
      if (!sideBySide(shown, level, a, b)) apart.add(pairKey(a, b));
    }
    let overlaps = 0;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const A = rects[i];
        const B = rects[j];
        if (A.x1 < B.x2 - 0.5 && B.x1 < A.x2 - 0.5 && A.y1 < B.y2 - 0.5 && B.y1 < A.y2 - 0.5) overlaps++;
      }
    }
    return {
      visual: st.visual,
      crossings: st.crossings,
      width: maxX - minX,
      misaligned,
      apart,
      through: st.through,
      busNear: st.busNear,
      overlaps,
    };
  };

  // старшинство: для каждой семьи — её дети одного ряда по порядку рождения
  const siblingRuns: string[][] = [];
  for (const un of u.list) {
    if (un.children.length < 2) continue;
    const byLevel = new Map<number, string[]>();
    for (const c of un.children) push(byLevel, level[c], c);
    for (const run of byLevel.values()) if (run.length > 1) siblingRuns.push(run);
  }

  deps.place(rowsByComp); // pos мог остаться от другого порядка — судим исходный по нему самому
  const base = evaluate();
  let best = { rows: rowsByComp, score: base };

  // что было в порядке — должно остаться в порядке; что уже было сломано, не считаем
  const subset = (a: Set<string>, b: Set<string>): boolean => [...a].every((v) => b.has(v));
  const widthCap = Math.max(base.width, deps.widthFloor) * WIDEN + 1;
  const acceptable = (s: Score): boolean =>
    (deps.strictAlign ? subset(s.misaligned, base.misaligned) : s.misaligned.size <= base.misaligned.size) &&
    subset(s.apart, base.apart) &&
    s.through <= base.through &&
    s.busNear <= base.busNear &&
    s.overlaps <= base.overlaps &&
    s.width <= widthCap;
  // Сначала то, что видно глазом; при равенстве — компактнее; счёт по путям —
  // последним: спуск сквозь шину трёх детей и сквозь шину одного выглядит одинаково.
  const better = (a: Score, b: Score): boolean =>
    a.visual !== b.visual ? a.visual < b.visual
    : Math.abs(a.width - b.width) > 0.5 ? a.width < b.width
    : a.crossings < b.crossings;

  // Порядок, найденный для другой картинки, часто хорош и здесь — пробуем его
  // как отправную точку, но судим по тем же правилам, что и остальных.
  for (const start of extraStarts) {
    if (sameRows(start, best.rows)) continue;
    deps.place(start);
    const score = evaluate();
    const take = acceptable(score) && better(score, best.score);
    if (take) best = { rows: start, score };
  }

  // Каждое направление гоняем до покоя: за один заход ряд переставляется по
  // старым местам соседей, и сдвинувшийся ряд подтягивает соседний только на
  // следующем. Каждый промежуточный порядок тоже оценивается — лучший может
  // оказаться и посреди пути. Раунд начинается с лучшего найденного.
  const dirs: Dir[] = ["up", "down", "both"];
  for (let round = 0; round < rounds; round++) {
    let cur = best.rows;
    deps.place(cur);
    const startedFrom = best;
    for (const dir of dirs) {
      for (let k = 0; k < 4; k++) {
        const cand = cur.map((rows) => rows.map((row) => reorderRow(row, dir, g, u, pos, siblingRuns)));
        if (sameRows(cand, cur)) break;
        deps.place(cand);
        const score = evaluate();
        const take = acceptable(score) && better(score, best.score);
        if (take) best = { rows: cand, score };
        cur = cand;
      }
    }
    if (best === startedFrom) break;
  }
  deps.place(best.rows);
  return best.rows;
}

function sameRows(a: string[][][], b: string[][][]): boolean {
  for (let c = 0; c < a.length; c++) {
    for (let r = 0; r < a[c].length; r++) {
      const x = a[c][r];
      const y = b[c][r];
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    }
  }
  return true;
}

/** Родня человека в соседних рядах, по которой считается барицентр. */
function kin(id: string, dir: Dir, g: Graph): string[] {
  if (dir === "down") return g.parents[id];
  if (dir === "up") return g.children[id];
  return g.parents[id].concat(g.children[id]);
}

/**
 * Внутри блока каждая связка (супруги, явные брат и сестра) должна стоять
 * вплотную. Обход даёт «сестра, её муж, брат» — муж между братом и сестрой.
 * Если связки образуют цепочку, выстраиваем блок по ней; направление — то, что
 * меньше отличается от нынешнего порядка. Не цепочка (у кого-то три связки) —
 * оставляем как есть.
 */
function chainOrder(members: string[], u: Unions): string[] {
  if (members.length < 3) return members;
  const ties = new Map<string, string[]>();
  for (const a of members) ties.set(a, members.filter((b) => b !== a && u.isCouple(a, b)));
  let broken = false;
  for (let i = 1; i < members.length; i++) if (!u.isCouple(members[i - 1], members[i])) broken = true;
  if (!broken) return members; // уже все рядом
  if ([...ties.values()].some((t) => t.length > 2)) return members;
  const ends = members.filter((m) => ties.get(m)!.length === 1);
  if (ends.length !== 2) return members;
  const path = [ends[0]];
  while (path.length < members.length) {
    const next = ties.get(path[path.length - 1])!.find((n) => !path.includes(n));
    if (!next) return members; // не одна цепочка
    path.push(next);
  }
  const index = new Map(members.map((m, i) => [m, i]));
  const shift = (order: string[]) => order.reduce((s, m, i) => s + Math.abs(index.get(m)! - i), 0);
  const back = path.slice().reverse();
  return shift(back) < shift(path) ? back : path;
}

/** Ряд с блоками, внутри которых связки стоят вплотную; порядок блоков прежний. */
export function tidyTies(row: string[], u: Unions): string[] {
  return blocksOf(row, u).flatMap((b) => b.members);
}

/** Блоки ряда: супруги вместе, внутри — в нынешнем порядке. */
function blocksOf(row: string[], u: Unions): Block[] {
  const index = new Map(row.map((id, i) => [id, i]));
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const id of row) {
    if (seen.has(id)) continue;
    const members: string[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const other of row) {
        if (!seen.has(other) && u.isCouple(cur, other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    members.sort((a, b) => index.get(a)! - index.get(b)!);
    out.push({ members: chainOrder(members, u), bary: null, cur: 0 });
  }
  return out;
}

function reorderRow(
  row: string[],
  dir: Dir,
  g: Graph,
  u: Unions,
  pos: Record<string, Box>,
  siblingRuns: string[][],
): string[] {
  if (row.length < 2) return row;
  const blocks = blocksOf(row, u);
  const blockOf = new Map<string, Block>();
  for (const b of blocks) {
    for (const m of b.members) blockOf.set(m, b);
    b.cur = mean(b.members.map((m) => pos[m].x)) as number;
    const xs: number[] = [];
    for (const m of b.members) for (const n of kin(m, dir, g)) xs.push(pos[n].x);
    b.bary = mean(xs);

    // Супруг встаёт со стороны своей родни — той, что сверху: общие дети у пары
    // одни и те же и сторону не подсказывают, а разница в одну карточку по ним
    // переворачивала пару и уводила её от родителей. У цепочки из двух семей
    // допустимы только прямой и обратный порядок — так одна семья остаётся слева,
    // другая справа.
    if (b.members.length > 1) {
      const first = mean(g.parents[b.members[0]].map((n) => pos[n].x));
      const last = mean(g.parents[b.members[b.members.length - 1]].map((n) => pos[n].x));
      if (first !== null && last !== null) {
        if (first > last + 0.5) b.members.reverse();
      } else if (first !== null) {
        if (first > b.cur + 0.5) b.members.reverse(); // родня первого справа — ему направо
      } else if (last !== null) {
        if (last < b.cur - 0.5) b.members.reverse(); // родня последнего слева — ему налево
      }
    }
  }

  // У кого в соседнем ряду родни нет, тот остаётся на своём месте: сортировать
  // его нечем, а собственный x против чужих барицентров уносил такие блоки в конец
  // ряда. Остальные сортируются по барицентру и занимают свободные места.
  const order: (Block | null)[] = blocks.map((b) => (b.bary === null ? b : null));
  const movable = blocks
    .filter((b) => b.bary !== null)
    .sort((a, b) => (a.bary as number) - (b.bary as number) || a.cur - b.cur);
  let k = 0;
  for (let i = 0; i < order.length; i++) if (!order[i]) order[i] = movable[k++];
  const sorted = order as Block[];

  // старшинство внутри этого ряда: цепочки блоков, которые должны идти слева направо
  const chains: Block[][] = [];
  for (const run of siblingRuns) {
    if (!blockOf.has(run[0])) continue;
    const chain: Block[] = [];
    let ok = true;
    for (const c of run) {
      const b = blockOf.get(c)!;
      if (chain[chain.length - 1] === b) continue;
      if (chain.includes(b)) {
        ok = false; // брат и сестра в одном блоке через третьего — порядок не определён
        break;
      }
      chain.push(b);
    }
    if (ok && chain.length > 1) chains.push(chain);
  }

  return restoreSeniority(sorted, chains).flatMap((b) => b.members);
}

/**
 * Блоки братьев и сестёр остаются на местах, которые им дала сортировка, но
 * раздаются по старшинству. Сваты, вставшие между ними, никуда не деваются.
 * Блок с детьми двух семей участвует в двух цепочках — отсюда повторы до покоя.
 */
function restoreSeniority(order: Block[], chains: Block[][]): Block[] {
  const out = order.slice();
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const chain of chains) {
      const slots = chain.map((b) => out.indexOf(b)).sort((a, b) => a - b);
      for (let i = 0; i < chain.length; i++) {
        if (out[slots[i]] !== chain[i]) {
          out[slots[i]] = chain[i];
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return out;
}
