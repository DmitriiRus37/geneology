/**
 * The gesture automaton wired to the canvas: pointer handlers for React, and the wheel
 * and the pinch through native listeners — React attaches those passive, and both
 * must be able to stop the page from scrolling.
 */
import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type PointerEvent, type RefObject, type SetStateAction } from "react";
import type { EdgeItem } from "../../layout/edges.ts";
import type { LayoutResult } from "../../layout/layout.ts";
import type { Action } from "../../model/store.ts";
import type { PopSpot } from "../AddPopover.tsx";
import type { EdgeSpot } from "../EdgeMenu.tsx";
import { createGestures, type Pt, type Seen } from "./gestures.ts";
import { edgeSpotAt, wheelMove, type View } from "./view.ts";

interface Options {
  svgRef: RefObject<SVGSVGElement | null>;
  boxRef: RefObject<HTMLDivElement | null>;
  layout: LayoutResult;
  layoutRef: MutableRefObject<LayoutResult>;
  edgesRef: MutableRefObject<EdgeItem[]>;
  view: View;
  viewRef: MutableRefObject<View>;
  setView: Dispatch<SetStateAction<View>>;
  userMoved: MutableRefObject<boolean>;
  applyZoom: (f: number, cx?: number, cy?: number) => void;
  pick: boolean;
  selected: string | null;
  d: Dispatch<Action>;
  onPickDone: (id: string | null) => void;
  setPop: Dispatch<SetStateAction<PopSpot | null>>;
  setEdgePop: Dispatch<SetStateAction<EdgeSpot | null>>;
}

export function useGestures(o: Options) {
  const { svgRef, boxRef, layout, edgesRef, view, pick, selected, applyZoom } = o;
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  /** the card a finger has picked up, for its outline */
  const [lifted, setLifted] = useState<string | null>(null);
  /** the host reads these when a gesture ends, so they must be the latest */
  const latest = useRef(o);
  latest.current = o;

  const [g] = useState(() =>
    createGestures({
      later: (fn, ms) => {
        const id = window.setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      box: (id) => latest.current.layoutRef.current.pos[id],
      scale: () => latest.current.viewRef.current.k,
      moved: () => {
        latest.current.userMoved.current = true;
      },
      panTo: (x, y) => latest.current.setView((v) => ({ ...v, x, y })),
      zoom: (f, cx, cy) => latest.current.applyZoom(f, cx, cy),
      dragTo: (id, x, y) => setDragPos({ id, x, y }),
      dragEnd: () => setDragPos(null),
      lift: (id) => {
        setLifted(id);
        navigator.vibrate?.(12);
      },
      unlift: () => setLifted(null),
      select: (id) => latest.current.d({ type: "select", id }),
      pin: (id, x, y) => latest.current.d({ type: "pin", id, x, y }),
      pickDone: (id) => latest.current.onPickDone(id),
      closePops: () => {
        latest.current.setPop(null);
        latest.current.setEdgePop(null);
      },
      openEdge: (spot) => {
        latest.current.setPop(null);
        latest.current.setEdgePop(spot);
      },
    }),
  );

  const seen = (): Seen => ({ view, pick, selected, dragPos });

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const t = e.target as Element;
    let edge: EdgeSpot | null = null;
    const line = t.closest("[data-edge]") as SVGElement | null;
    if (line && !pick) {
      const item = edgesRef.current[Number(line.dataset.edge)];
      if (item && item.kind === "path" && item.ref) {
        edge = edgeSpotAt(e.clientX, e.clientY, boxRef.current?.getBoundingClientRect(), item.ref);
      }
    }
    const id = (t.closest(".node") as SVGGElement | null)?.dataset.id;
    const box = id ? layout.pos[id] : undefined;
    const down = {
      x: e.clientX,
      y: e.clientY,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
      onHandle: !!t.closest(".handle"),
      edge,
      node: id && box ? { id, x: box.x, y: box.y } : null,
    };
    if (g.down(down, seen())) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) =>
    g.move({ x: e.clientX, y: e.clientY, pointerType: e.pointerType, isPrimary: e.isPrimary }, seen());
  const onPointerUp = () => g.up(seen());
  const onPointerCancel = (e: PointerEvent<SVGSVGElement>) => g.cancel(e.pointerType, seen());

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = wheelMove(e, el.getBoundingClientRect());
      if (!w) return;
      if ("zoom" in w) {
        applyZoom(w.zoom, w.cx, w.cy);
        return;
      }
      latest.current.userMoved.current = true;
      latest.current.setView((v) => ({ ...v, x: v.x - w.dx, y: v.y - w.dy }));
    };
    const points = (t: TouchList): Pt[] => Array.from(t, (p) => ({ x: p.clientX, y: p.clientY }));
    const onTouchStart = (e: TouchEvent) => g.touchStart(points(e.touches));
    const onTouchMove = (e: TouchEvent) => {
      const corner = () => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top };
      };
      if (g.touchMove(points(e.touches), corner)) e.preventDefault();
    };
    const onTouchEnd = () => g.touchEnd();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [applyZoom, g, svgRef]);

  return { dragPos, lifted, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel } };
}
