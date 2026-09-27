/**
 * Synthetic family trees for the tests. Built from a seed, so a failure can be replayed
 * exactly, and from made-up names, so no real data ends up in a test or a snapshot.
 *
 * The trees look like the real thing: several generations, marriages, in-laws with
 * parents of their own, second marriages, siblings with no shared parents on record,
 * people with no links at all, and dates in every form the app accepts, missing ones
 * included.
 */
import { addPair, addSibling, link } from "../model/tree.ts";
import { emptyState, type TreeState } from "../model/types.ts";

/** mulberry32: a small seeded generator of numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** first names with the two patronymics made from them: a son's, a daughter's */
const MALE: Record<string, [string, string]> = {
  Иван: ["Иванович", "Ивановна"],
  Пётр: ["Петрович", "Петровна"],
  Сергей: ["Сергеевич", "Сергеевна"],
  Алексей: ["Алексеевич", "Алексеевна"],
  Николай: ["Николаевич", "Николаевна"],
  Михаил: ["Михайлович", "Михайловна"],
  Андрей: ["Андреевич", "Андреевна"],
  Фёдор: ["Фёдорович", "Фёдоровна"],
};
const FEMALE = ["Анна", "Мария", "Елена", "Ольга", "Татьяна", "Наталья", "Ирина", "Вера"];
/** all of them take "-а" for a woman */
const SURNAMES = ["Орлов", "Соколов", "Лебедев", "Морозов", "Волков", "Зайцев", "Никитин", "Белкин"];

export interface SynthOptions {
  seed: number;
  /** how many people to stop at; the tree may overshoot by one family */
  size: number;
}

export function synthTree({ seed, size }: SynthOptions): TreeState {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const chance = (p: number) => r() < p;
  const between = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  const s = emptyState();
  const first = new Map<string, string>(); // id -> first name, for the children's patronymic
  const born = new Map<string, number>(); // id -> year, to keep generations in order
  const surname = new Map<string, string>(); // id -> surname in its male form
  const count = () => Object.keys(s.people).length;

  const dateOf = (year: number): string => {
    const k = r();
    if (k < 0.55) return `${String(between(1, 28)).padStart(2, "0")}.${String(between(1, 12)).padStart(2, "0")}.${year}`;
    if (k < 0.75) return `??.??.${year}`;
    if (k < 0.85) return `${String(year).slice(0, 3)}?`;
    return "";
  };

  const person = (sex: "m" | "f", year: number, family: string, father?: string): string => {
    s.seq += 1;
    const id = "p" + s.seq;
    const own = sex === "m" ? pick(Object.keys(MALE)) : pick(FEMALE);
    const dad = father ? first.get(father)! : pick(Object.keys(MALE));
    const patronymic = MALE[dad][sex === "m" ? 0 : 1];
    const last = sex === "m" ? family : family + "а";
    const died = year < 1950 && chance(0.6) ? dateOf(Math.min(2025, year + between(50, 90))) : "";
    s.people[id] = { id, name: `${own} ${patronymic} ${last}`, maiden: "", alt: [], born: dateOf(year), died, sex, n: s.seq };
    first.set(id, own);
    born.set(id, year);
    surname.set(id, family);
    return id;
  };

  /** a husband's or a wife's parents, from outside the family: they get no line of their own */
  const inLaws = (child: string) => {
    const year = born.get(child)! - between(22, 34);
    const dad = person("m", year, surname.get(child)!);
    const mom = person("f", year + between(-3, 5), pick(SURNAMES));
    addPair(s, dad, mom);
    link(s, dad, child);
    link(s, mom, child);
  };

  /** couples still to be given children: [father, mother], either may be missing */
  const queue: [string | null, string | null][] = [];

  const marry = (who: string) => {
    const sex = s.people[who].sex === "m" ? "f" : "m";
    const other = person(sex, born.get(who)! + between(-5, 5), pick(SURNAMES));
    addPair(s, who, other);
    if (chance(0.3)) inLaws(other);
    const [dad, mom] = sex === "f" ? [who, other] : [other, who];
    if (s.people[mom].sex === "f") s.people[mom].maiden = surname.get(mom)! + "а";
    queue.push([dad, mom]);
  };

  const founders = between(1850, 1880);
  const dad0 = person("m", founders, pick(SURNAMES));
  const mom0 = person("f", founders + between(-3, 6), pick(SURNAMES));
  addPair(s, dad0, mom0);
  queue.push([dad0, mom0]);

  while (count() < size) {
    const next = queue.shift();
    if (!next) {
      // the families ran out before the tree grew big enough: somebody new marries in
      const ids = Object.keys(s.people);
      marry(ids[Math.floor(r() * ids.length)]);
      continue;
    }
    const [dad, mom] = next;
    const base = Math.max(born.get(dad ?? "") ?? 0, born.get(mom ?? "") ?? 0);
    const family = surname.get(dad ?? mom!)!;
    const kids = pick([0, 1, 1, 2, 2, 2, 3, 3, 4]);
    for (let i = 0; i < kids && count() < size; i++) {
      const child = person(chance(0.5) ? "m" : "f", base + between(20, 35), family, dad ?? undefined);
      // now and then only one parent is on record
      if (dad && !(mom && chance(0.08))) link(s, dad, child);
      if (mom && !(dad && chance(0.08))) link(s, mom, child);
      if (born.get(child)! < 2000 && chance(0.6)) marry(child);
      if (chance(0.05)) marry(child); // a second marriage, with children of its own
    }
    if (chance(0.04)) {
      // a sibling known only as a sibling: no parents recorded
      const one = Object.keys(s.people)[Math.floor(r() * count())];
      const sib = person(chance(0.5) ? "m" : "f", born.get(one)! + between(-6, 6), surname.get(one)!);
      addSibling(s, one, sib);
    }
    if (chance(0.03)) person(chance(0.5) ? "m" : "f", between(1900, 2000), pick(SURNAMES)); // nobody's kin
  }
  return s;
}
