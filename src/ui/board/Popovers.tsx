/** The two windows over the canvas: the menu of a line and the add window. */
import type { Dispatch, SetStateAction } from "react";
import type { PersonSpec } from "../../model/tree.ts";
import type { Relation } from "../../model/store.ts";
import { AddPopover, type PopSpot } from "../AddPopover.tsx";
import { useNarrow } from "../bits.tsx";
import { useApp } from "../ctx.ts";
import { EdgeMenu, type EdgeSpot } from "../EdgeMenu.tsx";

interface Props {
  pop: PopSpot | null;
  setPop: Dispatch<SetStateAction<PopSpot | null>>;
  edgePop: EdgeSpot | null;
  setEdgePop: Dispatch<SetStateAction<EdgeSpot | null>>;
}

/** A phone has no room for a window beside what was clicked: there it is a card at the
    top of the screen, placed by the stylesheet alone, so it gets no coordinates. */
const unplaced = <T extends { x?: number; y?: number }>(spot: T): T => ({ ...spot, x: undefined, y: undefined });

export function Popovers({ pop, setPop, edgePop, setEdgePop }: Props) {
  const { s, d } = useApp();
  const narrow = useNarrow();

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
    <>
      {edgePop && (
        <EdgeMenu
          spot={narrow ? unplaced(edgePop) : edgePop}
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
          spot={narrow ? unplaced(pop) : pop}
          people={s.tree.people}
          onCreate={addFromPop}
          onExisting={connectFromPop}
          onClose={() => setPop(null)}
        />
      )}
    </>
  );
}
