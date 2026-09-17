import type { MouseEvent } from "react";
import type { Box } from "../layout/layout.ts";
import type { Relation } from "../model/store.ts";
import { useApp } from "./ctx.ts";

const OFF = 27; // экранных пикселей от края карточки

interface Props {
  b: Box;
  /** остальные карточки: стрелку супруга ставим туда, где свободнее */
  others: Box[];
  /** масштаб вида: стрелки держим одного размера на экране */
  k: number;
  onOpen: (mode: Relation, e: MouseEvent) => void;
}

const LABEL: Record<Relation, string> = {
  parent: "handle.parent",
  child: "handle.child",
  spouse: "handle.spouse",
  sibling: "handle.sibling",
};
const TITLE: Record<Relation, string> = {
  parent: "handle.addParent",
  child: "handle.addChild",
  spouse: "handle.addSpouse",
  sibling: "handle.addSibling",
};

/** Стрелки добавления вокруг выбранной карточки. */
export function Handles({ b, others, k, onOpen }: Props) {
  const { t } = useApp();
  const off = OFF / k;
  const cy = b.y + b.h / 2;
  const busy = (x: number) =>
    others.some(
      (o) =>
        o !== b &&
        Math.abs(o.y + o.h / 2 - cy) < (o.h + b.h) / 2 &&
        x > o.x - o.w / 2 - off / 2 &&
        x < o.x + o.w / 2 + off / 2,
    );
  const right = b.x + b.w / 2 + off;
  const left = b.x - b.w / 2 - off;
  const sx = busy(right) && !busy(left) ? left : right;
  const ox = sx === left ? right : left; // брат или сестра — с другой стороны от супруга

  const spots: { mode: Relation; x: number; y: number; glyph: string; anchor: "start" | "end" }[] = [
    { mode: "parent", x: b.x, y: b.y - off, glyph: "↑", anchor: "start" },
    { mode: "child", x: b.x, y: b.y + b.h + off, glyph: "↓", anchor: "start" },
    { mode: "spouse", x: sx, y: cy, glyph: "⚭", anchor: sx === left ? "end" : "start" },
    { mode: "sibling", x: ox, y: cy, glyph: "↔", anchor: ox === left ? "end" : "start" },
  ];

  return (
    <g id="handles">
      {spots.map((s) => (
        <g
          key={s.mode}
          className="handle"
          transform={`translate(${s.x},${s.y}) scale(${1 / k})`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(s.mode, e);
          }}
        >
          <title>{t(TITLE[s.mode])}</title>
          <circle r={13} />
          <text y={5}>{s.glyph}</text>
          <text className="hint" x={s.anchor === "end" ? -18 : 18} y={4} style={{ textAnchor: s.anchor }}>
            {t(LABEL[s.mode])}
          </text>
        </g>
      ))}
    </g>
  );
}
