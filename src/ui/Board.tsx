import { useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type Ref } from "react";
import { computeEdges, type EdgeItem } from "../layout/edges.ts";
import type { LayoutResult } from "../layout/layout.ts";
import type { Relation } from "../model/store.ts";
import type { PopSpot } from "./AddPopover.tsx";
import { Axis } from "./Axis.tsx";
import { Popovers } from "./board/Popovers.tsx";
import { useGestures } from "./board/useGestures.ts";
import { useView } from "./board/useView.ts";
import { addSpotAt } from "./board/view.ts";
import { useApp } from "./ctx.ts";
import type { EdgeSpot } from "./EdgeMenu.tsx";
import { EdgesLayer } from "./EdgesLayer.tsx";
import { Handles } from "./Handles.tsx";
import { Nodes } from "./Nodes.tsx";
import { Toast } from "./Toast.tsx";
import { Toolbar } from "./Toolbar.tsx";

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

const PICK_TEXT: Record<Relation, string> = {
  child: "pick.child",
  parent: "pick.parent",
  spouse: "pick.spouse",
  sibling: "pick.sibling",
};

/** The canvas: the tree, the lines, the arrows around the selected card, and what floats over it. */
export function Board({ layout, filter, pick, onPickDone, sheet = 0, ref }: Props) {
  const { s, d, t } = useApp();
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<PopSpot | null>(null);
  const [edgePop, setEdgePop] = useState<EdgeSpot | null>(null);

  const v = useView({ svgRef, boxRef, layout, sheet, fitSeq: s.fitSeq, focus: s.focus, selected: s.selected });
  const { view } = v;

  useImperativeHandle(
    ref,
    () => ({
      fit: v.showAll,
      focusOn: v.focusOn,
      openAdd: (mode?: Relation, anchor?: string) => setPop({ mode: mode ?? null, anchor: anchor ?? null, ...v.freeSpot() }),
    }),
    [v.showAll, v.focusOn, v.freeSpot],
  );

  const edgesRef = useRef<EdgeItem[]>([]);
  const { dragPos, lifted, handlers } = useGestures({
    ...v,
    svgRef,
    boxRef,
    layout,
    edgesRef,
    pick: !!pick,
    selected: s.selected,
    d,
    onPickDone,
    setPop,
    setEdgePop,
  });

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
  edgesRef.current = edges;

  const selBox = s.selected ? pos[s.selected] : null;
  const count = Object.keys(s.tree.people).length;
  const transform = `translate(${view.x},${view.y}) scale(${view.k})`;

  const openPop = (mode: Relation | null, anchor: string | null, e: MouseEvent) =>
    setPop({ mode, anchor, ...addSpotAt(e.clientX, e.clientY, boxRef.current?.getBoundingClientRect()) });

  return (
    <div id="board" ref={boxRef}>
      <svg id="tree" ref={svgRef} className={pick ? "picking" : undefined} xmlns="http://www.w3.org/2000/svg" {...handlers}>
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

        <rect id="bg" x={-40000} y={-40000} width={80000} height={80000} fill="url(#gridBig)" transform={transform} />

        <g id="viewport" transform={transform}>
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
            <Handles b={selBox} others={Object.values(pos)} k={view.k} onOpen={(m, e) => openPop(m, s.selected, e)} />
          )}
        </g>

        {s.tree.timeline && layout.tl && <Axis tl={layout.tl} view={view} size={v.size} />}
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

      <Popovers pop={pop} setPop={setPop} edgePop={edgePop} setEdgePop={setEdgePop} />

      <Toast notice={s.notice} />

      <Toolbar onFit={v.showAll} onZoom={v.applyZoom} />
    </div>
  );
}
