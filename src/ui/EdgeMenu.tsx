import { useRef } from "react";
import type { EdgeRef } from "../layout/edges.ts";
import { isPair, type Pair, type Person } from "../model/types.ts";
import { useDismiss } from "./bits.tsx";
import { useApp } from "./ctx.ts";

export interface EdgeSpot {
  /** coordinates inside the canvas; none on a phone, where the stylesheet places the menu */
  x?: number;
  y?: number;
  ref: EdgeRef;
}

interface Props {
  spot: EdgeSpot;
  people: Record<string, Person>;
  pairs: Pair[];
  onCut: (parent: string, child: string) => void;
  onUnmarry: (a: string, b: string) => void;
  onUnsibling: (a: string, b: string) => void;
  onClose: () => void;
}

interface Row {
  text: string;
  run: () => void;
}

/** A line was clicked — we show which links it holds and let them be removed. */
export function EdgeMenu({ spot, people, pairs, onCut, onUnmarry, onUnsibling, onClose }: Props) {
  const { t } = useApp();
  const box = useRef<HTMLDivElement>(null);

  useDismiss(box, onClose);

  const nm = (id: string) => people[id]?.name ?? "?";
  const married = (a: string, b: string) => pairs.some((p) => isPair(p, a, b));

  const rows: Row[] = [];
  const r = spot.ref;
  let title = t("em.remove");
  if (r.kind === "child") {
    title = t("em.parentsOf", { name: nm(r.child) });
    for (const p of r.parents) {
      if (!people[p] || !people[r.child]) continue;
      rows.push({ text: nm(p), run: () => onCut(p, r.child) });
    }
  } else if (r.kind === "leg") {
    title = t("em.childrenOf", { name: nm(r.parent) });
    for (const c of r.children) {
      if (!people[r.parent] || !people[c]) continue;
      rows.push({ text: nm(c), run: () => onCut(r.parent, c) });
    }
  } else if (r.kind === "sibling") {
    title = t("em.kinship");
    if (people[r.a] && people[r.b]) {
      rows.push({ text: t("em.siblings", { a: nm(r.a), b: nm(r.b) }), run: () => onUnsibling(r.a, r.b) });
    }
  } else {
    title = t("em.family");
    if (married(r.a, r.b)) {
      rows.push({ text: t("em.marriage", { a: nm(r.a), b: nm(r.b) }), run: () => onUnmarry(r.a, r.b) });
    }
    for (const p of [r.a, r.b]) {
      for (const c of r.children) {
        if (!people[p] || !people[c]) continue;
        rows.push({ text: nm(p) + " → " + nm(c), run: () => onCut(p, c) });
      }
    }
  }

  return (
    <div className="pop edge-pop" ref={box} style={{ left: spot.x, top: spot.y }}>
      <h3>{rows.length ? title : t("em.none")}</h3>
      <ul className="cuts">
        {rows.map((row, i) => (
          <li key={i}>
            <span className="nm">{row.text}</span>
            <button className="danger" onClick={row.run} title={t("em.removeThis")}>
              {t("em.removeBtn")}
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button className="quiet" onClick={onClose}>
          {t("em.close")}
        </button>
      </div>
    </div>
  );
}
