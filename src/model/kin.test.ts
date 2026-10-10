import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "../i18n.ts";
import { kinOf } from "./kin.ts";
import { addPair, addPerson, addSibling, link } from "./tree.ts";
import { emptyState } from "./types.ts";

function family() {
  const s = emptyState();
  const father = addPerson(s, { name: "Иван Егорович Якунин", sex: "m" });
  const mother = addPerson(s, { name: "Анна Фёдоровна Якунина", sex: "f" });
  const son = addPerson(s, { name: "Алексей Иванович Якунин", sex: "m" });
  const daughter = addPerson(s, { name: "Мария Ивановна Якунина", sex: "f" });
  addPair(s, father, mother);
  link(s, father, son);
  link(s, mother, son);
  link(s, father, daughter);
  link(s, mother, daughter);
  return { s, father, mother, son, daughter };
}

test("kin are captioned by sex", () => {
  const { s, father, mother, son, daughter } = family();
  const rolesOf = (id: string) => Object.fromEntries(kinOf(s, id).map((k) => [s.people[k.id].name, k.label]));
  assert.deepEqual(rolesOf(son), {
    "Иван Егорович Якунин": "отец",
    "Анна Фёдоровна Якунина": "мать",
    "Мария Ивановна Якунина": "сестра",
  }, "the son has parents and a sister through shared parents — one step up and down, no further across the tree");
  assert.deepEqual(rolesOf(father), {
    "Анна Фёдоровна Якунина": "жена",
    "Алексей Иванович Якунин": "сын",
    "Мария Ивановна Якунина": "дочь",
  });
  assert.equal(rolesOf(mother)["Иван Егорович Якунин"], "муж");
  assert.equal(kinOf(s, daughter).find((k) => k.id === father)?.label, "отец");
});

test("with the sex unstated the role is the general one", () => {
  const s = emptyState();
  const a = addPerson(s, { name: "Х", sex: "u" });
  const b = addPerson(s, { name: "Y", sex: "u" });
  link(s, a, b);
  assert.equal(kinOf(s, b)[0].label, "родитель");
  assert.equal(kinOf(s, a)[0].label, "ребёнок");
});

test("tangled kinship does not loop: a person in two roles is one line", () => {
  const s = emptyState();
  const him = addPerson(s, { name: "Он", sex: "m" });
  const her = addPerson(s, { name: "Она", sex: "f" });
  link(s, him, her); // her father...
  s.pairs.push({ a: him, b: her }); // ...and her husband: addPair refuses that, but an old file may hold it
  const rows = kinOf(s, her);
  assert.equal(rows.length, 1, "one person, one line");
  assert.equal(rows[0].label, "отец · муж");
  assert.deepEqual(kinOf(s, him).map((k) => k.label), ["жена · дочь"]);
});

test("nobody is kin to themselves", () => {
  const s = emptyState();
  const alone = addPerson(s, { name: "Один", sex: "m" });
  s.links.push({ parent: alone, child: alone }); // broken data out of a file
  assert.deepEqual(kinOf(s, alone), []);
});

test("a same-sex marriage is not created", () => {
  const s = emptyState();
  const m1 = addPerson(s, { name: "Иван", sex: "m" });
  const m2 = addPerson(s, { name: "Пётр", sex: "m" });
  const f1 = addPerson(s, { name: "Анна", sex: "f" });
  const u1 = addPerson(s, { name: "Валя", sex: "u" });

  const r = addPair(s, m1, m2);
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? render("ru", r.reason) : "", /Оба мужчины/);
  assert.equal(s.pairs.length, 0);

  assert.equal(addPair(s, m1, f1).ok, true, "a man and a woman are allowed");
  assert.equal(addPair(s, f1, u1).ok, true, "the sex is unstated, so we do not interfere");
  assert.equal(addPair(s, m1, m1).ok, false, "with oneself is not allowed");
});

test("siblings among the kin: through shared parents and recorded explicitly", () => {
  const s = emptyState();
  const mother = addPerson(s, { name: "Мать", sex: "f" });
  const me = addPerson(s, { name: "Я", sex: "m" });
  const sister = addPerson(s, { name: "Сестра", sex: "f" });
  const brother = addPerson(s, { name: "Брат", sex: "m" });
  link(s, mother, me);
  link(s, mother, sister);
  assert.equal(addSibling(s, me, brother).ok, true);
  const rows = kinOf(s, me);
  const roleOf = (id: string) => rows.find((r) => r.id === id);
  assert.equal(roleOf(sister)?.label, "сестра");
  assert.equal(roleOf(sister)?.explicit, undefined, "through a shared mother — it is the link to the mother that must go");
  assert.equal(roleOf(brother)?.label, "брат");
  assert.equal(roleOf(brother)?.explicit, true, "recorded explicitly, so it can be removed");
  const r = addSibling(s, me, sister);
  assert.ok(r.ok && r.already, "already siblings through the mother — we do not record it twice");
  assert.equal(addSibling(s, mother, me).ok, false, "a parent is never a sibling");
});
