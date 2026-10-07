/** What a key press on the page means. */

export type KeyCommand = "undo" | "unpick" | "deselect" | "delete" | null;

export interface KeyContext {
  /** a relative is being picked on the canvas */
  picking: boolean;
  selected: string | null;
  /** nothing has the focus: the key went to the page itself, not to a field */
  onPage: boolean;
}

export function keyCommand(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">, c: KeyContext): KeyCommand {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") return "undo";
  if (e.key === "Escape") return c.picking ? "unpick" : "deselect";
  if ((e.key === "Delete" || e.key === "Backspace") && c.selected && c.onPage) return "delete";
  return null;
}
