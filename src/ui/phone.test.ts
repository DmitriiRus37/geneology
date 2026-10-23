/**
 * The app on a phone-sized window: the side panel becomes a sheet over the canvas,
 * dragged and tapped between three heights, and the windows over the canvas lose
 * their coordinates to the stylesheet. Against a real test server, in English.
 */
import { $, $$, browser, answers, byText, click, fire, key, mount, nodeFetch, pointer, setRect, settle, type, until, type Mounted } from "../testing/dom.ts";
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import { card, getTree, postTree, startServer, type Running } from "../../server/testing.ts";
import { t } from "../i18n.ts";

const { createElement: h } = await import("react");
const { App } = await import("../App.tsx");
const en = (k: string, v?: Record<string, string | number>) => t("en", k, v);

const HEAD = 64;
const RULER = 76;
const SCREEN = 812;

before(() => {
  browser.setViewport({ width: 375, height: SCREEN });
  // what a browser would lay out: the head and the ruler have their heights, the
  // sheet is as tall as its style says
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("rail-head")) return HEAD;
      if (this.classList.contains("ruler")) return RULER;
      if (this.id === "rail") return parseFloat(this.style.height) || HEAD;
      return 0;
    },
  });
  HTMLElement.prototype.scrollTo = function () {};
});

const outside = <T>(job: () => Promise<T>): Promise<T> => {
  const page = globalThis.fetch;
  globalThis.fetch = nodeFetch;
  return job().finally(() => (globalThis.fetch = page));
};

let open: { srv: Running; app: Mounted } | null = null;
afterEach(async () => {
  if (!open) return;
  await open.app.unmount();
  await open.srv.stop();
  open = null;
  answers.confirm = true;
});

async function openPhone(): Promise<Running> {
  const srv = await outside(() =>
    startServer({
      files: {
        "a.json": card("a", "Ivan Petrov", { sex: "m" }),
        "b.json": card("b", "Maria Petrova", { sex: "f" }),
        "c.json": card("c", "Oleg Petrov", { sex: "m", parents: ["a", "b"] }),
      },
    }),
  );
  browser.setURL(srv.base + "/");
  localStorage.setItem("genealogy:lang", "en");
  setRect("board", { left: 0, top: 0, width: 375, height: SCREEN });
  setRect("tree", { left: 0, top: 0, width: 375, height: SCREEN });
  const app = await mount(h(App)).catch(async (e) => {
    await srv.stop();
    throw e;
  });
  open = { srv, app };
  await until(() => !$(".rail-foot .where").textContent?.includes("…"), "the app to find the server", 15_000);
  return srv;
}

const rail = () => $("#rail");
const height = () => parseFloat(rail().style.height);
const grab = () => $(".grab");
const half = Math.min(SCREEN - RULER - 40, Math.max(HEAD + 120, Math.round(SCREEN * 0.56)));

async function tapGrab() {
  await pointer(grab(), "pointerdown", 100, 700, { pointerType: "touch" });
  await pointer(grab(), "pointerup", 100, 702, { pointerType: "touch" });
}

test("the sheet: its head on a phone, and a tap or the keyboard between the low stops", async () => {
  await openPhone();
  assert.equal(height(), HEAD, "it opens lowered to its head");
  assert.ok(rail().classList.contains("shut"));
  assert.equal(grab().getAttribute("aria-label"), en("rail.expand"));
  assert.equal(byText(en("rail.addShort")).getAttribute("aria-label"), en("rail.add"), "a short add button in the head");
  assert.equal($$(".rail-head #search").length, 1, "and the search");

  await tapGrab();
  assert.equal(height(), half);
  assert.ok(!rail().classList.contains("shut"));
  await tapGrab();
  assert.equal(height(), HEAD);

  await key(grab(), "Enter");
  assert.equal(height(), half);
  await key(grab(), "x");
  assert.equal(height(), half, "other keys do nothing");
  await key(grab(), " ");
  assert.equal(height(), HEAD);
});

