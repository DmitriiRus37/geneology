import { t, type Lang } from "../i18n.ts";
import { allSiblingsOf, childrenOf, parentsOf, partnersOf, siblingsOf } from "./tree.ts";
import type { Sex, TreeState } from "./types.ts";

export type Kin =
  | "father" | "mother" | "parent"
  | "son" | "daughter" | "child"
  | "husband" | "wife" | "spouse"
  | "brother" | "sister" | "sibling";

const bySex = <T extends Kin>(sex: Sex, m: T, f: T, u: T): T => (sex === "m" ? m : sex === "f" ? f : u);

export interface KinRow {
  id: string;
  /** одному человеку может достаться несколько ролей сразу */
  roles: Kin[];
  label: string;
  /** родство записано явно (пунктиром), а не через общих родителей — его можно убрать */
  explicit?: boolean;
}

/**
 * Кто кем приходится выбранному человеку. Смотрим только прямые связи —
 * родители, дети, супруги, — поэтому по древу никуда не идём и зациклиться
 * не на чем даже в запутанном родстве. Один и тот же человек может оказаться
 * сразу в нескольких ролях: тогда он показывается одной строкой с обеими.
 */
export function kinOf(state: TreeState, id: string, lang: Lang = "ru"): KinRow[] {
  const roles = new Map<string, Kin[]>();
  const put = (who: string, role: Kin) => {
    if (!who || who === id || !state.people[who]) return; // сам себе роднёй не бывает
    const list = roles.get(who) ?? [];
    if (list.indexOf(role) < 0) list.push(role);
    roles.set(who, list);
  };

  for (const p of parentsOf(state, id)) put(p, bySex(state.people[p]?.sex ?? "u", "father", "mother", "parent"));
  for (const p of partnersOf(state, id)) put(p, bySex(state.people[p]?.sex ?? "u", "husband", "wife", "spouse"));
  for (const c of childrenOf(state, id)) put(c, bySex(state.people[c]?.sex ?? "u", "son", "daughter", "child"));
  for (const b of allSiblingsOf(state, id)) put(b, bySex(state.people[b]?.sex ?? "u", "brother", "sister", "sibling"));
  const explicit = new Set(siblingsOf(state, id));
  const shared = new Set(allSiblingsOf(state, id).filter((b) => !explicit.has(b)));

  const order: Kin[] = [
    "father", "mother", "parent", "husband", "wife", "spouse",
    "brother", "sister", "sibling", "son", "daughter", "child",
  ];
  return [...roles.entries()]
    .map(([who, list]) => ({
      id: who,
      roles: list,
      label: list.map((r) => kinLabel(r, lang)).join(" · "),
      explicit: explicit.has(who) && !shared.has(who) ? true : undefined,
    }))
    .sort((a, b) => order.indexOf(a.roles[0]) - order.indexOf(b.roles[0]));
}

/** Подпись роли на нужном языке. */
export const kinLabel = (r: Kin, lang: Lang = "ru"): string => t(lang, "kin." + r);
