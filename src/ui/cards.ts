/**
 * What the layout needs from the interface to size a card: a way to measure text
 * and the card's words in the current language.
 */
import { t, type Lang } from "../i18n.ts";
import { byChars, cardSizer, type CardSizer, type CardText, type Measure } from "../layout/measure.ts";
import { fmtDates } from "../model/dates.ts";

export const cardText = (lang: Lang): CardText => ({
  maiden: (name) => t(lang, "card.maiden", { name }),
  dates: (p) => fmtDates(p, lang),
});

/** A canvas in the browser; by characters where there is no document (server rendering in the tests). */
function canvasMeasure(): Measure {
  if (typeof document === "undefined") return byChars;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return (text) => text.length * 8;
  return (text, font) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

let measure: Measure | null = null;
const sizers: Partial<Record<Lang, CardSizer>> = {};

/** One sizer per language, sharing one canvas, so the cache survives a re-render. */
export function cardsFor(lang: Lang): CardSizer {
  measure ??= canvasMeasure();
  return (sizers[lang] ??= cardSizer(measure, cardText(lang)));
}
