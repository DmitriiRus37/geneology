import { useState } from "react";
import { yearTag } from "../model/dates.ts";
import { kinOf, type KinRow } from "../model/kin.ts";
import { colorOf } from "../model/names.ts";
import { DateField, Seg } from "./bits.tsx";
import type { Relation } from "../model/store.ts";
import { childrenOf, parentsOf, partnersOf } from "../model/tree.ts";
import type { Person, Sex } from "../model/types.ts";
import { useApp } from "./ctx.ts";

interface Props {
  p: Person;
  onAddRelation: (mode: Relation) => void;
  onPick: (mode: Relation) => void;
  onGoTo: (id: string) => void;
}

const splitList = (v: string): string[] =>
  v
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean);

const SEX: { v: Sex; t: string }[] = [
  { v: "m", t: "ed.male" },
  { v: "f", t: "ed.female" },
  { v: "u", t: "ed.unknown" },
];

export function Editor({ p, onAddRelation, onPick, onGoTo }: Props) {
  const { s, d, t, lang } = useApp();
  const [name, setName] = useState(p.name);
  const [maiden, setMaiden] = useState(p.maiden);
  const [born, setBorn] = useState(p.born);
  const [died, setDied] = useState(p.died);
  const [alt, setAlt] = useState((p.alt || []).join(", "));

  const set = (patch: Partial<Person>) => d({ type: "update", id: p.id, patch, quiet: true });

  const parents = parentsOf(s.tree, p.id);
  const kids = childrenOf(s.tree, p.id);
  const spouses = partnersOf(s.tree, p.id);

  const kin = kinOf(s.tree, p.id, lang);

  /** Как убрать связь именно с этим человеком: их может быть и несколько. */
  const cutOf = (k: KinRow): (() => void) | null => {
    const who = k.id;
    if (parents.indexOf(who) > -1) return () => d({ type: "cut", parent: who, child: p.id });
    if (kids.indexOf(who) > -1) return () => d({ type: "cut", parent: p.id, child: who });
    if (spouses.indexOf(who) > -1) return () => d({ type: "unlinkPartner", a: p.id, b: who });
    if (k.explicit) return () => d({ type: "unlinkSibling", a: p.id, b: who });
    return null; // брат через общих родителей: убирать надо связь с родителями
  };

  return (
    <div className="block" id="editor">
      <p className="block-title">
        {t("ed.parents", { n: parents.length })} · {t("ed.children", { n: kids.length })}
        {spouses.length ? " · " + t("ed.married", { n: spouses.length }) : ""}
      </p>

      <input
        type="text"
        value={name}
        placeholder={t("pop.namePh")}
        onChange={(e) => {
          setName(e.target.value);
          set({ name: e.target.value });
        }}
      />
      <input
        type="text"
        value={maiden}
        placeholder={t("ed.maidenPh")}
        onChange={(e) => {
          setMaiden(e.target.value);
          set({ maiden: e.target.value.trim() });
        }}
      />
      <div style={{ display: "flex", gap: 7 }}>
        <DateField
          value={born}
          placeholder={t("pop.bornPh")}
          set={(v) => {
            setBorn(v);
            set({ born: v.trim() });
          }}
        />
        <DateField
          value={died}
          placeholder={t("pop.diedPh")}
          set={(v) => {
            setDied(v);
            set({ died: v.trim() });
          }}
        />
      </div>
      <input
        type="text"
        value={alt}
        placeholder={t("ed.altPh")}
        onChange={(e) => {
          setAlt(e.target.value);
          set({ alt: splitList(e.target.value) });
        }}
      />

      <div className="lbl">{t("ed.sex")}</div>
      <Seg
        options={SEX.map((x) => ({ v: x.v, label: t(x.t) }))}
        value={p.sex}
        onPick={(sex) => d({ type: "update", id: p.id, patch: { sex } })}
      />

      <div className="lbl" style={{ marginTop: 12 }}>
        {t("ed.addNear")}
      </div>
      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={() => onAddRelation("parent")}>{t("ed.addParent")}</button>
        <button onClick={() => onAddRelation("child")}>{t("ed.addChild")}</button>
        <button onClick={() => onAddRelation("spouse")}>{t("ed.addSpouse")}</button>
        <button onClick={() => onAddRelation("sibling")} title={t("ed.addSiblingTitle")}>
          {t("ed.addSibling")}
        </button>
      </div>

      <div className="lbl" style={{ marginTop: 12 }}>
        {t("ed.connect")}
      </div>
      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={() => onPick("child")}>{t("ed.toChild")}</button>
        <button onClick={() => onPick("parent")}>{t("ed.fromParent")}</button>
        <button onClick={() => onPick("spouse")}>{t("ed.marriage")}</button>
        <button onClick={() => onPick("sibling")}>{t("ed.sibling")}</button>
      </div>

      {kin.length > 0 && (
        <>
          <div className="lbl" style={{ marginTop: 12 }}>
            {t("ed.kin")}
          </div>
          <ul className="kin">
            {kin.map((k) => (
              <li key={k.id}>
                <span className="dot" style={{ background: colorOf(s.tree.people[k.id].sex) }} />
                <span className="role">{k.label}</span>
                <span className="who" onClick={() => onGoTo(k.id)} title={t("ed.showOnTree")}>
                  {s.tree.people[k.id].name}
                </span>
                <span style={{ fontSize: 11 }}>{yearTag(s.tree.people[k.id])}</span>
                {cutOf(k) && (
                  <button className="cut" onClick={cutOf(k) ?? undefined} title={t("ed.cutTitle")}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row">
        <button
          onClick={() => d({ type: "hideAbove", id: p.id })}
          disabled={!parents.length}
          title={t("ed.hideAboveTitle")}
        >
          {t("ed.hideAbove")}
        </button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(t("confirm.delete", { name: p.name }))) d({ type: "remove", id: p.id });
          }}
        >
          {t("ed.delete")}
        </button>
      </div>
    </div>
  );
}
