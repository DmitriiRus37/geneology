/**
 * The view of the canvas — its scale and offset — and the arithmetic of moving it.
 * Plain functions: the size of the canvas, the cards and how much of the canvas the
 * phone sheet covers all come in as arguments, so Node can test them.
 */
import type { BBox, Box } from "../../layout/layout.ts";
import type { EdgeRef } from "../../layout/edges.ts";
import { BAR } from "../screen.ts";

export interface View {
  k: number;
  x: number;
  y: number;
}

export const IDENTITY: View = { k: 1, x: 0, y: 0 };

/** The canvas, as `getBoundingClientRect` gives it. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The scale stays within these. */
const MIN_K = 0.1;
const MAX_K = 3;
/** Room around a fitted tree. */
const PAD = 46;
/** A fitted tree is drawn no larger than this… */
const FIT_MAX = 1.15;
/** …nor, once the floor is applied, than this. */
const FIT_CAP = 1.6;
/** On a phone the canvas opens no smaller than this: a name must stay readable. */
const PHONE_FLOOR = 0.6;
/** "Show all", and any screen but a phone, go down to this. */
const FLOOR = 0.12;
/** However far up the sheet is, the tree is given at least this much height. */
const MIN_FREE = 160;
/** A canvas smaller than this has not been laid out yet. */
const MIN_CANVAS = 120;
/** Where a tree lands when the canvas never got a size. */
const UNMEASURED_AT = 40;
/** A card brought into view stands at least this far from the edges. */
const MARGIN = 80;
/** Room under a selected card for its "child" arrow. */
const BELOW = 44;
/** With less than this left above the sheet, the tree is not what is being looked at. */
const REVEAL_MIN = 200;

/** The height of the canvas left above the phone sheet. */
const freeOf = (r: Pick<Rect, "height">, cover: number): number => Math.max(MIN_FREE, r.height - cover);

/** Zoom by `f` about the point (px, py) of the canvas. */
export function zoomAt(v: View, f: number, px: number, py: number): View {
  const k2 = Math.max(MIN_K, Math.min(MAX_K, v.k * f));
  return { k: k2, x: px - (px - v.x) * (k2 / v.k), y: py - (py - v.y) * (k2 / v.k) };
}

/** Whether the canvas has a size yet: before layout `getBoundingClientRect` gives zeros. */
export const measured = (r: Pick<Rect, "width" | "height">): boolean => !(r.width < MIN_CANVAS || r.height < MIN_CANVAS);

/** Where a tree goes when the canvas never got a size to fit it into. */
export const unmeasured = (b: BBox): View => ({ k: 1, x: UNMEASURED_AT - b.x1, y: UNMEASURED_AT - b.y1 });

/**
 * The whole tree in the canvas, or in what the phone sheet leaves of it. A tree of any
 * size is wider than a phone: fitted to 400 points it is a speck in which no name can
 * be read, and it does not fit even then. So `phoneFloor` opens it at a scale a name
 * survives and lets the tree run off the sides; "Show all" goes without it.
 */
export function fitted(b: BBox, r: Pick<Rect, "width" | "height">, cover: number, phoneFloor: boolean): View {
  const free = freeOf(r, cover);
  let k = Math.min((r.width - PAD * 2) / Math.max(b.w, 1), (free - PAD * 2) / Math.max(b.h, 1), FIT_MAX);
  k = Math.max(phoneFloor ? PHONE_FLOOR : FLOOR, Math.min(k, FIT_CAP));
  return { k, x: r.width / 2 - (b.x1 + b.w / 2) * k, y: free / 2 - (b.y1 + b.h / 2) * k };
}

/** The card in the middle of what is left above the sheet, at the same scale. */
export const centredOn = (v: View, b: Box, r: Pick<Rect, "width" | "height">, cover: number): View => {
  const free = freeOf(r, cover);
  return { ...v, x: r.width / 2 - b.x * v.k, y: free / 2 - (b.y + b.h / 2) * v.k };
};

