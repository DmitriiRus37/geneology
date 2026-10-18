import { memo } from "react";
import type { Box } from "../layout/layout.ts";
import { photoUrl } from "../io/api.ts";
import { CHIP_BAND, PHOTO_R, PHOTO_SHIFT } from "../layout/measure.ts";
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
  /** picked up by a finger that rested on it, and about to be carried */
  lift: boolean;
}

const Node = memo(function Node({ p, b, selected, dim, guess, src, lift }: NodeProps) {
  const x = b.x - b.w / 2;
  let ty = b.y + 15 + CHIP_BAND; // below the band with the chip
  const photo = p.photo || "";
  const tx = photo ? b.x + PHOTO_SHIFT : b.x;
  const py = b.y + b.h / 2;
  const cls =
    "node" +
    (selected ? " sel" : "") +
    (dim ? " dim" : "") +
    (guess ? " est" : "") +
    (src ? " src" : "") +
    (lift ? " lift" : "");
  return (
    <g className={cls} data-id={p.id}>
      <rect className="box" x={x} y={b.y} width={b.w} height={b.h} rx={6} />
      {photo && (
        <>
          <circle className="photo" cx={x + 8 + PHOTO_R} cy={py} r={PHOTO_R} />
          <image
            href={photoUrl(photo)}
            x={x + 8}
            y={py - PHOTO_R}
            width={2 * PHOTO_R}
            height={2 * PHOTO_R}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#avatar)"
          />
        </>
      )}
      <circle className="chip" cx={x + 15} cy={b.y + 12} r={9} fill={tintOf(p.sex)} />
      <text className="mark" x={x + 15} y={b.y + 16} textAnchor="middle" fill={colorOf(p.sex)}>
        {markOf(p.sex)}
      </text>
      {b.lines.map((ln, i) => {
        ty += ln.h;
        return (
          <text key={i} className={ln.c} x={tx} y={ty - 4} textAnchor="middle">
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
  lifted?: string | null;
}

export const Nodes = memo(function Nodes({ people, pos, selected, filter, tl, pickFrom, lifted = null }: NodesProps) {
  return (
    <g id="nodes">
      <defs>
        {/* one round frame for every photo, in the box of whichever image uses it */}
        <clipPath id="avatar" clipPathUnits="objectBoundingBox">
          <circle cx={0.5} cy={0.5} r={0.5} />
        </clipPath>
      </defs>
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
            lift={lifted === id}
          />
        );
      })}
    </g>
  );
});
