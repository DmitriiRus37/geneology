import type { Person, Sex } from "./types.ts";

export const norm = (s: string): string =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Strict forms of a name — we decide by them whether this is one person or two
 * different ones. The bare surname is deliberately absent here: two sisters share a
 * maiden name, and it used to glue them into a single person.
 */
export function nameForms(p: Pick<Person, "name" | "maiden" | "alt">): string[] {
  const out = [norm(p.name)];
  const head = p.name.split(" ").slice(0, -1).join(" ");
  const sub = (variant: string) => {
    if (!variant) return;
    // we substitute the surname into the same given name and patronymic rather than comparing it on its own
    if (variant.indexOf(" ") > -1 || !head) out.push(norm(variant));
    else out.push(norm(head + " " + variant));
  };
  sub(p.maiden);
  (p.alt || []).forEach(sub);
  return out;
}

/** Loose forms — for the sidebar search, where a bare surname is appropriate. */
export function allNames(p: Pick<Person, "name" | "maiden" | "alt">): string[] {
  return nameForms(p).concat(
    [p.maiden]
      .concat(p.alt || [])
      .filter(Boolean)
      .map(norm),
  );
}

export function matches(p: Pick<Person, "name" | "maiden" | "alt">, filter: string): boolean {
  const f = norm(filter);
  if (!f) return true;
  return allNames(p).some((n) => n.indexOf(f) > -1);
}

const MALE_A = [
  "илья", "никита", "кузьма", "фома", "лука", "савва", "данила", "гаврила", "никола",
  "миша", "саша", "паша", "ваня", "коля", "дима", "витя", "сева", "женя", "валя", "слава",
  "боря", "юра", "толя", "гриша", "тема", "степа", "сережа", "леха", "леша", "андрюша",
  "ванюша", "петя", "вова", "гена", "сеня", "игоряша",
];

const ROLES: Record<string, Sex> = {
  дед: "m", дедушка: "m", прадед: "m", прадедушка: "m", отец: "m", папа: "m", батя: "m",
  отчим: "m", сын: "m", пасынок: "m", внук: "m", правнук: "m", брат: "m", муж: "m",
  супруг: "m", зять: "m", тесть: "m", свекор: "m", дядя: "m", племянник: "m", крестный: "m",
  кузен: "m",
  баба: "f", бабушка: "f", прабабка: "f", прабабушка: "f", мать: "f", мама: "f", мачеха: "f",
  дочь: "f", дочка: "f", падчерица: "f", внучка: "f", правнучка: "f", сестра: "f", жена: "f",
  супруга: "f", невестка: "f", сноха: "f", теща: "f", свекровь: "f", тетя: "f",
  племянница: "f", крестная: "f", кузина: "f",
};

/**
 * Sex from the patronymic, the surname, the ending of the given name and the role
 * words. Every word is checked separately with a `$` anchor: `\b` in JS treats only
 * `[A-Za-z0-9_]` as a boundary, so it never fires on Cyrillic. A name the rules do not
 * know is "u": a wrong guess would refuse a marriage as one of two men or two women.
 */
export function guessSex(name: string): Sex {
  const parts = norm(name).split(" ").filter(Boolean).filter((w) => w !== "я");
  if (!parts.length) return "u";

  for (const w of parts) if (ROLES[w]) return ROLES[w];

  for (const w of parts) {
    // the patronymic is the most reliable of all
    if (/(ович|евич|ьич|иич|ич)$/.test(w) && w.length > 4) return "m";
    if (/(овна|евна|ична|инична)$/.test(w)) return "f";
  }

  const last = parts[parts.length - 1];
  if (parts.length > 1) {
    if (/(ова|ева|ина|ына|ская|цкая|ая|яя)$/.test(last)) return "f";
    if (/(ов|ев|ин|ын|ский|цкий|ой)$/.test(last)) return "m";
  }

  const first = parts[0];
  if (/[ая]$/.test(first)) return MALE_A.indexOf(first) >= 0 ? "m" : "f";
  // a Russian man's name ends in a consonant (Владимир, Андрей); a soft sign, another
  // vowel or another script altogether is beyond these rules, and then nothing is guessed
  return /[бвгджзйклмнпрстфхцчшщъ]$/.test(first) ? "m" : "u";
}

/** The mark's colour: blue for men, pink for women — the familiar pair. */
export const colorOf = (sex: Sex): string =>
  sex === "f" ? "#B05C82" : sex === "m" ? "#3A6EA5" : "#8593A2";

/** The chip's fill — the same colour, heavily diluted. */
export const tintOf = (sex: Sex): string =>
  sex === "f" ? "#F7E1EA" : sex === "m" ? "#DEE9F6" : "#ECEFF3";

/** The mark inside the chip. U+FE0E keeps the system from swapping it for a colour emoji. */
export const markOf = (sex: Sex): string =>
  sex === "f" ? "\u2640\uFE0E" : sex === "m" ? "\u2642\uFE0E" : "?";
