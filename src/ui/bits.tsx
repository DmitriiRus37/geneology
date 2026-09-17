/** Small interface pieces needed in several windows at once. */
import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { normalizeDateInput, yearTag } from "../model/dates.ts";
import { colorOf } from "../model/names.ts";
import type { Person } from "../model/types.ts";

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
