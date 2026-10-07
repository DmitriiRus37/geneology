/**
 * A finger and a mouse against the gesture automaton, with the hold timer mocked. The
 * host records what the gestures meant; between events it plays the render, so what
 * the automaton is shown is what it has asked for.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createGestures, HOLD, type GestureHost, type PointerDown, type Seen } from "./gestures.ts";

const CARD = { id: "p1", x: 100, y: 50 };
const LINE = { x: 0, y: 0, ref: { kind: "sibling" as const, a: "p1", b: "p2" } };

function rig(t: TestContext, { pick = false, selected = null as string | null } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls: string[] = [];
  let dragPos: Seen["dragPos"] = null;
  const host: GestureHost = {
    later: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    box: () => ({ x: CARD.x, y: CARD.y }),
    scale: () => 1,
    moved: () => {},
    panTo: (x, y) => calls.push(`pan ${x},${y}`),
    zoom: (f) => calls.push(`zoom ${f.toFixed(2)}`),
    dragTo: (id, x, y) => {
      dragPos = { id, x, y };
      calls.push(`drag ${id} ${x},${y}`);
    },
    dragEnd: () => {
      dragPos = null;
      calls.push("dragEnd");
    },
    lift: (id) => calls.push(`lift ${id}`),
    unlift: () => calls.push("unlift"),
    select: (id) => {
      selected = id;
      calls.push(`select ${id}`);
    },
    pin: (id, x, y) => calls.push(`pin ${id} ${x},${y}`),
    pickDone: (id) => calls.push(`pickDone ${id}`),
    closePops: () => calls.push("closePops"),
    openEdge: () => calls.push("openEdge"),
  };
  const g = createGestures(host);
  const seen = (): Seen => ({ view: { k: 1, x: 0, y: 0 }, pick, selected, dragPos });
  return {
    g,
    calls,
    down: (x: number, y: number, o: Partial<PointerDown> = {}) =>
      g.down({ x, y, pointerType: "touch", isPrimary: true, onHandle: false, edge: null, node: null, ...o }, seen()),
    move: (x: number, y: number, pointerType = "touch") => g.move({ x, y, pointerType, isPrimary: true }, seen()),
    up: () => g.up(seen()),
    cancel: (pointerType = "touch") => g.cancel(pointerType, seen()),
    wait: (ms: number) => t.mock.timers.tick(ms),
  };
}

test("a finger from a card pans the canvas: the card stays, nothing is selected or saved", (t) => {
  const r = rig(t);
  assert.equal(r.down(10, 10, { node: CARD }), true);
  r.move(30, 10);
  r.move(60, 10);
  r.wait(HOLD * 2);
  r.up();
  assert.deepEqual(r.calls, ["pan 20,0", "pan 50,0"]);
});

test("a finger from a line pans and opens nothing; a still tap on a line opens its menu", (t) => {
  const r = rig(t);
  r.down(10, 10, { edge: LINE });
  r.move(40, 10);
  r.up();
  assert.deepEqual(r.calls, ["pan 30,0"]);
  r.calls.length = 0;
  r.down(10, 10, { edge: LINE });
  r.up();
  assert.deepEqual(r.calls, ["openEdge"]);
});

test("a tap with 2 px of wobble selects the card, and the next one unselects it", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD });
  r.move(12, 10);
  r.up();
  r.down(10, 10, { node: CARD });
  r.move(10, 12);
  r.up();
  assert.deepEqual(r.calls, ["closePops", "select p1", "closePops", "select null"]);
});

test("resting on a card picks it up; moving carries it, and letting go pins it", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD });
  r.wait(HOLD - 1);
  assert.deepEqual(r.calls, [], "not before the hold");
  r.wait(1);
  r.move(50, 10);
  r.up();
  assert.deepEqual(r.calls, ["lift p1", "drag p1 140,50", "pin p1 140,50", "dragEnd", "unlift"]);
});

test("a slow tap selects and never unselects", (t) => {
  const r = rig(t, { selected: "p1" });
  r.down(10, 10, { node: CARD });
  r.wait(HOLD + 80);
  r.up();
  assert.deepEqual(r.calls, ["lift p1", "dragEnd", "unlift"], "already selected: it stays so");
});

test("pointercancel while a card is carried saves nothing", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD });
  r.wait(HOLD);
  r.move(50, 10);
  r.cancel();
  assert.deepEqual(r.calls, ["lift p1", "drag p1 140,50", "dragEnd", "unlift"]);
});

test("a pinch while a finger rests on a card does not pick the card up", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD });
  r.g.touchStart([
    { x: 10, y: 10 },
    { x: 60, y: 10 },
  ]);
  r.wait(HOLD * 2);
  assert.equal(
    r.g.touchMove(
      [
        { x: 0, y: 10 },
        { x: 100, y: 10 },
      ],
      () => ({ x: 0, y: 0 }),
    ),
    true,
  );
  r.g.touchEnd();
  r.up();
  assert.deepEqual(r.calls, ["zoom 2.00"]);
});

test("a mouse drags a card at once, opens a line's menu at once, and 2 px of wobble pan", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD, pointerType: "mouse" });
  r.move(20, 10, "mouse");
  r.up();
  assert.equal(r.down(10, 10, { edge: LINE, pointerType: "mouse" }), false, "the menu needs no capture");
  r.down(10, 10, { pointerType: "mouse" });
  r.move(12, 10, "mouse");
  r.up();
  assert.deepEqual(r.calls, ["drag p1 110,50", "pin p1 110,50", "dragEnd", "openEdge", "pan 2,0"]);
});

test("known issue: a second finger while a card is carried leaves it drawn where it was, unsaved", (t) => {
  const r = rig(t);
  r.down(10, 10, { node: CARD });
  r.wait(HOLD);
  r.move(50, 10);
  r.g.touchStart([
    { x: 50, y: 10 },
    { x: 90, y: 10 },
  ]);
  r.g.touchEnd();
  r.up();
  assert.deepEqual(r.calls, ["lift p1", "drag p1 140,50", "unlift"], "no pin, and no dragEnd to clear where it is drawn");
});
