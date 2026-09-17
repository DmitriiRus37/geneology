import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import family from "./data/family.json";
import { loadLang, msg, saveLang, t, type Lang } from "./i18n.ts";
import { flushDisk, probeDisk, reloadDisk, saveDisk } from "./io/disk.ts";
import { bboxOf, layout } from "./layout/layout.ts";
import { initialAppState, loadStored, reducer, store, type Relation } from "./model/store.ts";
import { normalize } from "./model/tree.ts";
import type { TreeState } from "./model/types.ts";
import { Board, type BoardHandle } from "./ui/Board.tsx";
import { AppCtx } from "./ui/ctx.ts";
import { Sidebar } from "./ui/Sidebar.tsx";

export type Where =
  | { kind: "disk"; dir: string; blocked: null | "conflict" | "stale" }
  | { kind: "browser" }
  | null;

export function App() {
  const [s, d] = useReducer(reducer, undefined, () =>
    // при первом запуске подставляем расшифровку бумажной росписи
    initialAppState(loadStored() ?? normalize(family)),
  );
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<{ mode: Relation; from: string } | null>(null);
  const [where, setWhere] = useState<Where>(null);
  const board = useRef<BoardHandle>(null);

  // язык интерфейса помнится в браузере: это настройка экрана, а не данных
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

  // рядом может работать локальный сервер — тогда пишем в файлы, а не в браузер
  useEffect(() => {
    let alive = true;
    probeDisk().then((info) => {
      if (!alive) return;
      if (!info) {
        setWhere({ kind: "browser" });
        return;
      }
      setWhere({ kind: "disk", dir: info.dir, blocked: info.stale ? "stale" : null });
      if (info.tree && Object.keys(info.tree.people).length) {
        d({ type: "load", tree: normalize(info.tree), silent: true });
      } else if (!info.stale) {
        void saveDisk(treeRef.current); // persons/ ещё пуста — засеваем тем, что открыто
      }
      if (info.stale) {
        d({ type: "notice", msg: msg("notice.staleServer") });
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Каждое изменение уезжает на диск (или в браузер, если сервера нет) — через
  // секунду после последней правки, чтобы не писать файл на каждую букву. Но если
  // выбрали другого человека или ушли из текстового поля, ждать нечего — пишем сразу.
  const [flushSeq, setFlushSeq] = useState(0);
  const flushSeen = useRef(0);
  const lastSaved = useRef<TreeState | null>(null);
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
    if (where.kind === "disk" && where.blocked) return; // пока не починим — не пишем
    if (lastSaved.current === s.tree) return; // писать нечего
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

  // вкладку закрывают — дописываем то, что не успело уйти
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
      <div id="app">
        <Sidebar
          filter={filter}
          setFilter={setFilter}
          bbox={bbox}
          where={where}
          onReread={reread}
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
          onPickDone={(id) => {
            if (pick && id) d({ type: "connect", mode: pick.mode, from: pick.from, to: id });
            setPick(null);
          }}
        />
      </div>
    </AppCtx>
  );
}