test("the sheet follows a finger, settles at the nearest stop, and a flick carries it on", async () => {
  await openPhone();
  const drag = async (from: number, to: number, ms: number) => {
    const h0 = height();
    await pointer(grab(), "pointerdown", 100, from, { pointerType: "touch" });
    await pointer(grab(), "pointermove", 100, (from + to) / 2, { pointerType: "touch" });
    assert.ok(rail().classList.contains("dragging"));
    if (ms) await new Promise((r) => setTimeout(r, ms));
    await pointer(grab(), "pointermove", 100, to, { pointerType: "touch" });
    assert.equal(height(), Math.max(HEAD, Math.min(SCREEN - RULER, h0 + (from - to))), "the sheet is where the finger is");
    if (ms) await new Promise((r) => setTimeout(r, ms));
    await pointer(grab(), "pointerup", 100, to, { pointerType: "touch" });
  };

  // slowly, to just past the middle stop: it settles there
  await drag(780, 780 - (half - HEAD) - 30, 120);
  assert.equal(height(), half);
  // slowly almost all the way up: the top stop
  await drag(500, 0, 120);
  assert.equal(height(), SCREEN - RULER);
  // slowly down to a little above the head: back to the head
  await drag(100, 800, 120);
  assert.equal(height(), HEAD);

  // the system takes the finger: the sheet goes back to where it stood
  await pointer(grab(), "pointerdown", 100, 700, { pointerType: "touch" });
  await pointer(grab(), "pointermove", 100, 500, { pointerType: "touch" });
  await pointer(grab(), "pointercancel", 100, 500, { pointerType: "touch" });
  assert.equal(height(), HEAD);
  assert.ok(!rail().classList.contains("dragging"));

  // a second finger does not drag
  await pointer(grab(), "pointerdown", 100, 700, { pointerType: "touch", isPrimary: false });
  assert.ok(!rail().classList.contains("dragging"));

  // a quick flick up from the head goes on to the next stop
  await pointer(grab(), "pointerdown", 100, 700, { pointerType: "touch" });
  for (let y = 690; y >= 640; y -= 10) await pointer(grab(), "pointermove", 100, y, { pointerType: "touch" });
  await pointer(grab(), "pointerup", 100, 640, { pointerType: "touch" });
  assert.ok(height() >= half, "flicked up past the middle: " + height());
  // and a quick flick down goes back
  await pointer(grab(), "pointerdown", 100, 300, { pointerType: "touch" });
  for (let y = 310; y <= 360; y += 10) await pointer(grab(), "pointermove", 100, y, { pointerType: "touch" });
  await pointer(grab(), "pointerup", 100, 360, { pointerType: "touch" });
  assert.ok(height() < SCREEN - RULER, "flicked down: " + height());
});

test("a person selected on the tree brings the sheet up, and leaving the selection takes it down", async () => {
  await openPhone();
  await pointer($('#nodes .node[data-id="c"]'), "pointerdown", 200, 300, { pointerType: "touch" });
  await pointer($("#tree"), "pointerup", 200, 300, { pointerType: "touch" });
  await settle(10);
  assert.equal(height(), half, "up to show the fields");
  assert.equal(($("#editor input[type=text]") as HTMLInputElement).value, "Oleg Petrov");

  // the next tap must land on the tree: picking lowers the sheet
  await click(byText(en("ed.marriage"), "#editor button"));
  assert.equal(height(), HEAD);
  await click(byText(en("pick.cancel"), "#pickbar button"));

  await key(document.body, "Escape");
  assert.equal($$("#editor").length, 0);

  await tapGrab();
  await fire($("#people"), new Event("focusin", { bubbles: true }));
  const field = $(".rail-head #search");
  await fire(field, new FocusEvent("focusin", { bubbles: true }));
  assert.equal(height(), SCREEN - RULER, "a text field takes the sheet to the top, above the keyboard");

  await click(byText("Ivan Petrov", "#people li"));
  assert.equal(height(), half, "picked from the list at the top: the sheet steps down to show the tree");
});

test("the search in the head of the sheet: clearing it keeps the keyboard, Enter puts it away", async () => {
  await openPhone();
  const search = $(".rail-head #search") as HTMLInputElement;
  await type(search, "Petrova");
  assert.deepEqual(
    $$("#people li .nm").map((n) => n.textContent),
    ["Maria Petrova"],
  );
  assert.equal($$("#nodes .node.dim").length, 2, "the others are dimmed on the tree");
  search.focus();
  const clear = $(".find .clear");
  await pointer(clear, "pointerdown", 0, 0, { pointerType: "touch" });
  await click(clear);
  assert.equal(search.value, "");
  assert.equal($$(".find .clear").length, 0);
  assert.equal(document.activeElement, search, "the field keeps the focus");

  await type(search, "zzz");
  assert.equal($("#people + .empty-note").textContent, en("rail.nobodyFound"));
  await key(search, "Enter");
  assert.notEqual(document.activeElement, search);
  await pointer($(".find .clear"), "pointerdown", 0, 0, { pointerType: "touch" });
  await click($(".find .clear"));
  assert.equal(search.value, "");
});

test("on a phone the windows over the canvas are placed by the stylesheet", async () => {
  await openPhone();
  await click(byText(en("rail.addShort")));
  assert.equal($(".pop").style.left, "", "no coordinates for the add card");
  await click(byText(en("pop.cancel"), ".pop button"));

  await pointer($$("#edges path.hit")[0], "pointerdown", 200, 400, { pointerType: "mouse" });
  await pointer($("#tree"), "pointerup", 200, 400, { pointerType: "mouse" });
  assert.equal($(".edge-pop").style.left, "", "nor for a line's menu");
});

test("a tab that cannot save says so in the head of the sheet, with the way out", async () => {
  const srv = await openPhone();
  const now = await outside(() => getTree(srv.base));
  now.body.tree.people.a.name = "Changed Elsewhere";
  await outside(() => postTree(srv.base, now.body.rev, now.body.tree));

  await click(byText("Oleg Petrov", "#people li"));
  await type($("#editor input[type=text]"), "Oleg Local");
  await until(() => $$(".head-stuck").length === 1, "the warning in the head", 8000);
  assert.equal($(".head-stuck .where").textContent, en("where.conflictShort"));
  await click(byText(en("where.reread"), ".head-stuck button"));
  await until(() => $$(".head-stuck").length === 0, "the tab writing again");
  assert.ok($$("#people li .nm").some((n) => n.textContent === "Changed Elsewhere"));
});
