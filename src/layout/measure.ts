/**
 * How big a card is and what lines it shows. The layout does not measure text and
 * does not know the interface language: both come from outside as a `CardSizer`.
 * The browser measures with a canvas; Node (tests, metrics) by the number of
 * characters, `byChars`.
 */
import type { Person } from "../model/types.ts";

export const NODE_W = 202;
/** The strip along the top of a card where the sex badge sits: no text goes into it. */
export const CHIP_BAND = 7;
/** No card is lower than this, and no row either. */
export const MIN_CARD_H = 46;
/** Padding above and below the text, besides the badge strip. */
const PAD_Y = 24;
/** Room for text across a card. */
const TEXT_W = NODE_W - 24;
/** The round photo at the left of a card that has one. */
export const PHOTO_R = 20;
/** How far the photo pushes the text of its card to the right; the text loses twice that in width. */
export const PHOTO_SHIFT = 20;
/** A card with a photo is never lower than the photo with a margin. */
const PHOTO_CARD_H = 2 * PHOTO_R + 16;
/** A long name wraps to at most this many lines. */
const NAME_LINES = 3;

export type LineClass = "name" | "maiden" | "yrs" | "alt";

export interface CardLine {
  t: string;
  c: LineClass;
  h: number;
}

export interface CardSize {
  lines: CardLine[];
  h: number;
}

const FONT_NAME = "14.5px Georgia, serif";
const FONT_MAIDEN = "italic 11.5px Georgia, serif";
const FONT_YRS = "11.5px sans-serif";
const FONT_ALT = "10.5px sans-serif";

const LINE_H: Record<LineClass, number> = { name: 19, maiden: 16, yrs: 16, alt: 14 };

/** The width of `text` set in `font` (a CSS font shorthand), in pixels. */
export type Measure = (text: string, font: string) => number;

/** Without a canvas: the font size times a typical glyph width per character. */
export const byChars: Measure = (text, font) => {
  const size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "12");
  return text.length * size * 0.55;
};

/** The words of a card in the interface language. */
export interface CardText {
  /** the maiden-name line for a maiden name */
  maiden(name: string): string;
  /** the dates line; "" for none */
  dates(p: Person): string;
}

/** A card's lines and height; the same person always gives the same answer. */
export type CardSizer = (p: Person) => CardSize;

export function wrap(measure: Measure, text: string, font: string, max: number, maxLines: number): string[] {
  if (measure(text, font) <= max) return [text];
  const words = text.split(" ");
  let lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (measure(test, font) <= max || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    let tail = lines.slice(maxLines - 1).join(" ");
    while (measure(tail + "…", font) > max && tail.length > 1) tail = tail.slice(0, -1);
    lines = lines.slice(0, maxLines - 1).concat([tail + "…"]);
  }
  return lines;
}

export function clip(measure: Measure, text: string, font: string, max: number): string {
  if (measure(text, font) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(t + "…", font) > max) t = t.slice(0, -1);
  return t.replace(/[\s,;]+$/, "") + "…";
}

/** The sizer for a way of measuring and a language, with a cache of its own. */
export function cardSizer(measure: Measure, text: CardText): CardSizer {
  const build = (p: Person, maiden: string, dates: string, photo: boolean): CardSize => {
    const w = photo ? TEXT_W - 2 * PHOTO_SHIFT : TEXT_W;
    const lines: CardLine[] = [];
    for (const t of wrap(measure, p.name || "?", FONT_NAME, w, NAME_LINES)) lines.push({ t, c: "name", h: LINE_H.name });
    if (p.maiden) lines.push({ t: clip(measure, maiden, FONT_MAIDEN, w), c: "maiden", h: LINE_H.maiden });
    if (dates) lines.push({ t: clip(measure, dates, FONT_YRS, w), c: "yrs", h: LINE_H.yrs });
    if (p.alt && p.alt.length) lines.push({ t: clip(measure, p.alt.join(", "), FONT_ALT, w), c: "alt", h: LINE_H.alt });
    let h = PAD_Y + CHIP_BAND;
    for (const l of lines) h += l.h;
    return { lines, h: Math.max(h, photo ? PHOTO_CARD_H : MIN_CARD_H) };
  };

  const cache = new Map<string, CardSize>();
  return (p) => {
    const maiden = p.maiden ? text.maiden(p.maiden) : "";
    const dates = text.dates(p);
    const photo = !!p.photo;
    const key = [p.name, p.maiden, maiden, dates, (p.alt || []).join("\u0001"), photo ? "photo" : ""].join("\u0000");
    let v = cache.get(key);
    if (!v) {
      v = build(p, maiden, dates, photo);
      if (cache.size > 4000) cache.clear();
      cache.set(key, v);
    }
    return v;
  };
}
