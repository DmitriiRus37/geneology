export type Sex = "m" | "f" | "u";

export interface Person {
  id: string;
  name: string;
  maiden: string;
  alt: string[];
  born: string;
  died: string;
  sex: Sex;
  /** порядковый номер добавления — им держится стабильный порядок рядов */
  n: number;
  /** приколотая позиция после перетаскивания */
  fx?: number;
  fy?: number;
}

export interface Link {
  parent: string;
  child: string;
}

export interface Pair {
  a: string;
  b: string;
}

export interface TreeState {
  people: Record<string, Person>;
  links: Link[];
  pairs: Pair[];
  seq: number;
  timeline: boolean;
  gap: number;
  /** кого сейчас не показываем: срезанная вверх часть древа */
  hidden: string[];
  /** родные братья и сёстры без общих записанных родителей — пунктирное родство */
  sibs: Pair[];
}

export const emptyState = (): TreeState => ({
  people: {},
  links: [],
  pairs: [],
  seq: 0,
  timeline: false,
  gap: 1,
  hidden: [],
  sibs: [],
});

/** Ключ неупорядоченной пары: одинаковый, с какой стороны ни зайди. */
export const pairKey = (a: string, b: string): string => (a < b ? a + "|" + b : b + "|" + a);

/** Та ли это пара, без оглядки на порядок записи. */
export const isPair = (p: Pair, a: string, b: string): boolean =>
  (p.a === a && p.b === b) || (p.a === b && p.b === a);

/** Второй в паре, если первый — `id`; иначе null. */
export const otherIn = (p: Pair, id: string): string | null =>
  p.a === id ? p.b : p.b === id ? p.a : null;
