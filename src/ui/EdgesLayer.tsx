import { memo } from "react";
import type { EdgeItem } from "../layout/edges.ts";

export const EdgesLayer = memo(function EdgesLayer({ items }: { items: EdgeItem[] }) {
  return (
    <g id="edges">
      {items.map((it, i) =>
        it.kind === "path" ? (
          <g key={i}>
            {/* a thin line is impossible to hit: a wide transparent copy lies alongside */}
            {it.ref && <path className="hit" d={it.d} data-edge={i} />}
            <path
              className={"link" + (it.hot ? " hot" : "") + (it.dashed ? " sib" : "")}
              d={it.d}
              markerEnd={it.arrow ? (it.hot ? "url(#tipHot)" : "url(#tip)") : undefined}
            />
          </g>
        ) : (
          <circle key={i} className={"joint" + (it.hot ? " hot" : "")} cx={it.x} cy={it.y} r={3.4} />
        ),
      )}
    </g>
  );
});