/** How far to move the view so the card stands at least MARGIN inside the canvas and above the sheet. */
export function nudge(v: View, b: Box, r: Pick<Rect, "width" | "height">, cover: number): { dx: number; dy: number } {
  const x1 = v.x + (b.x - b.w / 2) * v.k;
  const x2 = v.x + (b.x + b.w / 2) * v.k;
  const y1 = v.y + b.y * v.k;
  const y2 = v.y + (b.y + b.h) * v.k;
  let dx = 0;
  let dy = 0;
  const free = freeOf(r, cover);
  if (x1 < MARGIN) dx = MARGIN - x1;
  else if (x2 > r.width - MARGIN) dx = Math.min(r.width - MARGIN - x2, x1 - MARGIN);
  if (y1 < MARGIN) dy = MARGIN - y1;
  else if (y2 > free - MARGIN) dy = Math.min(free - MARGIN - y2, y1 - MARGIN);
  return { dx, dy };
}

/**
 * On a phone, once the sheet has settled: whether the card is hidden under it or
 * under the bar at the top, and so must be brought to the middle of what is left.
 * Never while the sheet is all the way up.
 */
export function hidden(v: View, b: Box, r: Pick<Rect, "width" | "height">, cover: number): boolean {
  const free = r.height - cover;
  if (free < REVEAL_MIN) return false;
  const top = v.y + b.y * v.k;
  const bottom = v.y + (b.y + b.h) * v.k;
  const left = v.x + (b.x - b.w / 2) * v.k;
  const right = v.x + (b.x + b.w / 2) * v.k;
  return !(top >= BAR && bottom <= free - BELOW && left >= 8 && right <= r.width - 8);
}

/** A place for a popover: where it was asked for, but wholly inside the canvas. */
export const inBoard = (want: number, limit: number): number => Math.max(8, Math.min(want, Math.max(8, limit)));

/** Where the add window opens on its own: the middle of what the sheet leaves. */
export const addSpot = (r: Pick<Rect, "width" | "height">, cover: number): { x: number; y: number } => ({
  x: Math.max(8, r.width / 2 - 134),
  y: Math.max(8, freeOf(r, cover) / 2 - 120),
});

/** Where the add window opens beside an arrow that was clicked. */
export function addSpotAt(cx: number, cy: number, r: Rect | undefined): { x: number; y: number } {
  const x = r ? cx - r.left : 0;
  const y = r ? cy - r.top : 0;
  const w = r ? r.width : 0;
  const h = r ? r.height : 0;
  return { x: inBoard(x + 16, w - 284), y: inBoard(y - 12, h - 230) };
}

/** Where the menu of a line opens beside the point it was pressed at. */
export const edgeSpotAt = (cx: number, cy: number, r: Rect | undefined, ref: EdgeRef) => ({
  x: inBoard(cx - (r?.left ?? 0) + 12, (r?.width ?? 0) - 292),
  y: inBoard(cy - (r?.top ?? 0) - 10, (r?.height ?? 0) - 220),
  ref,
});

export type WheelMove = { zoom: number; cx: number; cy: number } | { dx: number; dy: number } | null;

/**
 * What a wheel event does. The browser sends a trackpad pinch as the same event, only
 * with ctrlKey: that zooms. Everything else — a two-finger swipe or the wheel — moves
 * the canvas; Shift with an ordinary wheel means sideways.
 */
export function wheelMove(
  e: Pick<WheelEvent, "ctrlKey" | "metaKey" | "deltaX" | "deltaY" | "deltaMode" | "shiftKey" | "clientX" | "clientY">,
  r: Rect,
): WheelMove {
  if (e.ctrlKey || e.metaKey) {
    const f = Math.max(1 / 1.5, Math.min(1.5, Math.exp(-e.deltaY * 0.01)));
    return { zoom: f, cx: e.clientX - r.left, cy: e.clientY - r.top };
  }
  // deltaMode: 0 is pixels, 1 is lines, 2 is screens
  const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
  let dx = e.deltaX * k;
  let dy = e.deltaY * k;
  if (e.shiftKey && !e.deltaX) {
    dx = dy;
    dy = 0;
  }
  if (!dx && !dy) return null;
  return { dx, dy };
}
