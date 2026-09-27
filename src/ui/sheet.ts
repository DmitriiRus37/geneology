import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/**
 * The side panel as a sheet, on a phone.
 *
 * It stands at one of three heights: the head alone, a little over half the screen,
 * and all of it but a strip at the top that belongs to the bar over the canvas. The
 * grab bar is dragged between them; on release the sheet goes to the nearest one, or
 * on to the next one if it was flicked. A tap on the bar opens and closes it.
 */
export type Snap = "peek" | "half" | "full";
const ORDER: Snap[] = ["peek", "half", "full"];

/** A release faster than this, in pixels per millisecond, is a flick. */
const FLICK = 0.45;
/** Less than this between down and up is a tap on the bar, not a drag. */
const TAP = 8;
/** A finger that stood still this long before letting go was not flicking. */
const STILL = 90;

export interface Sheet {
  rail: RefObject<HTMLElement | null>;
  head: RefObject<HTMLDivElement | null>;
  /** a hidden ruler as tall as the strip the sheet must leave at the top of the screen */
  ruler: RefObject<HTMLDivElement | null>;
  snap: Snap;
  /** Go to a stop. Moves made by the app, not by a finger, may later be taken back by it. */
  go: (to: Snap, byApp?: boolean) => void;
  /** Was the current stop the app's doing? */
  byApp: () => boolean;
  /** the sheet's height in pixels on a phone; zero elsewhere and before it is measured */
  height: number;
  dragging: boolean;
  /** down to the head: nothing below it is shown, scrolled to or tabbed into */
  shut: boolean;
  bar: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * @param narrow the phone layout is on
 * @param onCover told how much of the canvas the sheet covers once it has settled — not
 *   while a finger drags it, or the tree would be re-measured every frame of the drag
 */
export function useSheet(narrow: boolean, onCover: (px: number) => void): Sheet {
  const rail = useRef<HTMLElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const ruler = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>("peek");
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const byAppRef = useRef(false);
  const peekRef = useRef(0);
  const snapRef = useRef(snap);
  snapRef.current = snap;
  const drag = useRef<{
    y0: number;
    h0: number;
    at: Record<Snap, number>;
    y: number;
    t: number;
    v: number;
  } | null>(null);

  /** The three heights in pixels. Measured, not guessed: the head follows the font the
      phone is set to, the bottom follows the home indicator, the top the bar over the canvas. */
  const stops = useCallback((): Record<Snap, number> => {
    const r = rail.current;
    // the rail's own padding and border are inside its height: the head alone must fit
    // into what is left, or the sheet at rest scrolls by a pixel
    let chrome = 0;
    if (r) {
      const cs = getComputedStyle(r);
      for (const v of [cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth]) chrome += parseFloat(v) || 0;
    }
    const peek = (head.current?.offsetHeight ?? 64) + chrome;
    const screen = r?.parentElement?.clientHeight || window.innerHeight;
    const full = Math.max(peek + 160, screen - (ruler.current?.offsetHeight ?? 76));
    const half = Math.min(full - 40, Math.max(peek + 120, Math.round(screen * 0.56)));
    peekRef.current = peek;
    return { peek, half, full };
  }, []);

  // The height of the chosen stop, set before the browser paints: the first frame must
  // not show the sheet at the height of everything in it. Again after the phone turns.
  useLayoutEffect(() => {
    if (!narrow) {
      setHeight(0);
      return;
    }
    const apply = () => {
      if (!drag.current) setHeight(stops()[snapRef.current]);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [narrow, snap, stops]);

  useLayoutEffect(() => {
    if (!dragging) onCover(narrow ? height : 0);
  }, [narrow, height, dragging, onCover]);

  const go = useCallback((to: Snap, byApp = true) => {
    byAppRef.current = byApp;
    setSnap(to);
  }, []);
  const byApp = useCallback(() => byAppRef.current, []);

  const settle = (to: Snap, at: Record<Snap, number>) => {
    byAppRef.current = false;
    setSnap(to);
    setHeight(at[to]);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!narrow || !e.isPrimary || drag.current || !rail.current) return;
    const h0 = rail.current.offsetHeight;
    drag.current = { y0: e.clientY, h0, at: stops(), y: e.clientY, t: e.timeStamp, v: 0 };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || !e.isPrimary) return;
    const dt = e.timeStamp - g.t;
    // upwards is positive; the last moves count most
    if (dt > 0) g.v = 0.7 * ((g.y - e.clientY) / dt) + 0.3 * g.v;
    g.y = e.clientY;
    g.t = e.timeStamp;
    setHeight(Math.max(g.at.peek, Math.min(g.at.full, g.h0 + (g.y0 - e.clientY))));
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || !e.isPrimary) return;
    drag.current = null;
    setDragging(false);
    if (Math.abs(e.clientY - g.y0) < TAP) {
      settle(snap === "peek" ? "half" : "peek", g.at);
      return;
    }
    const h = Math.max(g.at.peek, Math.min(g.at.full, g.h0 + (g.y0 - e.clientY)));
    const v = e.timeStamp - g.t > STILL ? 0 : g.v;
    let to: Snap;
    if (v >= FLICK) to = ORDER.find((k) => g.at[k] > h + 1) ?? "full";
    else if (v <= -FLICK) to = [...ORDER].reverse().find((k) => g.at[k] < h - 1) ?? "peek";
    else to = ORDER.reduce((best, k) => (Math.abs(g.at[k] - h) < Math.abs(g.at[best] - h) ? k : best), "peek");
    settle(to, g.at);
  };

  // The system took the finger away — a notification, the home gesture. That is not a
  // release: the sheet goes back to where it stood.
  const onPointerCancel = (e: PointerEvent<HTMLElement>) => {
    const g = drag.current;
    if (!g || !e.isPrimary) return;
    drag.current = null;
    setDragging(false);
    setHeight(g.at[snapRef.current]);
  };

  // a keyboard has no finger to drag with: it gets the two ends
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    byAppRef.current = false;
    setSnap((k) => (k === "peek" ? "half" : "peek"));
  };

  const shut = narrow && (height === 0 || height <= peekRef.current + 4);

  return {
    rail,
    head,
    ruler,
    snap,
    go,
    byApp,
    height,
    dragging,
    shut,
    bar: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown },
  };
}
