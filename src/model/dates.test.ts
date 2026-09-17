import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "./tree.ts";
import { birthKey, fmtDates, isApproxYear, normalizeDateInput, parseDate, splitRange, yearIn, yearOfBirth } from "./dates.ts";

test("даты разбираются во всех принятых написаниях", () => {
  assert.deepEqual(parseDate("01.12.1995"), { y: 1995, m: 12, d: 1, txt: "01.12.1995" });
  assert.deepEqual(parseDate("1995-12-01"), { y: 1995, m: 12, d: 1, txt: "01.12.1995" });
  assert.deepEqual(parseDate("12.1995"), { y: 1995, m: 12, d: 0, txt: "12.1995" });
  assert.deepEqual(parseDate("1995"), { y: 1995, m: 0, d: 0, txt: "1995" });
  assert.equal(parseDate(""), null);
});

test("свободный текст сохраняется как есть, но год из него вынимается", () => {
  assert.equal(parseDate("осень 1938")?.txt, "осень 1938");
  assert.equal(yearOfBirth({ born: "осень 1938" }), 1938);
  assert.equal(yearOfBirth({ born: "ок. 1890" }), 1890);
  assert.equal(yearIn("1880-е гг."), 1880);
  assert.equal(yearIn("без дат"), null);
});

test("«1880-е гг.» — не диапазон: справа от дефиса должна стоять цифра", () => {
  assert.deepEqual(splitRange("1880-е гг."), ["1880-е гг.", ""]);
  assert.deepEqual(splitRange("1932 - 2005"), ["1932", "2005"]);
  assert.deepEqual(splitRange("28.02.1932 – 17.10.2005"), ["28.02.1932", "17.10.2005"]);
  assert.deepEqual(splitRange("† 1959"), ["", "1959"]);
});

test("подпись на карточке", () => {
  assert.equal(fmtDates({ born: "28.02.1932", died: "17.10.2005" }), "28.02.1932 – 17.10.2005");
  assert.equal(fmtDates({ born: "1927", died: "" }), "р. 1927");
  assert.equal(fmtDates({ born: "", died: "1985" }), "† 1985");
  assert.equal(fmtDates({ born: "", died: "" }), "");
});

test("без даты рождения порядок задаёт дата смерти", () => {
  assert.equal(birthKey({ born: "1927", died: "" }), 19270000);
  assert.equal(birthKey({ born: "", died: "1985" }), 19850000 - 500000);
  assert.equal(birthKey({ born: "", died: "" }), null);
});

test("неизвестные день и месяц: «??.??.1995» — обычный год", () => {
  assert.deepEqual(parseDate("??.??.1995"), { y: 1995, m: 0, d: 0, txt: "??.??.1995" });
  assert.deepEqual(parseDate("??.12.1995"), { y: 1995, m: 12, d: 0, txt: "??.12.1995" });
  assert.equal(birthKey({ born: "??.??.1995", died: "" }), 19950000);
  assert.equal(fmtDates({ born: "??.??.1995", died: "" }), "р. ??.??.1995");
});

test("«197?» — год известен приблизительно: середина десятилетия и пометка", () => {
  assert.deepEqual(parseDate("197?"), { y: 1975, m: 0, d: 0, txt: "197?", approx: true });
  assert.deepEqual(parseDate("09.03.202?"), { y: 2025, m: 3, d: 9, txt: "09.03.202?", approx: true });
  assert.equal(parseDate("19??")?.y, 1950);
  assert.equal(yearIn("197?"), 1975);
  assert.equal(yearOfBirth({ born: "??.??.197?" }), 1975);
  assert.ok(isApproxYear("197?") && isApproxYear("09.03.202?") && !isApproxYear("1975"));
  assert.ok(birthKey({ born: "197?", died: "" })! < birthKey({ born: "1978", died: "" })!, "сортируется по середине");
});

test("после ввода голый год превращается в «??.??.год»", () => {
  assert.equal(normalizeDateInput("1995"), "??.??.1995");
  assert.equal(normalizeDateInput(" 197? "), "??.??.197?");
  assert.equal(normalizeDateInput("12.1995"), "??.12.1995");
  assert.equal(normalizeDateInput("01.12.1995"), "01.12.1995");
  assert.equal(normalizeDateInput("осень 1938"), "осень 1938");
  assert.equal(normalizeDateInput(""), "");
});

test("старые записи с голым годом приводятся к «??.??.год» при загрузке", () => {
  const s = normalize({ people: { a: { id: "a", name: "Лидия", born: "1970", died: "" }, b: { id: "b", name: "Х", born: "осень 1938", died: "12.1995" } } });
  assert.equal(s.people.a.born, "??.??.1970");
  assert.equal(fmtDates(s.people.a), "р. ??.??.1970");
  assert.equal(s.people.b.born, "осень 1938", "свободный текст не трогаем");
  assert.equal(s.people.b.died, "??.12.1995");
});
