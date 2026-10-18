/** What a key press on the page means. */

export type KeyCommand = "undo" | "unpick" | "deselect" | "delete" | null;

export interface KeyContext {
  /** a relative is being picked on the canvas */
  picking: boolean;
  selected: string | null;
  /** nothing has the focus: the key went to the page itself, not to a field */
  onPage: boolean;
  /** the focus is in a text field: ⌘Z there is the field's own text undo */
  typing: boolean;
}

const FIELDS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** Whether the element that has the focus is a field the person types into. */
export function isField(el: { tagName: string; isContentEditable?: boolean } | null): boolean {
  return !!el && (FIELDS.has(el.tagName) || el.isContentEditable === true);
}

export function keyCommand(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">, c: KeyContext): KeyCommand {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    // in a field both belong to the browser's text undo; with Shift it is a redo, which the app does not have
    return c.typing || e.shiftKey ? null : "undo";
  }
  if (e.key === "Escape") return c.picking ? "unpick" : "deselect";
  if ((e.key === "Delete" || e.key === "Backspace") && c.selected && c.onPage) return "delete";
  return null;
}
