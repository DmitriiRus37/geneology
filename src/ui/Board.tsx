import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { computeEdges, type EdgeItem } from "../layout/edges.ts";
import { bboxOf, type LayoutResult } from "../layout/layout.ts";
import type { Relation } from "../model/store.ts";
import type { PersonSpec } from "../model/tree.ts";
import { AddPopover, type PopSpot } from "./AddPopover.tsx";
import { Axis } from "./Axis.tsx";
import { useNarrow } from "./bits.tsx";
import { useApp } from "./ctx.ts";
import { EdgeMenu, type EdgeSpot } from "./EdgeMenu.tsx";
import { EdgesLayer } from "./EdgesLayer.tsx";
import { Handles } from "./Handles.tsx";
import { Nodes } from "./Nodes.tsx";
import { Toast } from "./Toast.tsx";
import { Toolbar } from "./Toolbar.tsx";
import { IDENTITY, type View } from "./view.ts";

export interface BoardHandle {
  focusOn: (id: string) => void;
  fit: () => void;
  /** open the add window in the middle of the canvas */
  openAdd: (mode?: Relation, anchor?: string) => void;
}

interface Props {
  layout: LayoutResult;
  filter: string;
  pick: { mode: Relation; from: string } | null;
  onPickDone: (id: string | null) => void;
  /** how many pixels of the bottom of the canvas the phone sheet covers */
  sheet?: number;
  ref?: Ref<BoardHandle>;
}

/** A place for the popover: where it was asked for, but wholly inside the canvas. */
const inBoard = (want: number, limit: number): number => Math.max(8, Math.min(want, Math.max(8, limit)));

const PICK_TEXT: Record<Relation, string> = {
  child: "pick.child",
  parent: "pick.parent",
  spouse: "pick.spouse",
  sibling: "pick.sibling",
};

/** How long a finger rests on a card before it picks the card up, in milliseconds. */
const HOLD = 420;
/** A finger that has moved less than this many pixels is still where it landed. */
const SLOP = 6;
/** On a phone: the top of the canvas taken by the bar over it, with the gap below — the
    same strip the sheet's ruler measures in the stylesheet. */
const BAR = 76;
/** Room under a selected card for its "child" arrow. */
const BELOW = 44;

