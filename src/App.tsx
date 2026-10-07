import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import family from "./data/family.json";
import { loadLang, saveLang, t, type Lang } from "./i18n.ts";
import { loadStored } from "./io/local.ts";
import { bboxOf, layout } from "./layout/layout.ts";
import { initialAppState, reducer, type Relation } from "./model/store.ts";
import { normalize } from "./model/tree.ts";
import { Board, type BoardHandle } from "./ui/Board.tsx";
import { cardsFor } from "./ui/cards.ts";
import { AppCtx } from "./ui/ctx.ts";
import { keyCommand } from "./ui/keys.ts";
import { Sidebar } from "./ui/Sidebar.tsx";
import { useSync } from "./ui/useSync.ts";

export function App() {
  const [s, d] = useReducer(reducer, undefined, () =>
    // on the very first run we put in the transcription of the paper record
    initialAppState(loadStored() ?? normalize(family)),
  );
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<{ mode: Relation; from: string } | null>(null);
  const board = useRef<BoardHandle>(null);
  /** On a phone the panel is a sheet lying over the canvas; this is how much of the
      bottom of the canvas it covers. Zero on a wide screen, where they stand side by side. */
  const [sheet, setSheet] = useState(0);

  // the interface language is remembered in the browser: it is a setting of the screen, not of the data
  const [lang, setLangState] = useState<Lang>(loadLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    saveLang(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t(lang, "app.title");
  }, [lang]);
  const tt = useCallback((key: string, vars?: Record<string, string | number>) => t(lang, key, vars), [lang]);

  const lay = useMemo(() => layout(s.tree, cardsFor(lang)), [s.tree, lang]);
  const bbox = useMemo(() => bboxOf(lay.pos), [lay.pos]);

  const { where, reread, upload, download } = useSync(s.tree, s.selected, d);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cmd = keyCommand(e, { picking: !!pick, selected: s.selected, onPage: document.activeElement === document.body });
      if (cmd === "undo") {
        e.preventDefault();
        d({ type: "undo" });
      } else if (cmd === "unpick") setPick(null);
      else if (cmd === "deselect") d({ type: "select", id: null });
      else if (cmd === "delete" && s.selected) {
        const p = s.tree.people[s.selected];
        if (p && confirm(t(lang, "confirm.delete", { name: p.name }))) d({ type: "remove", id: s.selected });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pick, s.selected, s.tree.people, lang]);

  const ctx = useMemo(() => ({ s, d, lang, setLang, t: tt }), [s, lang, setLang, tt]);

  return (
    <AppCtx value={ctx}>
      <div id="app" style={{ "--sheet": sheet + "px" } as CSSProperties}>
        <Sidebar
          filter={filter}
          setFilter={setFilter}
          bbox={bbox}
          where={where}
          onReread={reread}
          onUpload={upload}
          onDownload={download}
          onSheet={setSheet}
          onAdd={() => board.current?.openAdd(undefined, s.selected ?? undefined)}
          onAddRelation={(mode) => s.selected && board.current?.openAdd(mode, s.selected)}
          onPick={(mode) => s.selected && setPick({ mode, from: s.selected })}
          onGoTo={(id) => board.current?.focusOn(id)}
        />
        <Board
          ref={board}
          layout={lay}
          filter={filter}
          pick={pick}
          sheet={sheet}
          onPickDone={(id) => {
            if (pick && id) d({ type: "connect", mode: pick.mode, from: pick.from, to: id });
            setPick(null);
          }}
        />
      </div>
    </AppCtx>
  );
}
