/**
 * Мелочи, которые иначе переписываются в каждом втором файле: списки по ключу,
 * среднее, размах, слияние в связные куски.
 */

/** Положить значение в список по ключу, заведя список при первом обращении. */
export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Среднее; пустой список — null, а не ноль: «родни нет» и «родня в нуле» разное. */
export function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

/** Наименьшее и наибольшее значение; пустой список — [Infinity, -Infinity]. */
export function extent<T>(items: Iterable<T>, of: (item: T) => number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of items) {
    const v = of(it);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/**
 * Система непересекающихся множеств: ею собираются связные куски древа —
 * компоненты, родня одного поколения, перекрывающиеся шины. Сжатие путей
 * делается делением пополам, рекурсия на глубоком древе не нужна.
 */
export class Merge<T> {
  private up = new Map<T, T>();

  root(a: T): T {
    let x = a;
    let up = this.up.get(x);
    while (up !== undefined && up !== x) {
      const gp = this.up.get(up) ?? up;
      this.up.set(x, gp);
      x = gp;
      up = this.up.get(x);
    }
    return x;
  }

  join(a: T, b: T): void {
    const ra = this.root(a);
    const rb = this.root(b);
    if (ra !== rb) this.up.set(ra, rb);
  }

  /** Куски в порядке первого появления своих людей во входном списке. */
  parts(items: readonly T[]): T[][] {
    const byRoot = new Map<T, T[]>();
    for (const it of items) push(byRoot, this.root(it), it);
    return [...byRoot.values()];
  }
}
