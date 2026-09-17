import assert from "node:assert/strict";
import { test } from "node:test";
import { normalize } from "./tree.ts";
import { birthKey, fmtDates, isApproxYear, normalizeDateInput, parseDate, splitRange, yearIn, yearOfBirth } from "./dates.ts";

test("dates are parsed in every accepted spelling", () => {
  assert.deepEqual(parseDate("01.12.1995"), { y: 1995, m: 12, d: 1, txt: "01.12.1995" });
  assert.deepEqual(parseDate("1995-12-01"), { y: 1995, m: 12, d: 1, txt: "01.12.1995" });
  assert.deepEqual(parseDate("12.1995"), { y: 1995, m: 12, d: 0, txt: "12.1995" });
  assert.deepEqual(parseDate("1995"), { y: 1995, m: 0, d: 0, txt: "1995" });
  assert.equal(parseDate(""), null);
});

test("free text is kept as it is, but the year is pulled out of it", () => {
  assert.equal(parseDate("осень 1938")?.txt, "осень 1938");
  assert.equal(yearOfBirth({ born: "осень 1938" }), 1938);
  assert.equal(yearOfBirth({ born: "ок. 1890" }), 1890);
  assert.equal(yearIn("1880-е гг."), 1880);
  assert.equal(yearIn("без дат"), null);
});

test("\"1880-е гг.\" is not a range: a digit must stand to the right of the hyphen", () => {
  assert.deepEqual(splitRange("1880-е гг."), ["1880-е гг.", ""]);
  assert.deepEqual(splitRange("1932 - 2005"), ["1932", "2005"]);
  assert.deepEqual(splitRange("28.02.1932 – 17.10.2005"), ["28.02.1932", "17.10.2005"]);
  assert.deepEqual(splitRange("† 1959"), ["", "1959"]);
});

test("the caption on a card", () => {
  assert.equal(fmtDates({ born: "28.02.1932", died: "17.10.2005" }), "28.02.1932 – 17.10.2005");
  assert.equal(fmtDates({ born: "1927", died: "" }), "р. 1927");
  assert.equal(fmtDates({ born: "", died: "1985" }), "† 1985");
  assert.equal(fmtDates({ born: "", died: "" }), "");
});

test("with no date of birth the order is set by the date of death", () => {
  assert.equal(birthKey({ born: "1927", died: "" }), 19270000);
  assert.equal(birthKey({ born: "", died: "1985" }), 19850000 - 500000);
  assert.equal(birthKey({ born: "", died: "" }), null);
});

test("an unknown day and month: \"??.??.1995\" is an ordinary year", () => {
  assert.deepEqual(parseDate("??.??.1995"), { y: 1995, m: 0, d: 0, txt: "??.??.1995" });
  assert.deepEqual(parseDate("??.12.1995"), { y: 1995, m: 12, d: 0, txt: "??.12.1995" });
  assert.equal(birthKey({ born: "??.??.1995", died: "" }), 19950000);
  assert.equal(fmtDates({ born: "??.??.1995", died: "" }), "р. ??.??.1995");
});

test("\"197?\" means the year is approximate: the middle of the decade, and a mark", () => {
  assert.deepEqual(parseDate("197?"), { y: 1975, m: 0, d: 0, txt: "197?", approx: true });
  assert.deepEqual(parseDate("09.03.202?"), { y: 2025, m: 3, d: 9, txt: "09.03.202?", approx: true });
  assert.equal(parseDate("19??")?.y, 1950);
  assert.equal(yearIn("197?"), 1975);
  assert.equal(yearOfBirth({ born: "??.??.197?" }), 1975);
  assert.ok(isApproxYear("197?") && isApproxYear("09.03.202?") && !isApproxYear("1975"));
  assert.ok(birthKey({ born: "197?", died: "" })! < birthKey({ born: "1978", died: "" })!, "it sorts by the middle");
});

test("once typed, a bare year turns into \"??.??.year\"", () => {
  assert.equal(normalizeDateInput("1995"), "??.??.1995");
  assert.equal(normalizeDateInput(" 197? "), "??.??.197?");
  assert.equal(normalizeDateInput("12.1995"), "??.12.1995");
  assert.equal(normalizeDateInput("01.12.1995"), "01.12.1995");
  assert.equal(normalizeDateInput("осень 1938"), "осень 1938");
  assert.equal(normalizeDateInput(""), "");
});

test("old records with a bare year are brought to \"??.??.year\" on load", () => {
  const s = normalize({ people: { a: { id: "a", name: "Лидия", born: "1970", died: "" }, b: { id: "b", name: "Х", born: "осень 1938", died: "12.1995" } } });
  assert.equal(s.people.a.born, "??.??.1970");
  assert.equal(fmtDates(s.people.a), "р. ??.??.1970");
  assert.equal(s.people.b.born, "осень 1938", "free text is left alone");
  assert.equal(s.people.b.died, "??.12.1995");
});
