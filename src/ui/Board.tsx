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

export function Board({ layout, filter, pick, onPickDone, ref }: Props) {
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

  const drag = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; took: boolean } | null>(null);
  const panning = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);

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
    let k = Math.min((r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1), 1.15);
    k = Math.max(0.12, Math.min(k, 1.6));
    setView({ k, x: r.width / 2 - (b.x1 + b.w / 2) * k, y: r.height / 2 - (b.y1 + b.h / 2) * k });
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      fit: () => {
        userMoved.current = false;
        fitView();
      },
      focusOn: (id: string) => {
        const b = layoutRef.current.pos[id];
        const el = svgRef.current;
        if (!b || !el) return;
        const r = el.getBoundingClientRect();
        userMoved.current = true;
        setView((v) => ({ ...v, x: r.width / 2 - b.x * v.k, y: r.height / 2 - (b.y + b.h / 2) * v.k }));
      },
      openAdd: (mode?: Relation, anchor?: string) => {
        const r = boxRef.current?.getBoundingClientRect();
        const w = r ? r.width : 0;
        const h = r ? r.height : 0;
        setPop({
          mode: mode ?? null,
          anchor: anchor ?? null,
          x: Math.max(8, w / 2 - 134),
          y: Math.max(8, h / 2 - 120),
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
    if (x1 < m) dx = m - x1;
    else if (x2 > r.width - m) dx = Math.min(r.width - m - x2, x1 - m);
    if (y1 < m) dy = m - y1;
    else if (y2 > r.height - m) dy = Math.min(r.height - m - y2, y1 - m);
    if (dx || dy) {
      userMoved.current = true;
      setView((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
    }
  }, []);

  // "Fit" on a command from outside: loading a file, switching mode, "Rearrange"
  useEffect(() => {
    userMoved.current = false;
    fitView();
  }, [s.fitSeq, fitView]);

  // a new person or a new link: we keep the zoom and show the card
  const focusSeq = s.focus?.seq ?? 0;
  const focusId = s.focus?.id;
  useEffect(() => {
    if (focusSeq && focusId) ensureVisible(focusId);
  }, [focusSeq, focusId, ensureVisible]);

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
    const t = e.target as Element;
    if (t.closest(".handle")) return; // the arrows handle the click themselves
    const line = t.closest("[data-edge]") as SVGElement | null;
    if (line && !pick) {
      const item = edgesRef.current[Number(line.dataset.edge)];
      if (item && item.kind === "path" && item.ref) {
        const r = boxRef.current?.getBoundingClientRect();
        setPop(null);
        setEdgePop({
          x: inBoard(e.clientX - (r?.left ?? 0) + 12, (r?.width ?? 0) - 292),
          y: inBoard(e.clientY - (r?.top ?? 0) - 10, (r?.height ?? 0) - 220),
          ref: item.ref,
        });
        return;
      }
    }
    moved.current = false;
    const nodeEl = t.closest(".node") as SVGGElement | null;
    const id = nodeEl?.dataset.id;
    if (id && layout.pos[id]) {
      drag.current = { id, sx: e.clientX, sy: e.clientY, ox: layout.pos[id].x, oy: layout.pos[id].y, took: false };
    } else {
      panning.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
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
      moved.current = true;
      userMoved.current = true;
      setView((v) => ({ ...v, x: pn.ox + (e.clientX - pn.sx), y: pn.oy + (e.clientY - pn.sy) }));
    }
  };

  const endPointer = () => {
    const dr = drag.current;
    if (dr) {
      if (!moved.current) {
        if (pick) onPickDone(dr.id);
        else {
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
      if (pick) onPickDone(null);
      else {
        setPop(null);
        setEdgePop(null);
        if (s.selected) d({ type: "select", id: null });
      }
    }
    panning.current = null;
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
        onPointerCancel={endPointer}
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
          fitView();
        }}
        onZoom={applyZoom}
      />
    </div>
  );
}
