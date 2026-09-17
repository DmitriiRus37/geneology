import type { TreeState } from "../model/types.ts";

const API = "/api/tree";

/** Отпечаток папки, который мы видели последним. С ним же и пишем. */
let rev = "";

export interface DiskInfo {
  /** куда именно пишутся файлы — показываем человеку */
  dir: string;
  tree: TreeState | null;
  /** сервер старой версии: отпечатков не знает, писать в него нельзя */
  stale: boolean;
}

export type SaveResult = "ok" | "conflict" | "offline";

/**
 * Есть ли рядом локальный сервер, который умеет писать в persons/.
 * Если приложение открыто файлом с диска, запрос просто не уйдёт — вернём null
 * и будем хранить всё в браузере, как раньше.
 */
export async function probeDisk(): Promise<DiskInfo | null> {
  try {
    const r = await fetch(API, { signal: AbortSignal.timeout(2500), cache: "no-store" });
    if (!r.ok) return null;
    const body = await r.json();
    if (!body || !body.ok) return null;
    // старый сервер не присылает отпечаток и понял бы новую запись как «людей нет»
    const stale = typeof body.rev !== "string" || !body.rev;
    rev = stale ? "" : String(body.rev);
    return { dir: String(body.dir || "persons"), tree: body.tree ?? null, stale };
  } catch {
    return null;
  }
}

/** Перечитать древо с диска и снова встать в ногу с ним. */
export async function reloadDisk(): Promise<TreeState | null> {
  const info = await probeDisk();
  return info ? info.tree : null;
}

/**
 * Запись идёт только если на диске с нашего последнего чтения ничего не менялось.
 * Иначе сервер откажет, и мы не затрём чужие правки — например, те, что сделаны
 * в другой вкладке, пока эта лежала открытой.
 */
export async function saveDisk(tree: TreeState): Promise<SaveResult> {
  try {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rev, tree }),
    });
    const body = await r.json().catch(() => null);
    if (r.status === 409) return "conflict";
    if (!r.ok || !body || !body.ok) return "offline";
    if (body.rev) rev = String(body.rev);
    return "ok";
  } catch {
    return "offline";
  }
}

/** Последняя запись при закрытии вкладки: обычный fetch браузер уже не дождётся. */
export function flushDisk(tree: TreeState): void {
  try {
    navigator.sendBeacon(API, new Blob([JSON.stringify({ rev, tree })], { type: "application/json" }));
  } catch {
    /* закрываемся — жаловаться некому */
  }
}