export function Board({ layout, filter, pick, onPickDone, sheet = 0, ref }: Props) {
  const { s, d, t } = useApp();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);
  const [pop, setPop] = useState<PopSpot | null>(null);
  const [edgePop, setEdgePop] = useState<EdgeSpot | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
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

  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; took: boolean } | null>(null);
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);
  /* A finger is not a mouse. Where it lands on a card it is nearly always starting to
     pan, and a moved card is saved — so a finger pans, and only resting on the card
     for a moment picks it up. Where it lands on a line, the menu of that line waits
     for the finger to come up without having moved. */
  const press = useRef<{ id: string; timer: number } | null>(null);
  const pendingEdge = useRef<EdgeSpot | null>(null);
  const lastPt = useRef({ x: 0, y: 0 });
  /** The card a finger has picked up. The ref decides what a release means — a render may
      not have happened yet when the finger lets go — and the state draws the outline. */
  const liftedRef = useRef<string | null>(null);
  const [lifted, setLifted] = useState<string | null>(null);
  const dropLift = () => {
    if (!liftedRef.current) return;
    liftedRef.current = null;
    setLifted(null);
  };
  const selRef = useRef(s.selected);
  selRef.current = s.selected;

  /* ---------- the view ---------- */

  const applyZoom = useCallback((f: number, cx?: number, cy?: number) => {
    userMoved.current = true;
    const el = svgRef.current;
    const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const px = cx === undefined ? r.width / 2 : cx;
    const py = cy === undefined ? r.height / 2 : cy;
    setView((v) => {
      const k2 = Math.max(0.1, Math.min(3, v.k * f));
      return { k: k2, x: px - (px - v.x) * (k2 / v.k), y: py - (py - v.y) * (k2 / v.k) };
    });
  }, []);

  const fitView = useCallback(() => {
    const b = bboxOf(layoutRef.current.pos);
    if (!b) return;
    const el = svgRef.current;
    const r = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const pad = 46;
    if (r.width < 120 || r.height < 120) {
      // the canvas is not laid out yet: getBoundingClientRect gives zeros and the zoom would go negative
      if (fitTries.current++ < 90) {
        requestAnimationFrame(fitView);
        return;
      }
      fitTries.current = 0;
      setView({ k: 1, x: 40 - b.x1, y: 40 - b.y1 });
      return;
    }
    fitTries.current = 0;
    // on a phone the sheet lies over the bottom of the canvas: the tree is fitted into
    // what is left, not into the whole window
    const free = Math.max(160, r.height - coverRef.current);
    let k = Math.min((r.width - pad * 2) / Math.max(b.w, 1), (free - pad * 2) / Math.max(b.h, 1), 1.15);
    // A tree of any size is wider than a phone: fitted to 400 points it is a speck in
    // which no name can be read, and it does not fit even then — the floor below cuts
    // it off anyway. So by itself the canvas opens at a scale a name survives, and the
    // tree runs off the sides; "Show all" is still literally that.
    k = Math.max(narrowRef.current && !fitAll.current ? 0.6 : 0.12, Math.min(k, 1.6));
    setView({ k, x: r.width / 2 - (b.x1 + b.w / 2) * k, y: free / 2 - (b.y1 + b.h / 2) * k });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        userMoved.current = false;
        fitAll.current = true;
        fitView();
      },
      focusOn: (id: string) => {
        const b = layoutRef.current.pos[id];
        const el = svgRef.current;
        if (!b || !el) return;
        const r = el.getBoundingClientRect();
        const free = Math.max(160, r.height - coverRef.current);
        userMoved.current = true;
        setView((v) => ({ ...v, x: r.width / 2 - b.x * v.k, y: free / 2 - (b.y + b.h / 2) * v.k }));
      },
      openAdd: (mode?: Relation, anchor?: string) => {
        const r = boxRef.current?.getBoundingClientRect();
        const w = r ? r.width : 0;
        const h = r ? r.height : 0;
        const free = Math.max(160, h - coverRef.current);
        setPop({
          mode: mode ?? null,
          anchor: anchor ?? null,
          x: Math.max(8, w / 2 - 134),
          y: Math.max(8, free / 2 - 120),
        });
      },
    }),
    [fitView],
  );

  /** Bring a card into view without touching the zoom. */
  const ensureVisible = useCallback((id: string) => {
    const b = layoutRef.current.pos[id];
    const el = svgRef.current;
    if (!b || !el) return;
    const r = el.getBoundingClientRect();
    const v = viewRef.current;
    const m = 80;
    const x1 = v.x + (b.x - b.w / 2) * v.k;
    const x2 = v.x + (b.x + b.w / 2) * v.k;
    const y1 = v.y + b.y * v.k;
    const y2 = v.y + (b.y + b.h) * v.k;
    let dx = 0;
    let dy = 0;
    const free = Math.max(160, r.height - coverRef.current);
    if (x1 < m) dx = m - x1;
    else if (x2 > r.width - m) dx = Math.min(r.width - m - x2, x1 - m);
    if (y1 < m) dy = m - y1;
    else if (y2 > free - m) dy = Math.min(free - m - y2, y1 - m);
    if (dx || dy) {
      userMoved.current = true;
      setView((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    }
  }, []);

  // "Fit" on a command from outside: loading a file, switching mode, "Rearrange"
  useEffect(() => {
    userMoved.current = false;
    fitAll.current = false;
    fitView();
  }, [s.fitSeq, fitView]);

  // a new person or a new link: we keep the zoom and show the card
  const focusSeq = s.focus?.seq ?? 0;
  const focusId = s.focus?.id;
  useEffect(() => {
    if (focusSeq && focusId) ensureVisible(focusId);
  }, [focusSeq, focusId, ensureVisible]);

  /** On a phone: the sheet has settled, and whoever is selected must not be under it or
      under the bar at the top. If they are, they are brought to the middle of what is
      left; if they can be seen, nothing moves. */
  const reveal = useCallback((id: string) => {
    const b = layoutRef.current.pos[id];
    const el = svgRef.current;
    if (!b || !el) return;
    const r = el.getBoundingClientRect();
    const free = r.height - coverRef.current;
    if (free < 200) return; // the sheet is all the way up: the tree is not what is being looked at
    const v = viewRef.current;
    const top = v.y + b.y * v.k;
    const bottom = v.y + (b.y + b.h) * v.k;
    const left = v.x + (b.x - b.w / 2) * v.k;
    const right = v.x + (b.x + b.w / 2) * v.k;
    if (top >= BAR && bottom <= free - BELOW && left >= 8 && right <= r.width - 8) return;
    userMoved.current = true;
    setView((cur) => ({ ...cur, x: r.width / 2 - b.x * cur.k, y: free / 2 - (b.y + b.h / 2) * cur.k }));
  }, []);

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
  }, [fitView]);

  // the wheel and the pinch go through native listeners only: React attaches them passive
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // The browser sends a trackpad pinch as the same event, only with ctrlKey.
      // Everything else — a two-finger swipe or the wheel — moves the canvas.
      if (e.ctrlKey || e.metaKey) {
        const f = Math.max(1 / 1.5, Math.min(1.5, Math.exp(-e.deltaY * 0.01)));
        applyZoom(f, e.clientX - r.left, e.clientY - r.top);
        return;
      }
      // deltaMode: 0 is pixels, 1 is lines, 2 is screens
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? r.height : 1;
      let dx = e.deltaX * k;
      let dy = e.deltaY * k;
      if (e.shiftKey && !e.deltaX) {
        dx = dy; // Shift with an ordinary wheel means sideways
        dy = 0;
      }
      if (!dx && !dy) return;
      userMoved.current = true;
      setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    };
    let pinch: { d: number; k: number } | null = null;
    const dist = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return Math.sqrt(dx * dx + dy * dy) || 1;
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        if (press.current) clearTimeout(press.current.timer);
        press.current = null;
        drag.current = null;
        panning.current = null;
        pinch = { d: dist(e.touches), k: viewRef.current.k };
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      applyZoom((dist(e.touches) / pinch.d) * (pinch.k / viewRef.current.k), cx, cy);
    };
    const onTouchEnd = () => {
      pinch = null;
    };
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
  }, [applyZoom]);

  /* ---------- the pointer ---------- */

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return; // a second finger is the pinch, handled below
    const t = e.target as Element;
    if (t.closest(".handle")) return; // the arrows handle the click themselves
    const finger = e.pointerType !== "mouse";
    pendingEdge.current = null;
    const line = t.closest("[data-edge]") as SVGElement | null;
    if (line && !pick) {
      const item = edgesRef.current[Number(line.dataset.edge)];
      if (item && item.kind === "path" && item.ref) {
        const r = boxRef.current?.getBoundingClientRect();
        const spot: EdgeSpot = {
          x: inBoard(e.clientX - (r?.left ?? 0) + 12, (r?.width ?? 0) - 292),
          y: inBoard(e.clientY - (r?.top ?? 0) - 10, (r?.height ?? 0) - 220),
          ref: item.ref,
        };
        if (!finger) {
          setPop(null);
          setEdgePop(spot);
          return;
        }
        pendingEdge.current = spot;
      }
    }
    moved.current = false;
    lastPt.current = { x: e.clientX, y: e.clientY };
    const nodeEl = t.closest(".node") as SVGGElement | null;
    const id = nodeEl?.dataset.id;
    if (id && layout.pos[id] && !finger) {
      drag.current = { id, sx: e.clientX, sy: e.clientY, ox: layout.pos[id].x, oy: layout.pos[id].y, took: false };
    } else {
      panning.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
      if (id && layout.pos[id]) press.current = { id, timer: window.setTimeout(() => lift(id), HOLD) };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  /** The finger has rested on the card long enough: from now on it carries the card. */
  const lift = (id: string) => {
    const b = layoutRef.current.pos[id];
    if (!press.current || press.current.id !== id || moved.current || !b) return;
    press.current = null;
    panning.current = null;
    drag.current = { id, sx: lastPt.current.x, sy: lastPt.current.y, ox: b.x, oy: b.y, took: false };
    liftedRef.current = id;
    setLifted(id);
    navigator.vibrate?.(12);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!e.isPrimary) return;
    lastPt.current = { x: e.clientX, y: e.clientY };
    const dr = drag.current;
    if (dr) {
      const dx = (e.clientX - dr.sx) / view.k;
      const dy = (e.clientY - dr.sy) / view.k;
      if (!dr.took && Math.abs(dx * view.k) + Math.abs(dy * view.k) < 4) return;
      dr.took = true;
      moved.current = true;
      userMoved.current = true;
      setDragPos({ id: dr.id, x: dr.ox + dx, y: dr.oy + dy });
      return;
    }
    const pn = panning.current;
    if (pn) {
      // a finger never lands perfectly still: a few pixels of wobble are still a tap
      const far = Math.abs(e.clientX - pn.sx) + Math.abs(e.clientY - pn.sy) >= SLOP;
      if (!moved.current && e.pointerType !== "mouse" && !far) return;
      if (press.current) {
        clearTimeout(press.current.timer);
        press.current = null;
      }
      moved.current = true;
      userMoved.current = true;
      setView((v) => ({ ...v, x: pn.ox + (e.clientX - pn.sx), y: pn.oy + (e.clientY - pn.sy) }));
    }
  };

  const endPointer = () => {
    const pr = press.current;
    if (pr) {
      clearTimeout(pr.timer);
      press.current = null;
    }
    const dr = drag.current;
    if (dr) {
      if (!moved.current) {
        if (pick) onPickDone(dr.id);
        else if (liftedRef.current) {
          // held and let go without moving: a slow tap, which selects and never unselects
          if (s.selected !== dr.id) d({ type: "select", id: dr.id });
        } else {
          setPop(null);
          setEdgePop(null);
          d({ type: "select", id: dr.id === s.selected ? null : dr.id });
        }
      } else if (dragPos && dragPos.id === dr.id) {
        d({ type: "pin", id: dr.id, x: dragPos.x, y: dragPos.y });
      }
      drag.current = null;
      setDragPos(null);
    } else if (panning.current && !moved.current) {
      if (pr) {
        // a finger tapped a card: what a click on it does with a mouse
        if (pick) onPickDone(pr.id);
        else {
          setPop(null);
          setEdgePop(null);
          d({ type: "select", id: pr.id === s.selected ? null : pr.id });
        }
      } else if (pick) onPickDone(null);
      else if (pendingEdge.current) {
        setPop(null);
        setEdgePop(pendingEdge.current);
      } else {
        setPop(null);
        setEdgePop(null);
        if (s.selected) d({ type: "select", id: null });
      }
    }
    panning.current = null;
    pendingEdge.current = null;
    dropLift();
  };

  // The system took the finger away — a notification, the home gesture, a call. It
  // did not let go on purpose: nothing is selected, nothing is moved, nothing is saved.
  // A mouse keeps the old way, where a cancel counted as a release.
  const cancelPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse") {
      endPointer();
      return;
    }
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
    drag.current = null;
    panning.current = null;
    pendingEdge.current = null;
    setDragPos(null);
    dropLift();
  };

  /* ---------- the data for rendering ---------- */

  const pos = useMemo(() => {
    if (!dragPos) return layout.pos;
    const b = layout.pos[dragPos.id];
    if (!b) return layout.pos;
    return { ...layout.pos, [dragPos.id]: { ...b, x: dragPos.x, y: dragPos.y } };
  }, [layout.pos, dragPos]);

  const edges = useMemo(
    () => computeEdges(s.tree, pos, layout.level, s.selected),
    [s.tree, pos, layout.level, s.selected],
  );
  const edgesRef = useRef<EdgeItem[]>(edges);
  edgesRef.current = edges;

  const selBox = s.selected ? pos[s.selected] : null;
  const count = Object.keys(s.tree.people).length;

  const openPop = (mode: Relation | null, anchor: string | null, e: MouseEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    const x = r ? e.clientX - r.left : 0;
    const y = r ? e.clientY - r.top : 0;
    const w = r ? r.width : 0;
    const h = r ? r.height : 0;
    setPop({ mode, anchor, x: inBoard(x + 16, w - 284), y: inBoard(y - 12, h - 230) });
  };

  const addFromPop = (spec: PersonSpec, mode: Relation | null) => {
    if (!pop) return;
    d({ type: "add", spec, relation: mode && pop.anchor ? { mode, to: pop.anchor } : undefined });
    setPop(null);
  };

  const connectFromPop = (id: string, mode: Relation | null) => {
    if (!pop) return;
    // with no kinship chosen, a click on the hint simply shows whoever is already there
    if (mode && pop.anchor) d({ type: "connect", mode, from: pop.anchor, to: id });
    else d({ type: "select", id });
    setPop(null);
  };

  return (
    <div id="board" ref={boxRef}>
      <svg
        id="tree"
        ref={svgRef}
        className={pick ? "picking" : undefined}
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
      >
        <defs>
          <pattern id="gridSmall" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M26 0H0V26" fill="none" stroke="#DDE4EB" strokeWidth="1" />
          </pattern>
          <pattern id="gridBig" width="130" height="130" patternUnits="userSpaceOnUse">
            <rect width="130" height="130" fill="url(#gridSmall)" />
            <path d="M130 0H0V130" fill="none" stroke="#CBD6E0" strokeWidth="1" />
          </pattern>
          <marker id="tip" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
            <path d="M0.5 0.8 L7 4 L0.5 7.2 Z" fill="#7A8B9C" />
          </marker>
          <marker id="tipHot" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">
            <path d="M0.5 0.8 L7 4 L0.5 7.2 Z" fill="#C08A2E" />
          </marker>
        </defs>

        <rect
          id="bg"
          x={-40000}
          y={-40000}
          width={80000}
          height={80000}
          fill="url(#gridBig)"
          transform={`translate(${view.x},${view.y}) scale(${view.k})`}
        />

        <g id="viewport" transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {layout.lonePlate && (
            <g id="plate">
              <line
                className="plate-line"
                x1={layout.lonePlate.x}
                y1={layout.lonePlate.y}
                x2={layout.lonePlate.x + layout.lonePlate.w}
                y2={layout.lonePlate.y}
              />
              <text className="plate-label" x={layout.lonePlate.x} y={layout.lonePlate.y - 9}>
                {t("plate.lone")}
              </text>
            </g>
          )}
          <EdgesLayer items={edges} />
          <Nodes
            people={s.tree.people}
            pos={pos}
            selected={s.selected}
            filter={filter}
            tl={layout.tl}
            pickFrom={pick ? pick.from : null}
            lifted={lifted}
          />
          {selBox && !dragPos && !pick && (
            <Handles
              b={selBox}
              others={Object.values(pos)}
              k={view.k}
              onOpen={(m, e) => openPop(m, s.selected, e)}
            />
          )}
        </g>

        {s.tree.timeline && layout.tl && <Axis tl={layout.tl} view={view} size={size} />}
      </svg>

      {count === 0 && (
        <div id="blank">
          <div className="inner">
            <h2>{t("blank.title")}</h2>
            <p>{t("blank.text")}</p>
          </div>
        </div>
      )}

      {pick && (
        <div id="pickbar">
          <span>
            {t(PICK_TEXT[pick.mode])} «{s.tree.people[pick.from]?.name ?? ""}»
          </span>
          <button onClick={() => onPickDone(null)}>{t("pick.cancel")}</button>
        </div>
      )}

      {edgePop && (
        <EdgeMenu
          spot={edgePop}
          people={s.tree.people}
          pairs={s.tree.pairs}
          onCut={(parent, child) => {
            d({ type: "cut", parent, child });
            setEdgePop(null);
          }}
          onUnmarry={(a, b) => {
            d({ type: "unlinkPartner", a, b });
            setEdgePop(null);
          }}
          onUnsibling={(a, b) => {
            d({ type: "unlinkSibling", a, b });
            setEdgePop(null);
          }}
          onClose={() => setEdgePop(null)}
        />
      )}

      {pop && (
        <AddPopover
          spot={pop}
          people={s.tree.people}
          onCreate={addFromPop}
          onExisting={connectFromPop}
          onClose={() => setPop(null)}
        />
      )}

      <Toast notice={s.notice} />

      <Toolbar
        onFit={() => {
          userMoved.current = false;
          fitAll.current = true;
          fitView();
        }}
        onZoom={applyZoom}
      />
    </div>
  );
}
