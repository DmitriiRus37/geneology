import assert from "node:assert/strict";
import { test } from "node:test";
import { allNames, findByName, guessSex, matches, nameForms } from "./names.ts";
import { addPerson } from "./tree.ts";
import { emptyState } from "./types.ts";

test("sex from the patronymic — Cyrillic is not caught by \\b, so every word is checked with an anchor", () => {
  assert.equal(guessSex("Иван Егорович Якунин"), "m");
  assert.equal(guessSex("Анна Фёдоровна Якунина"), "f");
  assert.equal(guessSex("Раиса Алексеевна Стыраневская"), "f");
  assert.equal(guessSex("Сергей Ликандрович Гурылев"), "m");
});

test("sex from the surname and the given name when there is no patronymic", () => {
  assert.equal(guessSex("Мария Шолохова"), "f");
  assert.equal(guessSex("Артём Егизаров"), "m");
  assert.equal(guessSex("Надежда"), "f");
  assert.equal(guessSex("Владимир"), "m");
  assert.equal(guessSex("Илья"), "m", "a male name despite the -я ending");
  assert.equal(guessSex("дочь Валя"), "f", "a role word outweighs the ending");
});

test("strict matching does not glue sisters together by a shared maiden name", () => {
  const p = { name: "Раиса Алексеевна Стыраневская", maiden: "Якунина", alt: [] };
  const forms = nameForms(p);
  assert.ok(forms.includes("раиса алексеевна стыраневская"));
  assert.ok(forms.includes("раиса алексеевна якунина"), "the surname is substituted into the same given name and patronymic");
  assert.ok(!forms.includes("якунина"), "a bare surname must not appear among the strict forms");
  assert.ok(allNames(p).includes("якунина"), "but in the loose search it must");
});

test("search by name: two sisters stay two people", () => {
  const s = emptyState();
  const a = addPerson(s, { name: "Раиса Алексеевна Стыраневская", maiden: "Якунина" });
  const b = addPerson(s, { name: "Татьяна Алексеевна Гурылева", maiden: "Якунина" });
  assert.notEqual(a, b);
  assert.equal(findByName(s, "Раиса Алексеевна Якунина"), a);
  assert.equal(findByName(s, "Татьяна Алексеевна Якунина"), b);
  assert.equal(Object.keys(s.people).length, 2);
});

test("the letter ё and letter case do not get in the way of the sidebar search", () => {
  const p = { name: "Анна Фёдоровна Якунина", maiden: "", alt: ["Степановская"] };
  assert.ok(matches(p, "федоровна"));
  assert.ok(matches(p, "ЯКУН"));
  assert.ok(matches(p, "степановская"));
  assert.ok(!matches(p, "лесняк"));
});
