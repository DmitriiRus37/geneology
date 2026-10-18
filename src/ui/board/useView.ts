/**
 * The view of the canvas as React state: fitting the tree, zooming, bringing a card
 * into sight, and following the phone sheet. The arithmetic is in view.ts.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { bboxOf, type LayoutResult } from "../../layout/layout.ts";
import { useNarrow } from "../bits.tsx";
import { addSpot, centredOn, fitted, hidden, IDENTITY, measured, nudge, unmeasured, zoomAt, type View } from "./view.ts";

/** How many frames fitting waits for the canvas to get a size. */
const FIT_TRIES = 90;

interface Options {
  svgRef: RefObject<SVGSVGElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
  layout: LayoutResult;
  /** how many pixels of the bottom of the canvas the phone sheet covers */
  sheet: number;
  fitSeq: number;
  focus: { id: string; seq: number } | null;
  selected: string | null;
}

export function useView({ svgRef, boxRef, layout, sheet, fitSeq, focus, selected }: Options) {
  const [view, setView] = useState<View>(IDENTITY);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  /** The person moved the canvas: a resize no longer fits the tree again. */
  const userMoved = useRef(false);
  const fitTries = useRef(0);
  /** How much of the bottom of the canvas the phone sheet covers. Kept in a ref: fitting
      and centring must not be rebuilt every time the sheet moves. */
  const coverRef = useRef(0);
  coverRef.current = sheet;
  const narrow = useNarrow();
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  /** Did the last fit come from "Show all"? Then a resize repeats that one, not the other. */
  const fitAll = useRef(false);
  const selRef = useRef(selected);
  selRef.current = selected;

  const canvas = useCallback(() => {
    const el = svgRef.current;
    return el ? el.getBoundingClientRect() : { width: 0, height: 0 };
  }, [svgRef]);

  const applyZoom = useCallback(
    (f: number, cx?: number, cy?: number) => {
      userMoved.current = true;
      const r = canvas();
      const px = cx === undefined ? r.width / 2 : cx;
      const py = cy === undefined ? r.height / 2 : cy;
      setView((v) => zoomAt(v, f, px, py));
    },
    [canvas],
  );

  const fitView = useCallback(() => {
    const b = bboxOf(layoutRef.current.pos);
    if (!b) return;
    const r = canvas();
    if (!measured(r)) {
      // the canvas is not laid out yet: getBoundingClientRect gives zeros and the zoom would go negative
      if (fitTries.current++ < FIT_TRIES) {
        requestAnimationFrame(fitView);
        return;
      }
      fitTries.current = 0;
      setView(unmeasured(b));
      return;
    }
    fitTries.current = 0;
    // on a phone the sheet lies over the bottom of the canvas: the tree is fitted into
    // what is left, not into the whole window
    setView(fitted(b, r, coverRef.current, narrowRef.current && !fitAll.current));
  }, [canvas]);

  /** "Show all": the whole tree, however small that makes it. */
  const showAll = useCallback(() => {
    userMoved.current = false;
    fitAll.current = true;
    fitView();
  }, [fitView]);

  const focusOn = useCallback(
    (id: string) => {
      const b = layoutRef.current.pos[id];
      const el = svgRef.current;
      if (!b || !el) return;
      const r = el.getBoundingClientRect();
      const cover = coverRef.current;
      userMoved.current = true;
      setView((v) => centredOn(v, b, r, cover));
    },
    [svgRef],
  );

  /** Bring a card into view without touching the zoom. */
  const ensureVisible = useCallback(
    (id: string) => {
      const b = layoutRef.current.pos[id];
      const el = svgRef.current;
      if (!b || !el) return;
      const { dx, dy } = nudge(viewRef.current, b, el.getBoundingClientRect(), coverRef.current);
      if (dx || dy) {
        userMoved.current = true;
        setView((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
      }
    },
    [svgRef],
  );

  /** Where the add window opens when nothing was clicked: the middle of what the sheet leaves. */
  const freeSpot = useCallback(() => {
    const r = boxRef.current?.getBoundingClientRect();
    return addSpot({ width: r ? r.width : 0, height: r ? r.height : 0 }, coverRef.current);
  }, [boxRef]);

  // "Fit" on a command from outside: loading a file, switching mode, "Rearrange"
  useEffect(() => {
    userMoved.current = false;
    fitAll.current = false;
    fitView();
  }, [fitSeq, fitView]);

  // a new person or a new link: we keep the zoom and show the card
  const focusSeq = focus?.seq ?? 0;
  const focusId = focus?.id;
  useEffect(() => {
    if (focusSeq && focusId) ensureVisible(focusId);
  }, [focusSeq, focusId, ensureVisible]);

  /** On a phone: the sheet has settled, and whoever is selected must not be under it or
      under the bar at the top. If they are, they are brought to the middle of what is
      left; if they can be seen, nothing moves. */
  const reveal = useCallback(
    (id: string) => {
      const b = layoutRef.current.pos[id];
      const el = svgRef.current;
      if (!b || !el) return;
      const r = el.getBoundingClientRect();
      const cover = coverRef.current;
      if (!hidden(viewRef.current, b, r, cover)) return;
      userMoved.current = true;
      setView((cur) => centredOn(cur, b, r, cover));
    },
    [svgRef],
  );

  // The phone sheet has come to rest at another height. The tree does not follow it —
  // what was on screen stays put — with two exceptions: a selected person is kept in
  // sight, and the very first fit, made before the sheet was measured, is made again.
  const lastCover = useRef(sheet);
  useEffect(() => {
    const was = lastCover.current;
    lastCover.current = sheet;
    if (was === sheet) return;
    if (selRef.current) reveal(selRef.current);
    else if (was === 0 && !userMoved.current) fitView();
  }, [sheet, reveal, fitView]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      if (!userMoved.current) fitView();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitView, boxRef]);

  return { view, setView, size, viewRef, layoutRef, userMoved, applyZoom, showAll, focusOn, freeSpot };
}
