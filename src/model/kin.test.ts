import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../i18n.ts";
import { kinOf } from "./kin.ts";
import { addPair, addPerson, addSibling, link } from "./tree.ts";
import { emptyState } from "./types.ts";

function семья() {
  const s = emptyState();
  const отец = addPerson(s, { name: "Иван Егорович Якунин", sex: "m" });
  const мать = addPerson(s, { name: "Анна Фёдоровна Якунина", sex: "f" });
  const сын = addPerson(s, { name: "Алексей Иванович Якунин", sex: "m" });
  const дочь = addPerson(s, { name: "Мария Ивановна Якунина", sex: "f" });
  addPair(s, отец, мать);
  link(s, отец, сын);
  link(s, мать, сын);
  link(s, отец, дочь);
  link(s, мать, дочь);
  return { s, отец, мать, сын, дочь };
}

test("родня подписана по полу", () => {
  const { s, отец, мать, сын, дочь } = семья();
  const у = (id: string) => Object.fromEntries(kinOf(s, id).map((k) => [s.people[k.id].name, k.label]));
  assert.deepEqual(у(сын), {
    "Иван Егорович Якунин": "отец",
    "Анна Фёдоровна Якунина": "мать",
    "Мария Ивановна Якунина": "сестра",
  }, "у сына родители и сестра через общих родителей — на шаг вверх и вниз, дальше по древу не идём");
  assert.deepEqual(у(отец), {
    "Анна Фёдоровна Якунина": "жена",
    "Алексей Иванович Якунин": "сын",
    "Мария Ивановна Якунина": "дочь",
  });
  assert.equal(у(мать)["Иван Егорович Якунин"], "муж");
  assert.equal(kinOf(s, дочь).find((k) => k.id === отец)?.label, "отец");
});

test("пол не указан — роль общая", () => {
  const s = emptyState();
  const a = addPerson(s, { name: "Х", sex: "u" });
  const b = addPerson(s, { name: "Y", sex: "u" });
  link(s, a, b);
  assert.equal(kinOf(s, b)[0].label, "родитель");
  assert.equal(kinOf(s, a)[0].label, "ребёнок");
});

test("запутанное родство не зацикливает: человек в двух ролях — одна строка", () => {
  const s = emptyState();
  const он = addPerson(s, { name: "Он", sex: "m" });
  const она = addPerson(s, { name: "Она", sex: "f" });
  link(s, он, она); // и отец…
  addPair(s, он, она); // …и муж, как ни печально
  const rows = kinOf(s, она);
  assert.equal(rows.length, 1, "один человек — одна строка");
  assert.equal(rows[0].label, "отец · муж");
  assert.deepEqual(kinOf(s, он).map((k) => k.label), ["жена · дочь"]);
});

test("сам себе роднёй не бывает", () => {
  const s = emptyState();
  const один = addPerson(s, { name: "Один", sex: "m" });
  s.links.push({ parent: один, child: один }); // битые данные из файла
  assert.deepEqual(kinOf(s, один), []);
});

test("однополый брак не создаётся", () => {
  const s = emptyState();
  const m1 = addPerson(s, { name: "Иван", sex: "m" });
  const m2 = addPerson(s, { name: "Пётр", sex: "m" });
  const f1 = addPerson(s, { name: "Анна", sex: "f" });
  const u1 = addPerson(s, { name: "Валя", sex: "u" });

  const r = addPair(s, m1, m2);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? render("ru", r.reason) : "", /Оба мужчины/);
  assert.equal(s.pairs.length, 0);

  assert.equal(addPair(s, m1, f1).ok, true, "мужчина и женщина — можно");
  assert.equal(addPair(s, f1, u1).ok, true, "пол не указан — не мешаем");
  assert.equal(addPair(s, m1, m1).ok, false, "сам с собой — нельзя");
});

test("братья и сёстры в родне: через общих родителей и записанные явно", () => {
  const s = emptyState();
  const мать = addPerson(s, { name: "Мать", sex: "f" });
  const я = addPerson(s, { name: "Я", sex: "m" });
  const сестра = addPerson(s, { name: "Сестра", sex: "f" });
  const брат = addPerson(s, { name: "Брат", sex: "m" });
  link(s, мать, я);
  link(s, мать, сестра);
  assert.equal(addSibling(s, я, брат).ok, true);
  const rows = kinOf(s, я);
  const роль = (id: string) => rows.find((r) => r.id === id);
  assert.equal(роль(сестра)?.label, "сестра");
  assert.equal(роль(сестра)?.explicit, undefined, "через общую мать — убирать надо связь с матерью");
  assert.equal(роль(брат)?.label, "брат");
  assert.equal(роль(брат)?.explicit, true, "записан явно — можно убрать");
  const r = addSibling(s, я, сестра);
  assert.ok(r.ok && r.already, "уже брат и сестра через мать — второй раз не записываем");
  assert.equal(addSibling(s, мать, я).ok, false, "родитель братом не бывает");
});
