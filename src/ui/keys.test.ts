import assert from "node:assert/strict";
import { test } from "node:test";
import { isField, keyCommand, type KeyContext } from "./keys.ts";

const idle: KeyContext = { picking: false, selected: "p1", onPage: true, typing: false };
const key = (k: string, o: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...o,
});

test("keys: undo, leaving a pick or a selection, deleting the selected person", () => {
  assert.equal(keyCommand(key("z", { ctrlKey: true }), idle), "undo");
  assert.equal(keyCommand(key("z", { metaKey: true }), idle), "undo");
  assert.equal(keyCommand(key("Escape"), { ...idle, picking: true }), "unpick");
  assert.equal(keyCommand(key("Escape"), idle), "deselect");
  assert.equal(keyCommand(key("Backspace"), idle), "delete");
  assert.equal(keyCommand(key("Delete"), { ...idle, onPage: false }), null, "not while the focus is elsewhere");
  assert.equal(keyCommand(key("Delete"), { ...idle, selected: null }), null);
});

test("keys: ⌘Z and ⇧⌘Z belong to the field while typing in it", () => {
  const typing: KeyContext = { ...idle, onPage: false, typing: true };
  assert.equal(keyCommand(key("z", { metaKey: true }), typing), null, "⌘Z is the field's text undo");
  assert.equal(keyCommand(key("z", { ctrlKey: true }), typing), null, "Ctrl+Z is the field's text undo");
  assert.equal(keyCommand(key("Z", { metaKey: true, shiftKey: true }), typing), null, "⇧⌘Z is the field's text redo");
  assert.equal(keyCommand(key("Z", { ctrlKey: true, shiftKey: true }), typing), null, "Ctrl+Shift+Z is the field's text redo");
});

test("keys: outside a field ⌘Z undoes a step even with a button focused, and Shift makes it a redo the app does not have", () => {
  const onButton: KeyContext = { ...idle, onPage: false };
  assert.equal(keyCommand(key("z", { metaKey: true }), onButton), "undo");
  assert.equal(keyCommand(key("Z", { metaKey: true, shiftKey: true }), idle), null);
  assert.equal(keyCommand(key("Z", { ctrlKey: true, shiftKey: true }), idle), null);
  assert.equal(keyCommand(key("z"), idle), null, "a plain z is just a letter");
});

test("keys: text inputs, text areas, selects and editable elements count as fields", () => {
  assert.equal(isField({ tagName: "INPUT" }), true);
  assert.equal(isField({ tagName: "TEXTAREA" }), true);
  assert.equal(isField({ tagName: "SELECT" }), true);
  assert.equal(isField({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(isField({ tagName: "BUTTON", isContentEditable: false }), false);
  assert.equal(isField({ tagName: "BODY", isContentEditable: false }), false);
  assert.equal(isField({ tagName: "svg" }), false);
  assert.equal(isField(null), false);
});
