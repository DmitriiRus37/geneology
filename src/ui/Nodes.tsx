import { memo } from "react";
import type { Box } from "../layout/layout.ts";
import { CHIP_BAND } from "../layout/measure.ts";
import type { Timeline } from "../layout/timeline.ts";
import { colorOf, markOf, matches, tintOf } from "../model/names.ts";
import type { Person } from "../model/types.ts";

interface NodeProps {
  p: Person;
  b: Box;
  selected: boolean;
  dim: boolean;
  guess: boolean;
  src: boolean;
}

const Node = memo(function Node({ p, b, selected, dim, guess, src }: NodeProps) {
  const x = b.x - b.w / 2;
  let ty = b.y + 15 + CHIP_BAND; // ниже полоски с жетоном
  const cls =
    "node" + (selected ? " sel" : "") + (dim ? " dim" : "") + (guess ? " est" : "") + (src ? " src" : "");
  return (
    <g className={cls} data-id={p.id}>
      <rect className="box" x={x} y={b.y} width={b.w} height={b.h} rx={6} />
      <circle className="chip" cx={x + 15} cy={b.y + 12} r={9} fill={tintOf(p.sex)} />
      <text className="mark" x={x + 15} y={b.y + 16} textAnchor="middle" fill={colorOf(p.sex)}>
        {markOf(p.sex)}
      </text>
      {b.lines.map((ln, i) => {
        ty += ln.h;
        return (
          <text key={i} className={ln.c} x={b.x} y={ty - 4} textAnchor="middle">
            {ln.t}
          </text>
        );
      })}
    </g>
  );
});

interface NodesProps {
  people: Record<string, Person>;
  pos: Record<string, Box>;
  selected: string | null;
  filter: string;
  tl: Timeline | null;
  pickFrom: string | null;
}

export const Nodes = memo(function Nodes({ people, pos, selected, filter, tl, pickFrom }: NodesProps) {
  return (
    <g id="nodes">
      {Object.keys(people).map((id) => {
        const b = pos[id];
        if (!b) return null;
        const p = people[id];
        return (
          <Node
            key={id}
            p={p}
            b={b}
            selected={selected === id}
            dim={!!filter && !matches(p, filter)}
            guess={!!tl && !!tl.est[id]}
            src={pickFrom === id}
          />
        );
      })}
    </g>
  );
});
