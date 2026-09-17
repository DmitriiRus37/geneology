import type { Timeline } from "../layout/timeline.ts";
import type { View } from "./view.ts";

const STEPS = [5, 10, 20, 25, 50, 100, 200];

/** Липкая шкала лет слева — рисуется в экранных координатах. */
export function Axis({ tl, view, size }: { tl: Timeline; view: View; size: { w: number; h: number } }) {
  if (size.w < 40) return null;

  let step = 200;
  for (const s of STEPS) {
    if (s * tl.scale * view.k >= 34) {
      step = s;
      break;
    }
  }
  const from = Math.floor(tl.min / step) * step;
  const to = Math.ceil(tl.max / step) * step;
  const ticks: number[] = [];
  for (let y = from; y <= to; y += step) ticks.push(y);

  return (
    <g id="axis">
      <rect className="axis-bg" x={0} y={0} width={58} height={size.h} />
      {ticks.map((y) => {
        const sy = view.y + (y - tl.min) * tl.scale * view.k;
        if (sy < -20 || sy > size.h + 20) return null;
        return (
          <g key={y}>
            <line className="axis-line" x1={58} y1={sy} x2={size.w} y2={sy} />
            <text className="axis-tick" x={50} y={sy + 4} textAnchor="end">
              {y}
            </text>
          </g>
        );
      })}
      <line className="axis-edge" x1={58} y1={0} x2={58} y2={size.h} />
    </g>
  );
}
