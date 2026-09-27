import { useCallback, useRef, useState } from "react";
import { useDismiss } from "./bits.tsx";
import { useApp } from "./ctx.ts";

interface Props {
  onFit: () => void;
  onZoom: (f: number) => void;
}

/**
 * The bar on the canvas: mode, gap, zoom. Adding lives on one button in the side panel.
 *
 * The whole row is wider than a phone, so there it keeps only what a finger reaches for
 * on a tree that does not fit the screen, and the rest is one tap away behind "more".
 * Which of them that is, is decided in the stylesheet: the markup is the same either way.
 */
export function Toolbar({ onFit, onZoom }: Props) {
  const { s, d, t } = useApp();
  const hidden = s.tree.hidden.length;
  const [more, setMore] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(box, useCallback(() => setMore(false), []));

  return (
    <div id="tools" className={more ? "more" : ""} ref={box}>
      <label className="sw" title={t("tool.timelineTitle")}>
        <input
          type="checkbox"
          checked={s.tree.timeline}
          onChange={(e) => d({ type: "setTimeline", on: e.target.checked })}
        />
        <span className="track" />
        {t("tool.timeline")}
      </label>
      <label className="rng" title={t("tool.gapTitle")}>
        {t("tool.gap")}
        <input
          type="range"
          min={0.6}
          max={2.4}
          step={0.1}
          value={s.tree.gap}
          onChange={(e) => d({ type: "setGap", gap: parseFloat(e.target.value) || 1 })}
        />
      </label>
      {hidden > 0 && (
        <button className="primary" onClick={() => d({ type: "unhideAll" })} title={t("tool.unhideTitle", { n: hidden })}>
          {t("tool.unhide", { n: hidden })}
        </button>
      )}
      <button onClick={onFit} title={t("tool.fitTitle")}>
        {t("tool.fit")}
      </button>
      <button className="rearrange" onClick={() => d({ type: "rearrange" })} title={t("tool.rearrangeTitle")}>
        {t("tool.rearrange")}
      </button>
      <button onClick={() => onZoom(1 / 1.2)} title={t("tool.zoomOut")}>
        −
      </button>
      <button onClick={() => onZoom(1.2)} title={t("tool.zoomIn")}>
        +
      </button>
      <button id="toolsMore" onClick={() => setMore((v) => !v)} title={t("tool.more")} aria-expanded={more}>
        ⋯
      </button>
    </div>
  );
}
