import { useEffect, useMemo, useRef } from "react";
import { exportPdfFile } from "../io/exportPdf.ts";
import { exportPngFile, exportSvgFile } from "../io/exportSvg.ts";
import { readJson, saveJson } from "../io/files.ts";
import type { Sync, Where } from "../io/sync.ts";
import type { BBox } from "../layout/layout.ts";
import { yearTag } from "../model/dates.ts";
import { matches } from "../model/names.ts";
import type { Relation } from "../model/store.ts";
import { msg } from "../i18n.ts";
import { normalize } from "../model/tree.ts";
import { PersonLine, Seg, useNarrow } from "./bits.tsx";
import { useApp } from "./ctx.ts";
import { Editor } from "./Editor.tsx";
import { useSheet } from "./sheet.ts";

interface Props {
  filter: string;
  setFilter: (v: string) => void;
  onAdd: () => void;
  onAddRelation: (mode: Relation) => void;
  onPick: (mode: Relation) => void;
  onGoTo: (id: string) => void;
  bbox: BBox | null;
  where: Where;
  onReread: () => void;
  /** an archive of cards replaces the tree on a server that keeps it in memory */
  onUpload: Sync["upload"];
  /** the tree as an archive; returns what went wrong, or null */
  onDownload: Sync["download"];
  /** how much of the canvas the sheet covers on a phone, so the tree can keep clear of it */
  onSheet: (px: number) => void;
}

