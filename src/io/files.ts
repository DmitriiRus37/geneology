import type { TreeState } from "../model/types.ts";

export function download(name: string, blob: Blob): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function saveJson(tree: TreeState): void {
  download("genealogy.json", new Blob([JSON.stringify(tree, null, 2)], { type: "application/json" }));
}

export function readJson(file: File): Promise<unknown> {
  return new Promise((res, rej) => {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(String(rd.result));
        if (!d || !d.people) throw new Error("no people");
        res(d);
      } catch (e) {
        rej(e);
      }
    };
    rd.onerror = () => rej(new Error("the file could not be read"));
    rd.readAsText(file);
  });
}
