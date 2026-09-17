/** Мелочи интерфейса, которые нужны сразу в нескольких окнах. */
import { useEffect, type KeyboardEvent, type RefObject } from "react";
import { normalizeDateInput, yearTag } from "../model/dates.ts";
import { colorOf } from "../model/names.ts";
import type { Person } from "../model/types.ts";

/**
 * Закрыть окошко щелчком мимо него и по Escape. Слушателя вешаем следующим
 * кадром, иначе окно закроется от того же щелчка, которым его открыли.
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
 * Поле даты. На выходе из него голый год превращается в «??.??.1995»: видно,
 * что день и месяц неизвестны, а не забыты.
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

/** Ряд кнопок, из которых нажата одна: пол, язык. */
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

/** Строка человека в списке: знак пола, имя, годы. */
export function PersonLine({ p, tag = yearTag(p) }: { p: Person; tag?: string }) {
  return (
    <>
      <span className="dot" style={{ background: colorOf(p.sex) }} />
      <span className="nm">{p.name}</span>
      {tag ? <span className="yr">{tag}</span> : null}
    </>
  );
}
