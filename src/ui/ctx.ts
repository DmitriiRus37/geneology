import { createContext, useContext, type ActionDispatch } from "react";
import type { Lang } from "../i18n.ts";
import type { Action, AppState } from "../model/store.ts";

export interface AppCtxValue {
  s: AppState;
  d: ActionDispatch<[Action]>;
  /** язык интерфейса и строка по ключу словаря */
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

export const AppCtx = createContext<AppCtxValue | null>(null);

export function useApp(): AppCtxValue {
  const v = useContext(AppCtx);
  if (!v) throw new Error("AppCtx не найден");
  return v;
}
