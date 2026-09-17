import { pairKey, type TreeState } from "../model/types.ts";
import { Merge } from "../util.ts";
import { bracketY, leftRight, sideBySide } from "./couple.ts";
import { rectOf, type Box } from "./layout.ts";
import { CLEAR, polyPath, route, type Pt, type Rect } from "./route.ts";

/** За какую связь отвечает линия — по ней собираем список того, что можно убрать. */
export type EdgeRef =
  | { kind: "child"; parents: string[]; child: string }
  | { kind: "leg"; parent: string; children: string[] }
  | { kind: "couple"; a: string; b: string; children: string[] }
  | { kind: "sibling"; a: string; b: string };

export type EdgeItem =
  | { kind: "path"; d: string; hot: boolean; arrow: boolean; ref?: EdgeRef; pts: Pt[]; dashed?: boolean }
  | { kind: "joint"; x: number; y: number; hot: boolean };

interface Vert {
  x: number;
  y1: number;
  y2: number;
  gi: number;
}

/** Где горизонталь на высоте y пересекает вертикали чужих семей. */
function crossAt(xa: number, xb: number, y: number, gi: number, verts: Vert[]): number[] {
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  const out: number[] = [];
  for (const v of verts) {
    if (v.gi === gi) continue;
    const v1 = Math.min(v.y1, v.y2);
    const v2 = Math.max(v.y1, v.y2);
    if (y <= v1 + 2 || y >= v2 - 2) continue;
    if (v.x <= lo + 6 || v.x >= hi - 6) continue;
    out.push(v.x);
  }
  return out;
}

interface Geo {
  gi: number;
  ps: string[];
  cs: string[];
  hot: boolean;
  bracket: { x1: number; x2: number; y: number } | null;
  jx: number;
  jy: number;
  sx: number;
  sy: number;
  barY: number;
  flatY: number;
  /** полоса, в которой шина имеет право стоять: низ родителей и верх детей */
  bandLo: number;
  bandHi: number;
}

/** Шины разных семей не должны сливаться: держим их по высоте не ближе этого. */
const BUS_APART = 15;
/**
 * Короче этого стрелка от шины к ребёнку не бывает: при малом просвете между рядами
 * четверть зазора давала 18 px вместе с наконечником — «слишком короткие стрелки».
 */
const MIN_ARROW = 26;

