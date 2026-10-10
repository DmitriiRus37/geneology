import assert from "node:assert/strict";
import { test } from "node:test";
import { dictionaryKeys, msg, render, t } from "./i18n.ts";
import { fmtDates } from "./model/dates.ts";

test("the English dictionary has every Russian key, and the other way round", () => {
  const { ru, en } = dictionaryKeys();
  assert.deepEqual(ru.filter((k) => !en.includes(k)), [], "missing from the English one");
  assert.deepEqual(en.filter((k) => !ru.includes(k)), [], "missing from the Russian one");
});

test("substitutions, and Russian as the fallback", () => {
  assert.equal(t("en", "msg.hidden", { n: 3 }), "3 hidden. Bring them back with “Show everyone”");
  assert.equal(render("ru", msg("reason.loop", { name: "Иван" })), "Так получилась бы петля: Иван уже ниже по древу");
  assert.equal(t("en", "no.such.key"), "no.such.key", "an unknown key comes back as it is");
});

test("the date caption on a card depends on the language", () => {
  assert.equal(fmtDates({ born: "1927", died: "" }, "en"), "b. 1927");
  assert.equal(fmtDates({ born: "", died: "1985" }, "en"), "d. 1985");
  assert.equal(fmtDates({ born: "1927", died: "" }), "р. 1927");
});

test("a maiden name on a card: «ур.» in Russian, «née» in English", () => {
  assert.equal(t("ru", "card.maiden", { name: "Иванова" }), "ур. Иванова");
  assert.equal(t("en", "card.maiden", { name: "Ivanova" }), "née Ivanova");
});
