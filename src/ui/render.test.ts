/**
 * Snapshots of what the interface draws, rendered to plain HTML in Node. Node cannot
 * read JSX by itself; the test command loads `src/testing/tsx.ts`, which compiles the
 * components with the same Oxc transform Vite builds the app with.
 *
 * A static render runs no effects: this pins the markup — which parts are drawn, in
 * which order, with which classes and texts — not the behaviour. The behaviour is
 * played in a DOM in `src/ui/app.test.ts`.
 *
 * The trees are synthetic: no real names end up in the snapshots.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement as h, type ComponentType, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Where } from "../io/sync.ts";
import { t as translate, type Lang } from "../i18n.ts";
import { layout } from "../layout/layout.ts";
import { initialAppState, type AppState } from "../model/store.ts";
import { synthTree } from "../testing/trees.ts";
import { nodeCards } from "../testing/cards.ts";

type Components = Record<string, ComponentType<any>>;

let ui: Components = {};
/** what the screen answers to the phone media query while a test renders */
let narrow = false;

before(async () => {
  Object.assign(globalThis, {
    window: { matchMedia: () => ({ matches: narrow, addEventListener() {}, removeEventListener() {} }) },
  });
  for (const file of ["Sidebar.tsx", "Toolbar.tsx", "AddPopover.tsx", "EdgeMenu.tsx", "Board.tsx", "ctx.ts"]) {
    Object.assign(ui, await import("./" + file));
  }
});

after(() => {
  Reflect.deleteProperty(globalThis, "window");
});

const noop = () => {};

function draw(el: ReactElement, s: AppState, lang: Lang = "ru"): string {
  const value = { s, d: noop, lang, setLang: noop, t: (k: string, v?: Record<string, string | number>) => translate(lang, k, v) };
  return renderToStaticMarkup(h(ui.AppCtx as unknown as ComponentType<{ value: unknown; children?: ReactNode }>, { value }, el));
}

const small = () => initialAppState(synthTree({ seed: 7, size: 6 }));
const first = (s: AppState) => Object.keys(s.tree.people)[0];

const DISK: Where = { kind: "disk", dir: "/data/persons", store: "disk", guarded: false, role: "admin", blocked: null };

function sidebar(where: Where = DISK, filter = "") {
  return h(ui.Sidebar, {
    filter,
    setFilter: noop,
    onAdd: noop,
    onAddRelation: noop,
    onPick: noop,
    onGoTo: noop,
    bbox: null,
    where,
    onReread: noop,
    onUpload: noop,
    onDownload: noop,
    onSheet: noop,
  });
}

test("the side panel on a desktop, with nobody selected", (t) => {
  narrow = false;
  const s = small();
  t.assert.snapshot(draw(sidebar(), s));
});

test("the side panel with someone selected shows the editor", (t) => {
  narrow = false;
  const s = { ...small() };
  s.selected = first(s);
  t.assert.snapshot(draw(sidebar(), s));
});

test("the side panel on a phone: the search and a short add button in the head", (t) => {
  narrow = true;
  const s = small();
  t.assert.snapshot(draw(sidebar(DISK, "Орл"), s));
});

test("the side panel in English", (t) => {
  narrow = false;
  const s = small();
  t.assert.snapshot(draw(sidebar(), s, "en"));
});

test("the footer for each place the tree can live", (t) => {
  narrow = false;
  const s = initialAppState(synthTree({ seed: 7, size: 2 }));
  const places: Record<string, Where> = {
    disk: DISK,
    memoryWithAdmin: { kind: "disk", dir: "server memory", store: "memory", guarded: true, role: "admin", blocked: null },
    browser: { kind: "browser" },
    conflict: { ...DISK, blocked: "conflict" },
    stale: { ...DISK, blocked: "stale" },
    unknown: null,
  };
  const footer = (html: string) => html.slice(html.indexOf('<div class="rail-foot">'));
  t.assert.snapshot(Object.fromEntries(Object.entries(places).map(([k, w]) => [k, footer(draw(sidebar(w), s))])));
});

test("on a phone a tab that cannot save says so in the head of the sheet too, with the way out", (t) => {
  narrow = true;
  t.after(() => {
    narrow = false;
  });
  const s = small();
  const head = (html: string) => html.slice(html.indexOf('<div class="rail-head">'), html.indexOf('<div class="rail-scroll">'));
  const foot = (html: string) => html.slice(html.indexOf('<div class="rail-foot">'));
  const cases = [
    ["conflict", "where.conflictShort", "where.reread"],
    ["stale", "where.staleShort", "where.recheck"],
  ] as const;
  for (const [blocked, status, button] of cases) {
    const panel = draw(sidebar({ ...DISK, blocked }), s);
    assert.ok(head(panel).includes(translate("ru", status)), blocked + ": the status is in the head");
    assert.ok(head(panel).includes(translate("ru", button)), blocked + ": and so is the button");
    assert.ok(foot(panel).includes(translate("ru", "where." + blocked)), blocked + ": the footer keeps its status");
    assert.ok(foot(panel).includes(translate("ru", button)), blocked + ": and its button");
  }
  assert.ok(!head(draw(sidebar(DISK), s)).includes('class="where'), "while it saves, the head is as it was");

  narrow = false;
  const desk = head(draw(sidebar({ ...DISK, blocked: "conflict" }), s));
  assert.ok(!desk.includes('class="where') && !desk.includes(translate("ru", "where.reread")), "a desktop keeps it in the footer");

  narrow = true;
  t.assert.snapshot(head(draw(sidebar({ ...DISK, blocked: "conflict" }), s)));
});

test("the bar over the canvas, with and without hidden people", (t) => {
  const s = small();
  const hidden = { ...s, tree: { ...s.tree, hidden: [first(s)] } };
  t.assert.snapshot({
    plain: draw(h(ui.Toolbar, { onFit: noop, onZoom: noop }), s),
    withHidden: draw(h(ui.Toolbar, { onFit: noop, onZoom: noop }), hidden),
  });
});

test("the add card, for a relative and on its own", (t) => {
  const s = small();
  const card = (mode: string | null, anchor: string | null) =>
    draw(h(ui.AddPopover, { spot: { x: 10, y: 20, mode, anchor }, people: s.tree.people, onCreate: noop, onExisting: noop, onClose: noop }), s);
  t.assert.snapshot({ child: card("child", first(s)), alone: card(null, null) });
});

test("the menu of a couple's line", (t) => {
  const s = small();
  const pair = s.tree.pairs[0];
  const children = s.tree.links.filter((l) => l.parent === pair.a).map((l) => l.child);
  t.assert.snapshot(
    draw(
      h(ui.EdgeMenu, {
        spot: { x: 10, y: 20, ref: { kind: "couple", a: pair.a, b: pair.b, children } },
        people: s.tree.people,
        pairs: s.tree.pairs,
        onCut: noop,
        onUnmarry: noop,
        onUnsibling: noop,
        onClose: noop,
      }),
      s,
    ),
  );
});

test("the canvas: plain, with someone selected, and while picking a person", (t) => {
  narrow = false;
  const s = initialAppState(synthTree({ seed: 11, size: 10 }));
  const lay = layout(s.tree, nodeCards());
  const board = (state: AppState, pick: unknown) =>
    draw(h(ui.Board, { layout: lay, filter: "", pick, onPickDone: noop, sheet: 0 }), state);
  const id = first(s);
  t.assert.snapshot({
    plain: board(s, null),
    selected: board({ ...s, selected: id }, null),
    picking: board(s, { mode: "child", from: id }),
  });
});
