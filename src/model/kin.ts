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
  /** one person may end up with several roles at once */
  roles: Kin[];
  label: string;
  /** the kinship is recorded explicitly (dashed) rather than through shared parents — it can be removed */
  explicit?: boolean;
}

/**
 * Who is who to the selected person. We look only at direct links — parents, children,
 * spouses — so we walk nowhere across the tree and there is nothing to loop on even in
 * the most tangled kinship. One and the same person may end up in several roles at once:
 * then they are shown on one line with both.
 */
export function kinOf(state: TreeState, id: string, lang: Lang = "ru"): KinRow[] {
  const roles = new Map<string, Kin[]>();
  const put = (who: string, role: Kin) => {
    if (!who || who === id || !state.people[who]) return; // nobody is kin to themselves
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

/** The role's caption in the required language. */
export const kinLabel = (r: Kin, lang: Lang = "ru"): string => t(lang, "kin." + r);
