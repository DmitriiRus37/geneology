import assert from "node:assert/strict";
import { test } from "node:test";
import { keyCommand, type KeyContext } from "./keys.ts";

const idle: KeyContext = { picking: false, selected: "p1", onPage: true };

test("keys: undo, leaving a pick or a selection, deleting the selected person", () => {
  assert.equal(keyCommand({ key: "z", ctrlKey: true, metaKey: false }, idle), "undo");
  assert.equal(keyCommand({ key: "Escape", ctrlKey: false, metaKey: false }, { ...idle, picking: true }), "unpick");
  assert.equal(keyCommand({ key: "Escape", ctrlKey: false, metaKey: false }, idle), "deselect");
  assert.equal(keyCommand({ key: "Backspace", ctrlKey: false, metaKey: false }, idle), "delete");
  assert.equal(keyCommand({ key: "Delete", ctrlKey: false, metaKey: false }, { ...idle, onPage: false }), null, "not while typing");
  assert.equal(keyCommand({ key: "Delete", ctrlKey: false, metaKey: false }, { ...idle, selected: null }), null);
});

test("known issue: ⌘Z and ⇧⌘Z undo a whole step even while typing in a field", () => {
  const typing: KeyContext = { ...idle, onPage: false };
  const inField = { key: "z", ctrlKey: false, metaKey: true, shiftKey: false, target: { tagName: "INPUT" } };
  assert.equal(keyCommand(inField, typing), "undo");
  const redo = { ...inField, key: "Z", shiftKey: true };
  assert.equal(keyCommand(redo, typing), "undo");
});
