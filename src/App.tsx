import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import family from "./data/family.json";
import { loadLang, msg, saveLang, t, type Lang } from "./i18n.ts";
import { flushDisk, probeDisk, reloadDisk, saveDisk, type Store } from "./io/disk.ts";
import { bboxOf, layout } from "./layout/layout.ts";
import { initialAppState, loadStored, reducer, store, type Relation } from "./model/store.ts";
import { normalize } from "./model/tree.ts";
import type { TreeState } from "./model/types.ts";
import { Board, type BoardHandle } from "./ui/Board.tsx";
import { AppCtx } from "./ui/ctx.ts";
import { Sidebar } from "./ui/Sidebar.tsx";

export type Where =
  | { kind: "disk"; dir: string; store: Store; guarded: boolean; role: string; blocked: null | "conflict" | "stale" }
  | { kind: "browser" }
  | null;

export function App() {
  const [s, d] = useReducer(reducer, undefined, () =>
    // on the very first run we put in the transcription of the paper record
    initialAppState(loadStored() ?? normalize(family)),
  );
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<{ mode: Relation; from: string } | null>(null);
  const [where, setWhere] = useState<Where>(null);
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

  const lay = useMemo(() => layout(s.tree, lang), [s.tree, lang]);
  const bbox = useMemo(() => bboxOf(lay.pos), [lay.pos]);

  const treeRef = useRef(s.tree);
  treeRef.current = s.tree;
  /** What has already gone to the store: we do not write the same tree twice. */
  const lastSaved = useRef<TreeState | null>(null);

  // a local server may be running alongside — then we write to files rather than to the browser
  useEffect(() => {
    let alive = true;
    probeDisk().then((info) => {
      if (!alive) return;
      if (!info) {
        setWhere({ kind: "browser" });
        return;
      }
      setWhere({
        kind: "disk",
        dir: info.dir,
        store: info.store,
        guarded: info.guarded,
        role: info.role,
        blocked: info.stale ? "stale" : null,
      });
      if (info.tree && Object.keys(info.tree.people).length) {
        d({ type: "load", tree: normalize(info.tree), silent: true });
      } else if (info.store === "memory") {
        // A server that keeps people in memory starts empty and stays empty until
        // an archive is uploaded. Seeding it with the sample tree would put names
        // on a machine that was never meant to hold them.
        d({ type: "load", tree: normalize({}), silent: true });
      } else if (!info.stale) {
        // The folder is empty — we seed it with whatever is open. We mark the tree
        // as sent straight away: otherwise the autosave would get a second request
        // out behind it, still carrying the old fingerprint, and answer itself with
        // a conflict.
        lastSaved.current = treeRef.current;
        void saveDisk(treeRef.current);
      }
      if (info.stale) {
        d({ type: "notice", msg: msg("notice.staleServer") });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Every change goes off to disk (or to the browser when there is no server) a second
  // after the last edit, so as not to write a file for every letter. But if another
  // person was selected or a text field was left, there is nothing to wait for — we
  // write at once.
  const [flushSeq, setFlushSeq] = useState(0);
  const flushSeen = useRef(0);
  useEffect(() => {
    setFlushSeq((n) => n + 1);
  }, [s.selected]);
  useEffect(() => {
    const onBlur = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) setFlushSeq((n) => n + 1);
    };
    document.addEventListener("focusout", onBlur);
    return () => document.removeEventListener("focusout", onBlur);
  }, []);
  useEffect(() => {
    if (!where) return;
    if (where.kind === "disk" && where.blocked) return; // until it is mended, we do not write
    if (lastSaved.current === s.tree) return; // there is nothing to write
    const now = flushSeq !== flushSeen.current;
    flushSeen.current = flushSeq;
    const t = setTimeout(
      () => {
        lastSaved.current = s.tree;
        if (where.kind !== "disk") {
          store(s.tree);
          return;
        }
        void saveDisk(s.tree).then((r) => {
          if (r !== "conflict") return;
          setWhere({ ...where, blocked: "conflict" });
          d({ type: "notice", msg: msg("notice.conflict") });
        });
      },
      now ? 0 : 1000,
    );
    return () => clearTimeout(t);
  }, [s.tree, where, flushSeq]);

  const reread = async () => {
    const tree = await reloadDisk();
    if (!tree) return;
    d({ type: "load", tree: normalize(tree), silent: true, notice: msg("notice.reread") });
    setWhere((w) => (w && w.kind === "disk" ? { ...w, blocked: null } : w));
  };

  // the tab is being closed — we write out whatever did not get away in time
  useEffect(() => {
    if (where?.kind !== "disk" || where.blocked) return;
    const bye = () => flushDisk(treeRef.current);
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [where]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        d({ type: "undo" });
        return;
      }
      if (e.key === "Escape") {
        if (pick) setPick(null);
        else d({ type: "select", id: null });
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selected && document.activeElement === document.body) {
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
