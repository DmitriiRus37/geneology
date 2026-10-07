/**
 * The sync engine wired into React: the browser's network, timers, storage and
 * beacon go in, `where` and the loaded trees come out. The effects keep the order
 * and the dependencies the autosave has always had.
 */
import { useEffect, useRef, useState, type Dispatch } from "react";
import { download } from "../io/files.ts";
import { store } from "../io/local.ts";
import { createSync, type Sync, type Where } from "../io/sync.ts";
import type { Action } from "../model/store.ts";
import type { TreeState } from "../model/types.ts";

export interface SyncHandle {
  where: Where;
  reread: Sync["reread"];
  upload: Sync["upload"];
  download: Sync["download"];
}

export function useSync(tree: TreeState, selected: string | null, d: Dispatch<Action>): SyncHandle {
  const [where, setWhere] = useState<Where>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const [sync] = useState(() =>
    createSync(
      {
        fetch: (input, init) => fetch(input, init),
        later: (fn, ms) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        },
        keep: store,
        beacon: (url, body) => navigator.sendBeacon(url, body),
        save: download,
      },
      {
        setWhere,
        load: (t, notice) => d({ type: "load", tree: t, silent: true, notice }),
        notice: (m) => d({ type: "notice", msg: m }),
      },
    ),
  );

  // a local server may be running alongside — then we write to files rather than to the browser
  useEffect(() => sync.start(() => treeRef.current), [sync]);

  // Every change goes off to disk (or to the browser when there is no server) a second
  // after the last edit, so as not to write a file for every letter. But if another
  // person was selected or a text field was left, there is nothing to wait for — we
  // write at once.
  const [flushSeq, setFlushSeq] = useState(0);
  useEffect(() => {
    setFlushSeq((n) => n + 1);
  }, [selected]);
  useEffect(() => {
    const onBlur = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) setFlushSeq((n) => n + 1);
    };
    document.addEventListener("focusout", onBlur);
    return () => document.removeEventListener("focusout", onBlur);
  }, []);
  useEffect(() => sync.commit(tree, where, flushSeq));
  useEffect(() => () => sync.stop(), [sync]);

  // the tab is being closed — we write out whatever did not get away in time
  useEffect(() => {
    if (where?.kind !== "disk" || where.blocked) return;
    const bye = () => sync.flush(treeRef.current);
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [where, sync]);

  return { where, reread: sync.reread, upload: sync.upload, download: sync.download };
}
