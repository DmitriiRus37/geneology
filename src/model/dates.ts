import { t, type Lang } from "../i18n.ts";
import type { Person } from "./types.ts";

export interface ParsedDate {
  y: number;
  m: number;
  d: number;
  txt: string;
  /** год известен приблизительно: «197?» — семидесятые, «19??» — двадцатый век */
  approx?: true;
}

const pad2 = (v: number | string): string => (String(v).length < 2 ? "0" : "") + v;

/**
 * Год из записи с неизвестными цифрами: «197?» → 1975, «19??» → 1950. Возвращает
 * середину промежутка — по ней человек встаёт в свой ряд и сортируется среди братьев.
 */
function approxYear(token: string): number | null {
  const m = token.match(/^(\d{3})\?$/);
  if (m) return +m[1] * 10 + 5;
  const c = token.match(/^(\d{2})\?\?$/);
  if (c) return +c[1] * 100 + 50;
  return null;
}

/** Есть ли в записи года неизвестные цифры — такую дату показываем как оценку. */
export const isApproxYear = (raw: string | undefined): boolean => /(^|\D)\d{2,3}\?{1,2}(\D|$)/.test(String(raw || ""));

export function parseDate(raw: string | undefined | null): ParsedDate | null {
  const s = String(raw || "").trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // 01.12.1995
  if (m) return { y: +m[3], m: +m[2], d: +m[1], txt: pad2(m[1]) + "." + pad2(m[2]) + "." + m[3] };

  // «??.??.1995» — день и месяц неизвестны; «09.03.202?» — неизвестна цифра года
  m = s.match(/^(\d{1,2}|\?\?)[./-](\d{1,2}|\?\?)[./-](\d{4}|\d{3}\?|\d{2}\?\?)$/);
  if (m) {
    const d = m[1] === "??" ? 0 : +m[1];
    const mo = m[2] === "??" ? 0 : +m[2];
    const ay = approxYear(m[3]);
    const txt = (m[1] === "??" ? "??" : pad2(m[1])) + "." + (m[2] === "??" ? "??" : pad2(m[2])) + "." + m[3];
    return ay !== null ? { y: ay, m: mo, d, txt, approx: true } : { y: +m[3], m: mo, d, txt };
  }

  const ay = approxYear(s); // «197?», «19??»
  if (ay !== null) return { y: ay, m: 0, d: 0, txt: s, approx: true };

  m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/); // 1995-12-01
  if (m) return { y: +m[1], m: +m[2], d: +m[3], txt: pad2(m[3]) + "." + pad2(m[2]) + "." + m[1] };

  m = s.match(/^(\d{1,2})[./-](\d{4})$/); // 12.1995
  if (m) return { y: +m[2], m: +m[1], d: 0, txt: pad2(m[1]) + "." + m[2] };

  m = s.match(/^(\d{4})$/); // 1995
  if (m) return { y: +m[1], m: 0, d: 0, txt: m[1] };

  return { y: 0, m: 0, d: 0, txt: s }; // «ок. 1890», «до 1917», «1880-е гг.»
}

export const dateTxt = (raw: string | undefined): string => {
  const p = parseDate(raw);
  return p ? p.txt : "";
};

export function dateKey(raw: string | undefined): number | null {
  const p = parseDate(raw);
  if (!p || !p.y) return null;
  return p.y * 10000 + p.m * 100 + p.d;
}

/**
 * Разбор одного поля «годы жизни» на рождение и смерть.
 * «1880-е гг.» — не диапазон: справа от дефиса должна стоять цифра.
 */
export function splitRange(s: string | undefined): [string, string] {
  const one = String(s || "").trim();
  const m = one.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (m && /\d/.test(m[1]) && /^\d/.test(m[2])) return [m[1].trim(), m[2].trim()];
  if (/^(†|ум\.?|умер|умерла)\s*/i.test(one)) return ["", one.replace(/^(†|ум\.?|умер|умерла)\s*/i, "")];
  return [one.replace(/^(\*|р\.?|род\.?|родился|родилась)\s*/i, ""), ""];
}

export function fmtDates(p: Pick<Person, "born" | "died">, lang: Lang = "ru"): string {
  const b = dateTxt(p.born);
  const d = dateTxt(p.died);
  if (b && d) return b + " – " + d;
  if (b) return t(lang, "date.born") + b;
  if (d) return t(lang, "date.died") + d;
  return "";
}

/** Ключ сортировки братьев и сестёр: без даты рождения ориентируемся на дату смерти. */
export function birthKey(p: Pick<Person, "born" | "died">): number | null {
  const k = dateKey(p.born);
  if (k !== null) return k;
  const d = dateKey(p.died);
  return d !== null ? d - 500000 : null;
}

/** Год из произвольного текста: «осень 1938», «ок. 1890», «1880-е гг.», «197?». */
export function yearIn(text: string | undefined): number | null {
  const t = String(text || "");
  const m = t.match(/(1[0-9]{3}|20[0-9]{2})/);
  if (m) return +m[1];
  const a = t.match(/(1[0-9]{2}|20[0-9])\?/);
  if (a) return +a[1] * 10 + 5;
  const c = t.match(/(1[0-9]|20)\?\?/);
  return c ? +c[1] * 100 + 50 : null;
}

/**
 * Что записать в поле даты, когда человек закончил ввод. Голый год — «??.??.1995»:
 * так видно, что день и месяц неизвестны, а не забыты. Месяц с годом — «??.12.1995».
 * Приблизительный год («197?») — тоже с вопросами впереди. Остальное не трогаем.
 */
export function normalizeDateInput(raw: string): string {
  const s = raw.trim();
  if (/^(\d{4}|\d{3}\?|\d{2}\?\?)$/.test(s)) return "??.??." + s;
  const m = s.match(/^(\d{1,2})[./-](\d{4}|\d{3}\?|\d{2}\?\?)$/);
  if (m) return "??." + pad2(m[1]) + "." + m[2];
  return s;
}

export function yearOfBirth(p: Pick<Person, "born">): number | null {
  const d = parseDate(p.born);
  if (d && d.y) return d.y;
  return yearIn(p.born);
}

/** Короткая подпись для списка: «1929–1985», «1929» или «†1985». */
export function yearTag(p: Pick<Person, "born" | "died">): string {
  // год достаём и из свободного текста: «осень 1938», «1880-е гг.»
  const b = yearIn(p.born);
  const d = yearIn(p.died);
  const by = b ? String(b) : "";
  const dy = d ? String(d) : "";
  if (by && dy) return by + "–" + dy;
  if (by) return by;
  return dy ? "†" + dy : "";
}
