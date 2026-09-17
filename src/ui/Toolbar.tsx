import { useApp } from "./ctx.ts";

interface Props {
  onFit: () => void;
  onZoom: (f: number) => void;
}

/** Панель на холсте: режим, просвет, масштаб. Добавление — одной кнопкой в боковой панели. */
export function Toolbar({ onFit, onZoom }: Props) {
  const { s, d, t } = useApp();
  const hidden = s.tree.hidden.length;
  return (
    <div id="tools">
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
      <button onClick={() => d({ type: "rearrange" })} title={t("tool.rearrangeTitle")}>
        {t("tool.rearrange")}
      </button>
      <button onClick={() => onZoom(1 / 1.2)} title={t("tool.zoomOut")}>
        −
      </button>
      <button onClick={() => onZoom(1.2)} title={t("tool.zoomIn")}>
        +
      </button>
    </div>
  );
}
