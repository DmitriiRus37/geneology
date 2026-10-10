/**
 * What a pointer does on the canvas. Plain TypeScript: the events come in already read
 * off the DOM, the timer comes from outside, and everything the gesture means goes
 * out through `GestureHost` — so Node can play a finger against it.
 *
 * A finger is not a mouse. Where it lands on a card it is nearly always starting to
 * pan, and a moved card is saved — so a finger pans, and only resting on the card for
 * a moment picks it up. Where it lands on a line, the menu of that line waits for the
 * finger to come up without having moved. A mouse drags a card at once and opens a
 * line's menu at once.
 */
import type { EdgeSpot } from "../EdgeMenu.tsx";
import type { View } from "./view.ts";

/** How long a finger rests on a card before it picks the card up, in milliseconds. */
export const HOLD = 420;
/** A finger that has moved less than this many pixels is still where it landed. */
export const SLOP = 6;
/** A dragged card only starts to move once the pointer has gone this far. */
const DRAG_FROM = 4;

export interface Pt {
  x: number;
  y: number;
}

export interface PointerDown extends Pt {
  pointerType: string;
  isPrimary: boolean;
  /** on one of the arrows around the selected card: they handle the click themselves */
  onHandle: boolean;
  /** on a line that can be cut (and nobody is being picked): where its menu would open */
  edge: EdgeSpot | null;
  /** on a card, and where the layout put it */
  node: { id: string; x: number; y: number } | null;
}

export interface PointerMove extends Pt {
  pointerType: string;
  isPrimary: boolean;
}

/** The canvas as it was drawn when the event came. */
export interface Seen {
  view: View;
  /** a relative is being picked: a tap on a card answers that */
  pick: boolean;
  selected: string | null;
  /** where the card being dragged is drawn */
  dragPos: { id: string; x: number; y: number } | null;
}

export interface GestureHost {
  /** Run `fn` in `ms` milliseconds; returns what cancels it. */
  later(fn: () => void, ms: number): () => void;
  /** where the layout puts a card now */
  box(id: string): Pt | undefined;
  /** the scale now, for the pinch */
  scale(): number;
  /** the person moved the canvas themselves: no automatic fitting any more */
  moved(): void;
  panTo(x: number, y: number): void;
  zoom(f: number, cx: number, cy: number): void;
  dragTo(id: string, x: number, y: number): void;
  dragEnd(): void;
  /** a finger has picked a card up: outline it */
  lift(id: string): void;
  unlift(): void;
  select(id: string | null): void;
  pin(id: string, x: number, y: number): void;
  pickDone(id: string | null): void;
  closePops(): void;
  openEdge(spot: EdgeSpot): void;
}

export interface Gestures {
  /** Returns whether the pointer is to be captured. */
  down(e: PointerDown, seen: Seen): boolean;
  move(e: PointerMove, seen: Seen): void;
  up(seen: Seen): void;
  /** The system took the pointer away. */
  cancel(pointerType: string, seen: Seen): void;
  touchStart(touches: Pt[]): void;
  /** Returns whether the pinch took the move, so the page must not scroll. `origin` is the canvas's corner on the screen. */
  touchMove(touches: Pt[], origin: () => Pt): boolean;
  touchEnd(): void;
}

const dist = (t: Pt[]): number => {
  const dx = t[0].x - t[1].x;
  const dy = t[0].y - t[1].y;
  return Math.sqrt(dx * dx + dy * dy) || 1;
};

