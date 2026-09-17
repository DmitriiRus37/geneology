import assert from "node:assert/strict";
import { test } from "node:test";
import { dictionaryKeys, msg, render, t } from "./i18n.ts";
import { fmtDates } from "./model/dates.ts";

test("в английском словаре есть каждый русский ключ, и наоборот", () => {
  const { ru, en } = dictionaryKeys();
  assert.deepEqual(ru.filter((k) => !en.includes(k)), [], "нет в английском");
  assert.deepEqual(en.filter((k) => !ru.includes(k)), [], "нет в русском");
});

test("подстановки и запасной русский", () => {
  assert.equal(t("en", "msg.hidden", { n: 3 }), "3 hidden. Bring them back with “Show everyone”");
  assert.equal(render("ru", msg("reason.loop", { name: "Иван" })), "Так получилась бы петля: Иван уже ниже по древу");
  assert.equal(t("en", "нет.такого"), "нет.такого", "неизвестный ключ возвращается как есть");
});

test("подпись дат на карточке зависит от языка", () => {
  assert.equal(fmtDates({ born: "1927", died: "" }, "en"), "b. 1927");
  assert.equal(fmtDates({ born: "", died: "1985" }, "en"), "d. 1985");
  assert.equal(fmtDates({ born: "1927", died: "" }), "р. 1927");
});
