import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDateInput } from "../model/dates.ts";
import { matches, norm } from "../model/names.ts";
import type { Relation } from "../model/store.ts";
import type { PersonSpec } from "../model/tree.ts";
import type { Person, Sex } from "../model/types.ts";
import { DateField, PersonLine, Seg, useDismiss, useNameField } from "./bits.tsx";
import { useApp } from "./ctx.ts";

export interface PopSpot {
  /** coordinates inside the canvas; none on a phone, where the stylesheet places the window */
  x?: number;
  y?: number;
  mode: Relation | null;
  anchor: string | null;
}

interface Props {
  spot: PopSpot;
  people: Record<string, Person>;
  onCreate: (spec: PersonSpec, mode: Relation | null) => void;
  onExisting: (id: string, mode: Relation | null) => void;
  onClose: () => void;
}

const TITLE: Record<Relation, string> = {
  parent: "pop.forParent",
  child: "pop.forChild",
  spouse: "pop.forSpouse",
  sibling: "pop.forSibling",
};

/** Sex: guessed from the name by default, but it can be stated outright. */
const SEX: { v: Sex | "auto"; t: string }[] = [
  { v: "auto", t: "pop.sexAuto" },
  { v: "m", t: "pop.male" },
  { v: "f", t: "pop.female" },
];

const CHOICE: { mode: Relation | null; label: string }[] = [
  { mode: "parent", label: "pop.chParent" },
  { mode: "child", label: "pop.chChild" },
  { mode: "spouse", label: "pop.chSpouse" },
  { mode: "sibling", label: "pop.chSibling" },
  { mode: null, label: "pop.chNone" },
];

export function AddPopover({ spot, people, onCreate, onExisting, onClose }: Props) {
  const { t } = useApp();
  const [text, setText] = useState("");
  const [born, setBorn] = useState("");
  const [died, setDied] = useState("");
  const [sex, setSex] = useState<Sex | "auto">("auto");
  const [mode, setMode] = useState<Relation | null>(spot.mode);
  const [cursor, setCursor] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const nameField = useNameField();

  useEffect(() => {
    input.current?.focus();
  }, []);

  // The input field catches Escape — it also has to stop the bubbling so the canvas
  // does not clear the selection along with it; hence only the outside click here.
  useDismiss(box, onClose, false);

  const found = useMemo(() => {
    const q = text.trim();
    if (q.length < 1) return [];
    return Object.keys(people)
      .filter((id) => id !== spot.anchor && matches(people[id], q))
      .sort((a, b) => people[a].name.localeCompare(people[b].name, "ru"))
      .slice(0, 6);
  }, [text, people, spot.anchor]);

  const twin = useMemo(() => {
    const q = norm(text);
    return q ? found.find((id) => norm(people[id].name) === q) ?? null : null;
  }, [found, people, text]);

  // "Add" and Enter always create a new person, namesake or not. Only an explicit
  // pick from the list links an existing one: a click, or the arrow keys with Enter.
  const submit = () => {
    if (cursor >= 0 && found[cursor]) {
      onExisting(found[cursor], mode);
      return;
    }
    const name = text.trim();
    if (!name) return;
    onCreate(
      {
        name,
        born: normalizeDateInput(born),
        died: normalizeDateInput(died),
        sex: sex === "auto" ? undefined : sex,
      },
      mode,
    );
  };

  /** Enter in any field adds, Escape closes. */
  const keys = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const anchorName = spot.anchor && people[spot.anchor] ? people[spot.anchor].name : "";

  return (
    <div className="pop" ref={box} style={{ left: spot.x, top: spot.y }}>
      <h3>
        {mode && anchorName ? (
          <>
            {t(TITLE[mode])}: <b>{anchorName}</b>
          </>
        ) : (
          t("pop.new")
        )}
      </h3>

      {anchorName && (
        <p className="who-for">{t("pop.whoFor", { name: anchorName })}</p>
      )}
      {anchorName && (
        <div className="choice">
          {CHOICE.map((c) => (
            <button
              key={c.label}
              className={mode === c.mode ? "on" : ""}
              onClick={() => {
                setMode(c.mode);
                setCursor(-1);
                input.current?.focus();
              }}
              title={c.mode ? t(TITLE[c.mode]) + " «" + anchorName + "»" : t("pop.noLink")}
            >
              {t(c.label)}
            </button>
          ))}
        </div>
      )}

      <input
        ref={input}
        type="text"
        value={text}
        placeholder={t("pop.namePh")}
        autoComplete="off"
        {...nameField}
        onChange={(e) => {
          setText(e.target.value);
          setCursor(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && found.length) {
            e.preventDefault();
            setCursor((c) => (c + 1) % found.length);
          } else if (e.key === "ArrowUp" && found.length) {
            e.preventDefault();
            setCursor((c) => (c <= 0 ? found.length - 1 : c - 1));
          } else keys(e);
        }}
      />
      <div className="row dates">
        <DateField value={born} set={setBorn} placeholder={t("pop.bornPh")} onKeyDown={keys} />
        <DateField value={died} set={setDied} placeholder={t("pop.diedPh")} onKeyDown={keys} />
      </div>
      <Seg
        options={SEX.map((x) => ({ v: x.v, label: t(x.t) }))}
        value={sex}
        onPick={setSex}
        title={t("pop.sexTitle")}
      />

      <div className="row">
        <button className="primary" onClick={submit} disabled={!text.trim()}>
          {t("pop.add")}
        </button>
        <button className="quiet" onClick={onClose}>
          {t("pop.cancel")}
        </button>
      </div>

      {found.length > 0 && (
        <>
          <p className="hintline">
            {mode ? t("pop.linkExisting") : t("pop.namesakes")}
          </p>
          <ul className="sugg">
            {found.map((id, i) => (
              <li
                key={id}
                className={i === cursor ? "on" : ""}
                onClick={() => onExisting(id, mode)}
              >
                <PersonLine p={people[id]} />
              </li>
            ))}
          </ul>
        </>
      )}

      {twin && <p className="warn">{t("pop.twin")}</p>}

      {!anchorName && !found.length && (
        <p className="hintline">{t("pop.hintLone")}</p>
      )}
      {anchorName && !mode && !found.length && (
        <p className="hintline">{t("pop.hintNone")}</p>
      )}
    </div>
  );
}
