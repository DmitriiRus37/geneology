import { useMemo, useRef, useState } from "react";
import { exportPdfFile } from "../io/exportPdf.ts";
import { exportPngFile, exportSvgFile } from "../io/exportSvg.ts";
import { downloadZip, uploadZip } from "../io/disk.ts";
import { readJson, saveJson } from "../io/files.ts";
import type { Where } from "../App.tsx";
import type { BBox } from "../layout/layout.ts";
import { yearTag } from "../model/dates.ts";
import { matches } from "../model/names.ts";
import type { Relation } from "../model/store.ts";
import { msg } from "../i18n.ts";
import { normalize } from "../model/tree.ts";
import { PersonLine, Seg } from "./bits.tsx";
import { useApp } from "./ctx.ts";
import { Editor } from "./Editor.tsx";

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
}

export function Sidebar({ filter, setFilter, onAdd, onAddRelation, onPick, onGoTo, bbox, where, onReread }: Props) {
  const { s, d, t, lang, setLang } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const [min, setMin] = useState(false);

  const ids = Object.keys(s.tree.people);
  const list = useMemo(
    () =>
      ids
        .filter((id) => matches(s.tree.people[id], filter))
        .sort((a, b) => s.tree.people[a].name.localeCompare(s.tree.people[b].name, "ru")),
    [ids, s.tree.people, filter],
  );

  const selected = s.selected && s.tree.people[s.selected] ? s.tree.people[s.selected] : null;
  const hiddenSet = useMemo(() => new Set(s.tree.hidden), [s.tree.hidden]);

  return (
    <aside id="rail" className={min ? "min" : ""}>
      <div className="rail-head">
        <h1>{t("app.title")}</h1>
        <p>{t("rail.intro")}</p>
        <button className="primary add-big" onClick={onAdd}>
          {t("rail.add")}
        </button>
        <button id="railToggle" className="quiet" onClick={() => setMin((v) => !v)}>
          {min ? t("rail.expand") : t("rail.collapse")}
        </button>
      </div>

      <div className="rail-scroll">
        {selected ? (
          <Editor key={selected.id} p={selected} onAddRelation={onAddRelation} onPick={onPick} onGoTo={onGoTo} />
        ) : (
          <div className="block">
            <p className="block-title">{t("rail.hint")}</p>
          </div>
        )}

        <div className="block">
          <input
            id="search"
            type="text"
            placeholder={t("rail.search")}
            autoComplete="off"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul id="people">
            {list.map((id) => {
              const p = s.tree.people[id];
              const tag = yearTag(p);
              return (
                <li
                  key={id}
                  className={(s.selected === id ? "sel" : "") + (hiddenSet.has(id) ? " hid" : "")}
                  title={hiddenSet.has(id) ? t("rail.hiddenTitle") : undefined}
                  onClick={() => {
                    d({ type: "select", id });
                    onGoTo(id);
                  }}
                >
                  <PersonLine p={p} tag={hiddenSet.has(id) ? t("rail.hidden") : tag} />
                </li>
              );
            })}
          </ul>
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
                const err = await downloadZip();
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
            const r = await uploadZip(f);
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
