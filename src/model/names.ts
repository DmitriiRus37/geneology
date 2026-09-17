import type { Person, Sex, TreeState } from "./types.ts";

export const norm = (s: string): string =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Строгие формы имени — по ним решаем, один это человек или разные.
 * Голой фамилии здесь нет намеренно: у двух сестёр одна девичья фамилия,
 * и по ней они склеивались в одного человека.
 */
export function nameForms(p: Pick<Person, "name" | "maiden" | "alt">): string[] {
  const out = [norm(p.name)];
  const head = p.name.split(" ").slice(0, -1).join(" ");
  const sub = (variant: string) => {
    if (!variant) return;
    // фамилию подставляем в то же имя-отчество, а не сравниваем саму по себе
    if (variant.indexOf(" ") > -1 || !head) out.push(norm(variant));
    else out.push(norm(head + " " + variant));
  };
  sub(p.maiden);
  (p.alt || []).forEach(sub);
  return out;
}

/** Свободные формы — для поиска по панели, тут голая фамилия уместна. */
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

export function findByName(state: TreeState, name: string): string | null {
  const key = norm(name);
  const ids = Object.keys(state.people);
  for (const id of ids) if (norm(state.people[id].name) === key) return id;
  for (const id of ids) if (nameForms(state.people[id]).indexOf(key) > -1) return id;
  return null;
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
 * Пол по отчеству, фамилии, окончанию имени и словам-ролям.
 * Каждое слово проверяется отдельно с якорем `$`: `\b` в JS считает границей
 * только `[A-Za-z0-9_]`, поэтому по кириллице он не срабатывает.
 */
export function guessSex(name: string): Sex {
  const parts = norm(name).split(" ").filter(Boolean).filter((w) => w !== "я");
  if (!parts.length) return "u";

  for (const w of parts) if (ROLES[w]) return ROLES[w];

  for (const w of parts) {
    // отчество надёжнее всего
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
  if (/й$/.test(first)) return "m";
  if (/[ьиоуыэе]$/.test(first)) return "u";
  return "m";
}

/** Цвет знака: синий у мужчин, розовый у женщин — привычная пара. */
export const colorOf = (sex: Sex): string =>
  sex === "f" ? "#B05C82" : sex === "m" ? "#3A6EA5" : "#8593A2";

/** Заливка жетона — сильно разбавленный тот же цвет. */
export const tintOf = (sex: Sex): string =>
  sex === "f" ? "#F7E1EA" : sex === "m" ? "#DEE9F6" : "#ECEFF3";

/** Знак в жетоне. U+FE0E — чтобы система не подменила его цветным эмодзи. */
export const markOf = (sex: Sex): string =>
  sex === "f" ? "\u2640\uFE0E" : sex === "m" ? "\u2642\uFE0E" : "?";