export function createGestures(host: GestureHost): Gestures {
  let drag: { id: string; sx: number; sy: number; ox: number; oy: number; took: boolean } | null = null;
  let panning: { sx: number; sy: number; ox: number; oy: number } | null = null;
  let moved = false;
  /** a finger resting on a card, and what stops its timer */
  let press: { id: string; cancel: () => void } | null = null;
  let pendingEdge: EdgeSpot | null = null;
  let last: Pt = { x: 0, y: 0 };
  /** The card a finger has picked up: this decides what a release means, the host draws the outline. */
  let lifted: string | null = null;
  let pinch: { d: number; k: number } | null = null;

  const dropLift = () => {
    if (!lifted) return;
    lifted = null;
    host.unlift();
  };

  /** The finger has rested on the card long enough: from now on it carries the card. */
  const lift = (id: string) => {
    const b = host.box(id);
    if (!press || press.id !== id || moved || !b) return;
    press = null;
    panning = null;
    drag = { id, sx: last.x, sy: last.y, ox: b.x, oy: b.y, took: false };
    lifted = id;
    host.lift(id);
  };

  const up = (seen: Seen) => {
    const pr = press;
    if (pr) {
      pr.cancel();
      press = null;
    }
    const dr = drag;
    if (dr) {
      if (!moved) {
        if (seen.pick) host.pickDone(dr.id);
        else if (lifted) {
          // held and let go without moving: a slow tap, which selects and never unselects
          if (seen.selected !== dr.id) host.select(dr.id);
        } else {
          host.closePops();
          host.select(dr.id === seen.selected ? null : dr.id);
        }
      } else if (seen.dragPos && seen.dragPos.id === dr.id) {
        host.pin(dr.id, seen.dragPos.x, seen.dragPos.y);
      }
      drag = null;
      host.dragEnd();
    } else if (panning && !moved) {
      if (pr) {
        // a finger tapped a card: what a click on it does with a mouse
        if (seen.pick) host.pickDone(pr.id);
        else {
          host.closePops();
          host.select(pr.id === seen.selected ? null : pr.id);
        }
      } else if (seen.pick) host.pickDone(null);
      else if (pendingEdge) host.openEdge(pendingEdge);
      else {
        host.closePops();
        if (seen.selected) host.select(null);
      }
    }
    panning = null;
    pendingEdge = null;
    dropLift();
  };

  return {
    down(e, seen) {
      if (!e.isPrimary) return false; // a second finger is the pinch, handled by the touch events
      if (e.onHandle) return false;
      const finger = e.pointerType !== "mouse";
      pendingEdge = null;
      if (e.edge) {
        if (!finger) {
          host.openEdge(e.edge);
          return false;
        }
        pendingEdge = e.edge;
      }
      moved = false;
      last = { x: e.x, y: e.y };
      const node = e.node;
      if (node && !finger) {
        drag = { id: node.id, sx: e.x, sy: e.y, ox: node.x, oy: node.y, took: false };
      } else {
        panning = { sx: e.x, sy: e.y, ox: seen.view.x, oy: seen.view.y };
        if (node) press = { id: node.id, cancel: host.later(() => lift(node.id), HOLD) };
      }
      return true;
    },

    move(e, seen) {
      if (!e.isPrimary) return;
      last = { x: e.x, y: e.y };
      const k = seen.view.k;
      const dr = drag;
      if (dr) {
        const dx = (e.x - dr.sx) / k;
        const dy = (e.y - dr.sy) / k;
        if (!dr.took && Math.abs(dx * k) + Math.abs(dy * k) < DRAG_FROM) return;
        dr.took = true;
        moved = true;
        host.moved();
        host.dragTo(dr.id, dr.ox + dx, dr.oy + dy);
        return;
      }
      const pn = panning;
      if (pn) {
        // a finger never lands perfectly still: a few pixels of wobble are still a tap
        const far = Math.abs(e.x - pn.sx) + Math.abs(e.y - pn.sy) >= SLOP;
        if (!moved && e.pointerType !== "mouse" && !far) return;
        if (press) {
          press.cancel();
          press = null;
        }
        moved = true;
        host.moved();
        host.panTo(pn.ox + (e.x - pn.sx), pn.oy + (e.y - pn.sy));
      }
    },

    up,

    // The system took the finger away — a notification, the home gesture, a call. It
    // did not let go on purpose: nothing is selected, nothing is moved, nothing is saved.
    // A mouse keeps the old way, where a cancel counted as a release.
    cancel(pointerType, seen) {
      if (pointerType === "mouse") {
        up(seen);
        return;
      }
      if (press) press.cancel();
      press = null;
      drag = null;
      panning = null;
      pendingEdge = null;
      host.dragEnd();
      dropLift();
    },

    // A second finger is the pinch. A hold is called off and a pan stops; a card being
    // carried is let go the way a system cancel lets it go: back to its place, unsaved.
    touchStart(touches) {
      if (touches.length !== 2) return;
      if (press) press.cancel();
      press = null;
      panning = null;
      if (drag) {
        drag = null;
        host.dragEnd();
      }
      dropLift();
      pinch = { d: dist(touches), k: host.scale() };
    },

    touchMove(touches, origin) {
      if (!pinch || touches.length !== 2) return false;
      const o = origin();
      const cx = (touches[0].x + touches[1].x) / 2 - o.x;
      const cy = (touches[0].y + touches[1].y) / 2 - o.y;
      host.zoom((dist(touches) / pinch.d) * (pinch.k / host.scale()), cx, cy);
      return true;
    },

    touchEnd() {
      pinch = null;
    },
  };
}
