/** Small interface pieces needed in several windows at once. */
import { useEffect, useState, type KeyboardEvent, type RefObject } from "react";
import { normalizeDateInput, yearTag } from "../model/dates.ts";
import { colorOf } from "../model/names.ts";
import type { Person } from "../model/types.ts";

/** When the phone layout takes over. Character for character the query in the stylesheet. */
const NARROW = "(max-width: 860px), (max-height: 500px) and (max-width: 1000px)";

/**
 * Is the screen a phone? The stylesheet does most of the phone work on its own, but
 * the sheet has to be measured and the canvas has to know how much of itself is
 * covered, and neither can be answered in CSS.
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/**
 * The attributes of a field holding a person's name, on a phone: its keyboard would
 * otherwise "correct" a surname or a patronymic it does not know into a word it does,
 * and start only the first word with a capital. On a desktop the field stays as it was.
 */
export function useNameField(): { autoCorrect?: string; autoCapitalize?: string; spellCheck?: boolean } {
  return useNarrow() ? NAME_FIELD : NO_ATTRS;
}
const NAME_FIELD = { autoCorrect: "off", autoCapitalize: "words", spellCheck: false };
const NO_ATTRS = {};

/**
 * Close a popover with a click outside it and with Escape. The listener is attached on
 * the next frame, otherwise the window would close on the very click that opened it.
 */
export function useDismiss(box: RefObject<HTMLElement | null>, onClose: () => void, onEscape = true): void {
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as globalThis.Node)) onClose();
    };
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => document.addEventListener("pointerdown", away), 0);
    if (onEscape) document.addEventListener("keydown", esc);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [box, onClose, onEscape]);
}

/**
 * A date field. On leaving it a bare year turns into "??.??.1995": it is then visible
 * that the day and the month are unknown rather than forgotten.
 */
export function DateField({
  value,
  set,
  placeholder,
  onKeyDown,
}: {
  value: string;
  set: (v: string) => void;
  placeholder: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => set(e.target.value)}
      onBlur={() => {
        const v = normalizeDateInput(value);
        if (v !== value) set(v);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

export interface SegOption<T extends string> {
  v: T;
  label: string;
}

/** A row of buttons with one of them pressed: sex, language. */
export function Seg<T extends string>({
  options,
  value,
  onPick,
  className,
  title,
}: {
  options: SegOption<T>[];
  value: T;
  onPick: (v: T) => void;
  className?: string;
  title?: string;
}) {
  return (
    <div className={className ? "seg " + className : "seg"} title={title}>
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? "on" : ""} onClick={() => onPick(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A person's line in the list: the sex mark, the name, the years. */
export function PersonLine({ p, tag = yearTag(p) }: { p: Person; tag?: string }) {
  return (
    <>
      <span className="dot" style={{ background: colorOf(p.sex) }} />
      <span className="nm">{p.name}</span>
      {tag ? <span className="yr">{tag}</span> : null}
    </>
  );
}