export function computeEdges(
  state: TreeState,
  pos: Record<string, Box>,
  level: Record<string, number>,
  selected: string | null,
): EdgeItem[] {
  const out: EdgeItem[] = [];
  const byChild: Record<string, string[]> = {};
  const uni: Record<string, { parents: string[]; children: string[] }> = {};

  for (const l of state.links) {
    if (!pos[l.parent] || !pos[l.child]) continue;
    (byChild[l.child] = byChild[l.child] || []).push(l.parent);
  }
  for (const cid of Object.keys(byChild)) {
    const key = byChild[cid].slice().sort().join("|");
    if (!uni[key]) uni[key] = { parents: byChild[cid], children: [] };
    uni[key].children.push(cid);
  }
  for (const pr of state.pairs) {
    if (!pos[pr.a] || !pos[pr.b]) continue;
    const key = pairKey(pr.a, pr.b);
    if (!uni[key]) uni[key] = { parents: [pr.a, pr.b], children: [] };
  }

  // все карточки — препятствия; свои концы у каждой линии исключаем
  const cards = Object.keys(pos).map((id) => ({ id, r: rectOf(pos[id]) }));
  const obsExcept = (ids: string[]): Rect[] =>
    cards.filter((c) => ids.indexOf(c.id) < 0).map((c) => c.r);

  const leftmost = (k: string): number => {
    const src = uni[k].children.length ? uni[k].children : uni[k].parents;
    return Math.min(...src.map((c) => pos[c].x));
  };

  const near = (a: string, b: string) => sideBySide(pos, level, a, b);

  const keys = Object.keys(uni).sort((a, b) => leftmost(a) - leftmost(b));
  const geo: Geo[] = [];
  const verts: Vert[] = [];
  /** вертикали чужих связей: при обходе карточек к ним не прижимаемся */
  const others: number[] = [];

  keys.forEach((key, gi) => {
    // проход 1: геометрия и все вертикали
    const ps = uni[key].parents;
    const cs = uni[key].children;
    const hot = !!selected && (cs.indexOf(selected) > -1 || ps.indexOf(selected) > -1);
    let bottom = -1e9;
    let top = 1e9;
    let jx = 0;
    for (const p of ps) {
      bottom = Math.max(bottom, pos[p].y + pos[p].h);
      jx += pos[p].x;
    }
    jx /= ps.length;

    let bracket: Geo["bracket"] = null;
    if (ps.length === 2 && near(ps[0], ps[1])) {
      const [L, R] = leftRight(pos[ps[0]], pos[ps[1]]);
      bracket = { x1: L.x + L.w / 2, x2: R.x - R.w / 2, y: bracketY(L, R) };
      jx = (bracket.x1 + bracket.x2) / 2;
    }

    const G: Geo = { gi, ps, cs, hot, bracket, jx, jy: 0, sx: 0, sy: 0, barY: 0, flatY: 0, bandLo: 0, bandHi: 0 };

    if (cs.length) {
      for (const c of cs) top = Math.min(top, pos[c].y);
      const span = top - bottom;
      let barY = top - Math.max(MIN_ARROW, span * 0.24);
      if (barY < bottom + 10) barY = bottom + Math.max(6, span * 0.45);
      G.barY = barY;
      G.bandLo = bottom + 6;
      G.bandHi = top - 6;
      if (bracket) {
        G.sx = jx;
        G.sy = bracket.y;
      } else {
        let jy = bottom + Math.max(8, Math.min(22, span * 0.3));
        if (jy > barY - 4) jy = Math.max(bottom + 4, barY - 4);
        G.jy = jy;
        if (ps.length > 1) {
          G.sx = jx;
          G.sy = jy;
        } else {
          G.sx = pos[ps[0]].x;
          G.sy = pos[ps[0]].y + pos[ps[0]].h;
        }
      }
    } else if (!bracket && ps.length === 2) {
      G.flatY = bottom + 22;
      for (const pid of ps) verts.push({ x: pos[pid].x, y1: pos[pid].y + pos[pid].h, y2: G.flatY, gi });
    }
    geo.push(G);
  });

  // Шины семей, которые перекрываются по горизонтали, разводим по высоте.
  // Раньше высота бралась по остатку от номера семьи — соседние всё равно
  // попадали впритык и линии от разных родителей сливались в одну.
  //
  // Полоса, где шина имеет право стоять, считается по всем карточкам под её
  // размахом с тем же просветом CLEAR, что держит прокладка: иначе route() потом
  // сдвигал поперечину сам, и разведённые шины снова сходились.
  //
  // Кто ляжет выше, а кто ниже — не безразлично: если исток одной семьи попадает
  // внутрь размаха шины другой, её шине место выше чужой (иначе спуск от родителей
  // режет чужую шину), а если внутрь размаха попадает спуск к чужому ребёнку —
  // ниже. Поэтому помеху обходим и вниз, и вверх — что дешевле по пересечениям, —
  // а порядок укладки в каждой группе перекрывающихся шин выбирается перебором.
  // При равенстве остаётся прежнее: вниз и в порядке естественной высоты.
  const spanOf = (G: Geo): [number, number] => {
    const xs = [G.sx, ...G.cs.map((c) => pos[c].x)];
    return [Math.min(...xs), Math.max(...xs)];
  };
  const bandOf = (G: Geo): [number, number] => {
    const [x1, x2] = spanOf(G);
    let lo = -Infinity;
    let hi = Infinity;
    for (const { r } of cards) {
      if (r.x2 <= x1 + 0.5 || r.x1 >= x2 - 0.5) continue;
      if (r.y2 <= G.barY) lo = Math.max(lo, r.y2 + CLEAR + 1);
      else if (r.y1 >= G.barY) hi = Math.min(hi, r.y1 - CLEAR - 1);
    }
    if (!Number.isFinite(lo)) lo = G.bandLo;
    if (!Number.isFinite(hi)) hi = G.bandHi;
    return lo <= hi ? [lo, hi] : [G.bandLo, G.bandHi];
  };
  /** Вертикали семьи при шине на высоте y: исток (или ножки к узлу) и спуски к детям. */
  const vertsAt = (F: Geo, y: number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    if (F.bracket || F.ps.length === 1) out.push([F.sx, F.sy, y]);
    else {
      const jy = Math.min(F.jy, y - 4);
      for (const pid of F.ps) out.push([pos[pid].x, pos[pid].y + pos[pid].h, jy]);
      out.push([F.sx, jy, y]);
    }
    for (const c of F.cs) out.push([pos[c].x, y, pos[c].y - 3]);
    return out;
  };
  const cut = (x1: number, x2: number, y: number, v: [number, number, number]): boolean =>
    v[0] > x1 + 2 && v[0] < x2 - 2 && y > Math.min(v[1], v[2]) + 2 && y < Math.max(v[1], v[2]) - 2;
  type Laid = { G: Geo; y: number; x1: number; x2: number };
  /** Сколько раз шина G на высоте y и уже уложенные шины режут вертикали друг друга. */
  const tanglesWith = (G: Geo, y: number, laid: Laid[]): number => {
    const [x1, x2] = spanOf(G);
    const mine = vertsAt(G, y);
    let n = 0;
    for (const o of laid) {
      for (const v of vertsAt(o.G, o.y)) if (cut(x1, x2, y, v)) n++;
      for (const v of mine) if (cut(o.x1, o.x2, o.y, v)) n++;
    }
    return n;
  };
  const bands = new Map<Geo, [number, number]>();
  /**
   * Высота для G при уже уложенных шинах. Кандидаты — естественная высота и на
   * BUS_APART выше и ниже каждой уложенной шины, с которой G перекрывается по x;
   * берём свободную с наименьшим числом пересечений. При равенстве — естественная,
   * потом ближайшая к ней, потом та, что ниже (так вела себя старая укладка).
   * Полоса кончилась — к родителям: лучше так, чем слипшись.
   */
  const settle = (G: Geo, laid: Laid[]): number => {
    const [x1, x2] = spanOf(G);
    const [lo, hi] = bands.get(G)!;
    const natural = Math.max(lo, Math.min(G.barY, hi));
    const near = laid.filter((o) => o.x2 > x1 - 10 && o.x1 < x2 + 10);
    const free = (y: number) => y >= lo && y <= hi && !near.some((o) => Math.abs(o.y - y) < BUS_APART);
    const cands = [natural];
    for (const o of near) cands.push(o.y - BUS_APART, o.y + BUS_APART);
    let best: number | null = null;
    let bestCost = Infinity;
    for (const y of cands) {
      if (!free(y)) continue;
      const cost = tanglesWith(G, y, laid);
      if (best === null || cost < bestCost) {
        best = y;
        bestCost = cost;
        continue;
      }
      if (cost > bestCost) continue;
      const dNew = Math.abs(y - natural);
      const dOld = Math.abs(best - natural);
      if (dNew < dOld - 0.5 || (Math.abs(dNew - dOld) <= 0.5 && y > best)) best = y;
    }
    return best ?? lo;
  };
  const layOut = (order: Geo[]): Laid[] => {
    const laid: Laid[] = [];
    for (const G of order) {
      const [x1, x2] = spanOf(G);
      laid.push({ G, y: settle(G, laid), x1, x2 });
    }
    return laid;
  };
  const tangles = (laid: Laid[]): number => {
    let n = 0;
    for (let i = 0; i < laid.length; i++) n += tanglesWith(laid[i].G, laid[i].y, laid.slice(0, i));
    return n;
  };
  const permutations = <T,>(items: T[]): T[][] => {
    if (items.length <= 1) return [items];
    const out: T[][] = [];
    items.forEach((it, i) => {
      for (const rest of permutations(items.filter((_, k) => k !== i))) out.push([it, ...rest]);
    });
    return out;
  };

  const withKids = geo.filter((g) => g.cs.length).sort((a, b) => a.barY - b.barY);
  for (const G of withKids) bands.set(G, bandOf(G));
  // группы: перекрываются по x и близки по естественной высоте
  const overlap = new Merge<Geo>();
  for (let i = 0; i < withKids.length; i++) {
    const [a1, a2] = spanOf(withKids[i]);
    for (let j = i + 1; j < withKids.length; j++) {
      const [b1, b2] = spanOf(withKids[j]);
      if (b2 > a1 - 10 && b1 < a2 + 10 && Math.abs(withKids[i].barY - withKids[j].barY) < BUS_APART * 3) {
        overlap.join(withKids[i], withKids[j]);
      }
    }
  }
  for (const members of overlap.parts(withKids)) {
    let best = layOut(members);
    if (members.length >= 2 && members.length <= 6) {
      let bestCost = tangles(best);
      for (const perm of permutations(members)) {
        if (bestCost === 0) break;
        const laid = layOut(perm);
        const cost = tangles(laid);
        if (cost < bestCost) {
          best = laid;
          bestCost = cost;
        }
      }
    }
    for (const { G, y } of best) {
      G.barY = y;
      if (!G.bracket && G.jy > G.barY - 4) G.jy = Math.max(G.bandLo - 2, G.barY - 4);
    }
  }

  for (const G of geo) {
    if (!G.cs.length) continue;
    verts.push({ x: G.sx, y1: G.sy, y2: G.barY, gi: G.gi });
    for (const cid of G.cs) verts.push({ x: pos[cid].x, y1: G.barY, y2: pos[cid].y - 3, gi: G.gi });
    if (!G.bracket && G.ps.length > 1) {
      for (const pid of G.ps) verts.push({ x: pos[pid].x, y1: pos[pid].y + pos[pid].h, y2: G.jy, gi: G.gi });
    }
  }

  for (const v of verts) others.push(v.x);

  for (const G of geo) {
    // проход 2: рисуем с мостиками
    const { gi, ps, cs, hot } = G;
    if (G.bracket) {
      const bp: Pt[] = [
        { x: G.bracket.x1, y: G.bracket.y },
        { x: G.bracket.x2, y: G.bracket.y },
      ];
      out.push({
        kind: "path",
        hot,
        arrow: false,
        ref: { kind: "couple", a: ps[0], b: ps[1], children: cs },
        pts: bp,
        d: polyPath(bp, crossAt(G.bracket.x1, G.bracket.x2, G.bracket.y, gi, verts)),
      });
    }
    if (!cs.length) {
      if (!G.bracket && ps.length === 2) {
        const fp = route(
          pos[ps[0]].x, pos[ps[0]].y + pos[ps[0]].h,
          pos[ps[1]].x, pos[ps[1]].y + pos[ps[1]].h,
          G.flatY,
          obsExcept(ps),
          false,
          // поперечина должна пройти под обеими карточками, а не сквозь них
          Math.max(pos[ps[0]].y + pos[ps[0]].h, pos[ps[1]].y + pos[ps[1]].h) + 4,
        );
        out.push({
          kind: "path",
          hot,
          arrow: false,
          ref: { kind: "couple", a: ps[0], b: ps[1], children: cs },
          pts: fp,
          d: polyPath(fp, crossAt(pos[ps[0]].x, pos[ps[1]].x, G.flatY, gi, verts)),
        });
      }
      continue;
    }
    if (!G.bracket && ps.length > 1) {
      for (const pid of ps) {
        const p = pos[pid];
        const lp = route(p.x, p.y + p.h, G.jx, G.jy, G.jy, obsExcept(ps), false, p.y + p.h + 2);
        out.push({
          kind: "path",
          hot,
          arrow: false,
          ref: { kind: "leg", parent: pid, children: cs },
          pts: lp,
          d: polyPath(lp, crossAt(p.x, G.jx, G.jy, gi, verts)),
        });
      }
      out.push({ kind: "joint", x: G.jx, y: G.jy, hot });
    }
    for (const cid of cs) {
      const c = pos[cid];
      // сдвиг в пару пикселей давал некрасивый наклон — опускаем линию ровно на
      // ребёнка. Но только если начало не заедет при этом под чужую карточку.
      const obs = obsExcept(ps.concat([cid]));
      // помехи проверяем по всем карточкам, включая родительские: под них
      // начало линии заезжать не должно
      const roomBelow = !cards.some(
        ({ r: o }) => c.x > o.x1 - 2 && c.x < o.x2 + 2 && G.sy > o.y1 - 2 && G.sy < o.y2 + 2,
      );
      const sx = Math.abs(G.sx - c.x) < 18 && roomBelow ? c.x : G.sx;
      const cp = route(sx, G.sy, c.x, c.y - 3, G.barY, obs, true, undefined, others);
      out.push({
        kind: "path",
        hot,
        arrow: true,
        ref: { kind: "child", parents: ps, child: cid },
        pts: cp,
        d: polyPath(cp, crossAt(G.sx, c.x, G.barY, gi, verts)),
      });
    }
  }

  // Явное родство «брат/сестра» — пунктир между карточками. Стоят рядом — на
  // высоте середины, как скобка пары; разнесены — дужкой над рядом.
  for (const sb of state.sibs || []) {
    if (!pos[sb.a] || !pos[sb.b]) continue;
    const [L, R] = leftRight(pos[sb.a], pos[sb.b]);
    const hot = selected === sb.a || selected === sb.b;
    let pts: Pt[];
    if (near(sb.a, sb.b)) {
      const cy = bracketY(L, R);
      pts = [{ x: L.x + L.w / 2, y: cy }, { x: R.x - R.w / 2, y: cy }];
    } else {
      const y = Math.min(L.y, R.y) - 14;
      pts = [{ x: L.x, y: L.y }, { x: L.x, y }, { x: R.x, y }, { x: R.x, y: R.y }];
    }
    out.push({ kind: "path", hot, arrow: false, dashed: true, ref: { kind: "sibling", a: sb.a, b: sb.b }, pts, d: polyPath(pts) });
  }
  return out;
}
