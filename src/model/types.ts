export type Sex = "m" | "f" | "u";

export interface Person {
  id: string;
  name: string;
  maiden: string;
  alt: string[];
  born: string;
  died: string;
  sex: Sex;
  /** the ordinal number of the addition — it is what holds the row order stable */
  n: number;
  /** the pinned position after a drag */
  fx?: number;
  fy?: number;
  /**
   * The fields of the stored card the app does not know, as they were: they travel with
   * the person untouched and are written back into the card on the next save.
   */
  extra?: Record<string, unknown>;
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
  /** who we are not showing right now: the part of the tree cut off upwards */
  hidden: string[];
  /** siblings with no shared parents recorded — a dashed kinship */
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

/** The key of an unordered pair: the same whichever side you come from. */
export const pairKey = (a: string, b: string): string => (a < b ? a + "|" + b : b + "|" + a);

/** Whether this is that pair, regardless of the order it was recorded in. */
export const isPair = (p: Pair, a: string, b: string): boolean =>
  (p.a === a && p.b === b) || (p.a === b && p.b === a);

/** The other one in the pair if the first is `id`; otherwise null. */
export const otherIn = (p: Pair, id: string): string | null =>
  p.a === id ? p.b : p.b === id ? p.a : null;
