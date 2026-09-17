import assert from "node:assert/strict";
import { test } from "node:test";
import { allNames, findByName, guessSex, matches, nameForms } from "./names.ts";
import { addPerson } from "./tree.ts";
import { emptyState } from "./types.ts";

test("пол по отчеству — кириллица не ловится на \\b, проверяем каждое слово с якорем", () => {
  assert.equal(guessSex("Иван Егорович Якунин"), "m");
  assert.equal(guessSex("Анна Фёдоровна Якунина"), "f");
  assert.equal(guessSex("Раиса Алексеевна Стыраневская"), "f");
  assert.equal(guessSex("Сергей Ликандрович Гурылев"), "m");
});

test("пол по фамилии и по имени, когда отчества нет", () => {
  assert.equal(guessSex("Мария Шолохова"), "f");
  assert.equal(guessSex("Артём Егизаров"), "m");
  assert.equal(guessSex("Надежда"), "f");
  assert.equal(guessSex("Владимир"), "m");
  assert.equal(guessSex("Илья"), "m", "Илья — мужское, несмотря на -я");
  assert.equal(guessSex("дочь Валя"), "f", "слово-роль важнее окончания");
});

test("строгое сопоставление не склеивает сестёр по общей девичьей фамилии", () => {
  const p = { name: "Раиса Алексеевна Стыраневская", maiden: "Якунина", alt: [] };
  const forms = nameForms(p);
  assert.ok(forms.includes("раиса алексеевна стыраневская"));
  assert.ok(forms.includes("раиса алексеевна якунина"), "фамилия подставляется в то же имя-отчество");
  assert.ok(!forms.includes("якунина"), "голой фамилии в строгих формах быть не должно");
  assert.ok(allNames(p).includes("якунина"), "а в свободном поиске — должна");
});

test("поиск по имени: две сестры остаются двумя людьми", () => {
  const s = emptyState();
  const a = addPerson(s, { name: "Раиса Алексеевна Стыраневская", maiden: "Якунина" });
  const b = addPerson(s, { name: "Татьяна Алексеевна Гурылева", maiden: "Якунина" });
  assert.notEqual(a, b);
  assert.equal(findByName(s, "Раиса Алексеевна Якунина"), a);
  assert.equal(findByName(s, "Татьяна Алексеевна Якунина"), b);
  assert.equal(Object.keys(s.people).length, 2);
});

test("ё и регистр не мешают поиску по панели", () => {
  const p = { name: "Анна Фёдоровна Якунина", maiden: "", alt: ["Степановская"] };
  assert.ok(matches(p, "федоровна"));
  assert.ok(matches(p, "ЯКУН"));
  assert.ok(matches(p, "степановская"));
  assert.ok(!matches(p, "лесняк"));
});