export function Sidebar({ filter, setFilter, onAdd, onAddRelation, onPick, onGoTo, bbox, where, onReread, onUpload, onDownload, onSheet }: Props) {
  const { s, d, t, lang, setLang } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);

  // On a wide screen the panel is the column it always was; on a phone it is a sheet.
  const narrow = useNarrow();
  const sheet = useSheet(narrow, onSheet);
  const findRef = useRef<HTMLInputElement>(null);
  const refocus = useRef(false);

  /** Was the person picked from the list right here, rather than on the tree? */
  const fromList = useRef(false);

  // A selection on a phone is a request to see that person. Tapped on the tree: the
  // sheet comes up far enough to show their fields, from the top. Picked from the list
  // with the sheet all the way up: it steps down so the tree shows where they are, and
  // the list stays where it was — they are reading down it. And when nobody is selected
  // any more, a sheet that came up by itself goes back down.
  useEffect(() => {
    const wasList = fromList.current;
    fromList.current = false;
    if (!narrow) return;
    if (s.selected) {
      if (sheet.snap === "peek") sheet.go("half");
      else if (wasList && sheet.snap === "full") sheet.go("half", false);
      if (!wasList) sheet.rail.current?.scrollTo({ top: 0 });
    } else if (sheet.byApp() && sheet.snap === "half") {
      sheet.go("peek");
    }
  }, [narrow, s.selected]);

  const people = s.tree.people;
  const ids = useMemo(() => Object.keys(people), [people]);
  const list = useMemo(
    () => ids.filter((id) => matches(people[id], filter)).sort((a, b) => people[a].name.localeCompare(people[b].name, "ru")),
    [ids, people, filter],
  );

  const selected = s.selected && people[s.selected] ? people[s.selected] : null;
  const hiddenSet = useMemo(() => new Set(s.tree.hidden), [s.tree.hidden]);

  // Built only when what it shows changes: dragging the sheet re-renders the panel on
  // every frame, and a long list would make the drag stutter.
  const rows = useMemo(
    () =>
      list.map((id) => {
        const p = people[id];
        const tag = yearTag(p);
        return (
          <li
            key={id}
            className={(s.selected === id ? "sel" : "") + (hiddenSet.has(id) ? " hid" : "")}
            title={hiddenSet.has(id) ? t("rail.hiddenTitle") : undefined}
            onClick={() => {
              fromList.current = true;
              d({ type: "select", id });
              onGoTo(id);
            }}
          >
            <PersonLine p={p} tag={hiddenSet.has(id) ? t("rail.hidden") : tag} />
          </li>
        );
      }),
    [list, people, s.selected, hiddenSet, t, d, onGoTo],
  );

  const search = (
    <input
      id="search"
      type="text"
      placeholder={t("rail.search")}
      autoComplete="off"
      value={filter}
      onChange={(e) => setFilter(e.target.value)}
    />
  );

  return (
    <aside
      id="rail"
      ref={sheet.rail}
      className={[sheet.dragging ? "dragging" : "", sheet.shut ? "shut" : ""].filter(Boolean).join(" ")}
      style={narrow && sheet.height ? { height: sheet.height } : undefined}
      // A phone keyboard covers the lower half of the screen and the sheet does not know
      // it is there, so a field low down would be typed into blind. The sheet goes up to
      // its full height, where the field is above the keyboard — and the search has room
      // to show what it finds.
      onFocusCapture={(e) => {
        const el = e.target;
        if (narrow && el instanceof HTMLInputElement && el.type === "text") sheet.go("full", false);
      }}
    >
      <div className="ruler" ref={sheet.ruler} aria-hidden />
      <div className="rail-head" ref={sheet.head}>
        <div
          className="grab"
          role="button"
          tabIndex={0}
          aria-expanded={!sheet.shut}
          aria-label={sheet.shut ? t("rail.expand") : t("rail.collapse")}
          title={sheet.shut ? t("rail.expand") : t("rail.collapse")}
          {...sheet.bar}
        >
          <span />
        </div>
        <h1>{t("app.title")}</h1>
        <p>{t("rail.intro")}</p>
        {/* on a phone the head holds what is worth a single tap: finding and adding */}
        {narrow && (
          <div className="find">
            <input
              id="search"
              ref={findRef}
              type="text"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={t("rail.search")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              // the keyboard's "search" key has nothing to submit: it puts the keyboard away
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            {filter && (
              <button
                className="clear"
                aria-label={t("rail.clearSearch")}
                title={t("rail.clearSearch")}
                // keep the keyboard up if it was up: the next name is typed straight away
                onPointerDown={(e) => {
                  refocus.current = document.activeElement === findRef.current;
                  e.preventDefault();
                }}
                onClick={() => {
                  setFilter("");
                  if (refocus.current) findRef.current?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
        )}
        <button className="primary add-big" onClick={onAdd} aria-label={narrow ? t("rail.add") : undefined}>
          {narrow ? t("rail.addShort") : t("rail.add")}
        </button>
      </div>

      <div className="rail-scroll">
        {selected ? (
          <Editor
            key={selected.id}
            p={selected}
            onAddRelation={onAddRelation}
            // the next tap has to land on someone on the tree, so the sheet gets out of the way
            onPick={(mode) => {
              if (narrow) sheet.go("peek", false);
              onPick(mode);
            }}
            onGoTo={onGoTo}
          />
        ) : (
          <div className="block hint">
            <p className="block-title">{t("rail.hint")}</p>
          </div>
        )}

        <div className="block">
          {!narrow && search}
          <ul id="people">{rows}</ul>
          {!list.length && <p className="empty-note">{ids.length ? t("rail.nobodyFound") : t("rail.nobodyYet")}</p>}
        </div>
      </div>

      <div className="rail-foot">
        <p
          className={
            "where " +
            (where?.kind === "disk"
              ? where.blocked
                ? "stuck"
                : where.store === "memory"
                  ? "mem"
                  : "disk"
              : (where?.kind ?? ""))
          }
        >
          {where?.kind === "disk"
            ? where.blocked === "stale"
              ? t("where.stale")
              : where.blocked === "conflict"
                ? t("where.conflict")
                : where.store === "memory"
                  ? t("where.memory")
                  : t("where.disk", { dir: where.dir })
            : where?.kind === "browser"
              ? t("where.browser")
              : "…"}
        </p>
        {where?.kind === "disk" && where.blocked && (
          <button className="primary" style={{ flex: "0 0 100%", marginBottom: 6 }} onClick={onReread}>
            {where.blocked === "stale" ? t("where.recheck") : t("where.reread")}
          </button>
        )}
        {/* Four groups, in the order they get reached for: undo while editing,
            then the tree as a whole, then pictures out of it, then the session.
            The JSON pair only shows where it is the only way in or out — with a
            server holding the tree in memory the archive does the same job and
            two of everything only confuses. */}
        <div className="fgroup">
          <button className="quiet" onClick={() => d({ type: "undo" })}>
            {t("rail.undo")}
          </button>
        </div>

        <div className="fgroup">
          {where?.kind === "disk" && where.store === "memory" && (
            <button className="quiet" onClick={() => zipRef.current?.click()}>
              {t("rail.uploadZip")}
            </button>
          )}
          {where?.kind === "disk" && (
            <button
              className="quiet"
              onClick={async () => {
                const err = await onDownload();
                if (err) d({ type: "notice", msg: msg("notice.zipFailed", { detail: err }) });
              }}
            >
              {t("rail.downloadZip")}
            </button>
          )}
          {!(where?.kind === "disk" && where.store === "memory") && (
            <>
              <button className="quiet" onClick={() => saveJson(s.tree)}>
                {t("rail.saveFile")}
              </button>
              <button className="quiet" onClick={() => fileRef.current?.click()}>
                {t("rail.openFile")}
              </button>
            </>
          )}
          {!!ids.length && (
            <button
              className="quiet danger"
              onClick={() => {
                if (confirm(t("confirm.clear", { n: ids.length }))) d({ type: "wipe" });
              }}
            >
              {t("rail.clear")}
            </button>
          )}
        </div>

        <div className="fgroup">
          <button
            className="quiet"
            onClick={() => {
              if (!exportSvgFile(bbox)) d({ type: "notice", msg: msg("notice.empty") });
            }}
          >
            {t("rail.svg")}
          </button>
          <button
            className="quiet"
            onClick={() => {
              const ok = exportPngFile(bbox, () => d({ type: "notice", msg: msg("notice.pngFailed") }));
              if (!ok) d({ type: "notice", msg: msg("notice.empty") });
            }}
          >
            {t("rail.png")}
          </button>
          <button
            className="quiet"
            onClick={async () => {
              d({ type: "notice", msg: msg("notice.pdfBuilding") });
              const ok = await exportPdfFile(bbox, (detail) => d({ type: "notice", msg: msg("notice.pdfFailed", { detail }) }));
              if (!ok) d({ type: "notice", msg: msg("notice.empty") });
            }}
          >
            {t("rail.pdf")}
          </button>
        </div>

        <div className="fgroup last">
          <Seg
            className="langs"
            title={t("rail.langTitle")}
            options={[{ v: "ru", label: "RU" }, { v: "en", label: "EN" }]}
            value={lang}
            onPick={setLang}
          />
          {/* Both are plain navigations, not fetches: the ticket lives in a cookie
              the page cannot read, and only the server can take it back. */}
          {where?.kind === "disk" && where.role === "admin" && (
            <button className="quiet" onClick={() => (location.href = "/admin")}>
              {t("rail.admin")}
            </button>
          )}
          {where?.kind === "disk" && where.guarded && (
            <button className="quiet logout" onClick={() => (location.href = "/logout")}>
              {t("rail.logout")}
            </button>
          )}
        </div>

        <input
          ref={zipRef}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const r = await onUpload(f);
            if ("error" in r) {
              d({ type: "notice", msg: msg("notice.zipFailed", { detail: r.error }) });
              return;
            }
            const tree = normalize(r.tree);
            d({ type: "load", tree, notice: msg("notice.zipLoaded", { n: Object.keys(tree.people).length }) });
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const raw = await readJson(f);
              d({ type: "load", tree: normalize(raw), notice: msg("notice.loaded") });
            } catch {
              d({ type: "notice", msg: msg("notice.fileFailed") });
            }
          }}
        />
      </div>
    </aside>
  );
}
