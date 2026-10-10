/**
 * The sync engine against a server of our own behind `fetch`, with the timers mocked.
 * The harness plays React's part: after every change it commits, the way a render
 * runs the autosave effect, and the trees go through the real reducer.
 */
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { initialAppState, reducer, type Action, type AppState } from "../model/store.ts";
import { normalize } from "../model/tree.ts";
import type { TreeState } from "../model/types.ts";
import { synthTree } from "../testing/trees.ts";
import type { Fetch } from "./api.ts";
import { createSync, PROBE_TIMEOUT, PROBE_TRIES, RETRY_DELAY, SAVE_DELAY, type Where } from "./sync.ts";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

interface ServerOptions {
  store?: "disk" | "memory";
  tree?: TreeState | null;
  /** an older server: no fingerprint in its answers */
  stale?: boolean;
}

/** The server's HTTP API, as far as the engine uses it. */
function fakeServer({ store = "disk", tree = null, stale = false }: ServerOptions = {}) {
  let version = 1;
  const srv = {
    tree: tree ? clone(tree) : (null as TreeState | null),
    /** every request: "GET /api/tree 200" */
    log: [] as string[],
    /** the tree read never answers: only the caller giving up ends it */
    hang: false,
    /** writes answer with this status instead */
    fail: 0,
    /** writes get no answer at all: the connection is refused */
    down: false,
    /** run before the next writes, one each: another tab getting in between */
    beforePost: [] as (() => void)[],
    rev: () => (srv.tree ? "r" + version : "empty"),
    /** another tab writes */
    edit(next: TreeState) {
      srv.tree = clone(next);
      version++;
    },
    /** a memory server restarts: everything is gone */
    restart() {
      srv.tree = null;
      version++;
    },
    posts: () => srv.log.filter((l) => l.startsWith("POST /api/tree")),
  };
  const answer = (path: string, method: string, status: number, body: unknown) => {
    srv.log.push(method + " " + path + " " + status);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  const fetch = (async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    if (input === "/api/tree" && method === "GET") {
      if (srv.hang) {
        srv.log.push(method + " " + input + " hangs");
        return new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("gave up", "AbortError"))),
        );
      }
      const rev = stale ? undefined : srv.rev();
      return answer(input, method, 200, { ok: true, tree: clone(srv.tree), dir: "/data/persons", store, guarded: false, role: "admin", rev });
    }
    if (input === "/api/tree" && method === "POST") {
      const body = JSON.parse(String(init.body));
      if (srv.down) {
        srv.log.push(method + " " + input + " refused");
        throw new TypeError("Failed to fetch");
      }
      srv.beforePost.shift()?.();
      if (srv.fail) return answer(input, method, srv.fail, { ok: false, error: "it broke" });
      if (body.rev !== srv.rev()) return answer(input, method, 409, { ok: false, conflict: true, rev: srv.rev() });
      srv.edit(body.tree);
      return answer(input, method, 200, { ok: true, rev: srv.rev() });
    }
    if (input === "/api/upload") {
      srv.edit(JSON.parse(await (init.body as Blob).text()));
      return answer(input, method, 200, { ok: true, tree: clone(srv.tree), rev: srv.rev() });
    }
    if (input === "/api/download") return answer(input, method, srv.fail || 200, "zip");
    return answer(input, method, 404, { ok: false });
  }) as Fetch;
  return Object.assign(srv, { fetch });
}

/** Let the answers in flight arrive. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

const tree = (seed: number, size = 8): TreeState => normalize(synthTree({ seed, size }));
/** Synthetic trees share their ids (p1, p2, …): they are told apart by the names. */
const names = (tr: TreeState | null): string[] => Object.values(tr?.people ?? {}).map((p) => p.name);

/** The engine with React's part played by hand: a commit after every change. */
function harness(t: TestContext, server: ReturnType<typeof fakeServer>, open: TreeState = tree(1)) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let state: AppState = initialAppState(open);
  let where: Where = null;
  let flushSeq = 0;
  const notices: string[] = [];
  const kept: TreeState[] = [];
  const beacons: { size: number; sent: boolean }[] = [];
  const saved: string[] = [];
  const d = (a: Action) => {
    state = reducer(state, a);
  };
  const sync = createSync(
    {
      fetch: server.fetch,
      later: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      keep: (tr) => kept.push(tr),
      // the browser refuses anything over 64 KB, and says so only by returning false
      beacon: (_url, body) => {
        const sent = body.size <= 65536;
        beacons.push({ size: body.size, sent });
        return sent;
      },
      save: (name) => saved.push(name),
    },
    {
      setWhere: (next) => {
        where = typeof next === "function" ? next(where) : next;
      },
      load: (tr, notice) => d({ type: "load", tree: tr, silent: true, notice }),
      notice: (m) => {
        notices.push(m.k);
        d({ type: "notice", msg: m });
      },
    },
  );
  /** the selection as the last render saw it: a change asks for a hurry, as the app's effect does */
  let lastSelected: string | null | undefined;
  const h = {
    sync,
    notices,
    kept,
    beacons,
    saved,
    get state() {
      return state;
    },
    get where() {
      return where;
    },
    /** A render: the autosave sees the commit, and a new selection asks for a hurry. */
    render() {
      sync.commit(state.tree, where, flushSeq);
      if (state.selected === lastSelected) return;
      lastSelected = state.selected;
      flushSeq++;
      sync.commit(state.tree, where, flushSeq);
    },
    /** what the app does on its first render: the probe goes out */
    async mount() {
      sync.start(() => state.tree);
      h.render();
      await settle();
      h.render();
    },
    /** an action, then the render it causes */
    act(a: Action) {
      d(a);
      h.render();
    },
    /** another person selected or a field left */
    hurry() {
      flushSeq++;
      h.render();
    },
    async wait(ms: number) {
      t.mock.timers.tick(ms);
      await settle();
      h.render();
    },
    rename(name: string) {
      const id = Object.keys(state.tree.people)[0];
      h.act({ type: "update", id, patch: { name }, quiet: true });
    },
  };
  return h;
}

test("the tree read at the start goes straight back, then edits go out a second after the last one", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  assert.deepEqual(h.where, { kind: "disk", dir: "/data/persons", store: "disk", guarded: false, role: "admin", blocked: null });
  assert.deepEqual(names(h.state.tree), names(tree(2)), "the server's tree is open");
  await h.wait(0);
  assert.deepEqual(server.log, ["GET /api/tree 200", "POST /api/tree 200"]);

  h.rename("А");
  await h.wait(SAVE_DELAY / 2);
  h.rename("Аб");
  await h.wait(SAVE_DELAY - 1);
  assert.equal(server.posts().length, 1, "every letter restarts the wait");
  await h.wait(1);
  assert.equal(server.posts().length, 2);
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Аб");
});

test("a hurry writes at once", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  h.rename("В");
  h.hurry();
  await h.wait(0);
  assert.equal(server.posts().length, 2);
});

test("an empty folder is seeded with the open tree", async (t) => {
  const server = fakeServer();
  const open = tree(3);
  const h = harness(t, server, open);
  await h.mount();
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.log, ["GET /api/tree 200", "POST /api/tree 200"]);
  assert.deepEqual(names(server.tree), names(open));
});

test("an empty memory server is not seeded: the app opens empty", async (t) => {
  const server = fakeServer({ store: "memory" });
  const h = harness(t, server);
  await h.mount();
  assert.deepEqual(h.state.tree.people, {});
});

test("an older server is read but never written to", async (t) => {
  const server = fakeServer({ tree: tree(2), stale: true });
  const h = harness(t, server);
  await h.mount();
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "stale");
  assert.deepEqual(h.notices, ["notice.staleServer"]);
  h.rename("Г");
  await h.wait(SAVE_DELAY * 5);
  assert.deepEqual(server.posts(), []);
});

test("someone else's edit blocks writing until the tree is read again", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.edit(tree(4));
  h.rename("Д");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts(), ["POST /api/tree 200", "POST /api/tree 409"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "conflict");
  assert.deepEqual(h.notices, ["notice.conflict"]);

  h.rename("Де");
  await h.wait(SAVE_DELAY * 5);
  assert.equal(server.posts().length, 2, "blocked: nothing goes out");

  await h.sync.reread();
  h.render();
  assert.equal(h.where?.kind === "disk" && h.where.blocked, null);
  assert.equal(h.state.notice?.msg.k, "notice.reread");
  assert.deepEqual(names(h.state.tree), names(tree(4)), "the other tab's tree is open");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts().slice(2), ["POST /api/tree 200"]);
});

test("without a server the tree is kept in the browser", async (t) => {
  const server = Object.assign(fakeServer(), { fetch: (async () => new Response("", { status: 404 })) as Fetch });
  const h = harness(t, server);
  await h.mount();
  assert.deepEqual(h.where, { kind: "browser" }, "at once");
  assert.deepEqual(h.notices, [], "and without a word: that is the ordinary case");
  await h.wait(0);
  h.rename("Е");
  await h.wait(SAVE_DELAY);
  assert.equal(h.kept.length, 2);
  assert.equal(Object.values(h.kept[1].people)[0].name, "Е");
});

test("an archive replaces the tree, and its fingerprint is taken at once", async (t) => {
  const server = fakeServer({ store: "memory" });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  const r = await h.sync.upload(new Blob([JSON.stringify(tree(5))]));
  assert.ok("tree" in r);
  h.act({ type: "load", tree: normalize(r.tree) });
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.log.slice(-2), ["POST /api/upload 200", "POST /api/tree 200"]);
});

test("the archive downloads under one name, and a failure comes back as its status", async (t) => {
  const server = fakeServer({ store: "memory" });
  const h = harness(t, server);
  assert.equal(await h.sync.download(), null);
  assert.deepEqual(h.saved, ["persons.zip"]);
  server.fail = 500;
  assert.equal(await h.sync.download(), "500");
});

test("after a reread there is nothing to undo, so someone else's edits stay", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  h.act({ type: "add", spec: { name: "Жанна" } });
  await h.wait(SAVE_DELAY);
  const theirs = tree(6);
  server.edit(theirs);

  await h.sync.reread(); // a load from the server clears the undo history
  h.render();
  await h.wait(0);
  const writes = server.posts().length;
  h.act({ type: "undo" });
  await h.wait(SAVE_DELAY);
  assert.equal(h.state.notice?.msg.k, "msg.nothingToUndo");
  assert.equal(server.posts().length, writes, "nothing goes out");
  assert.deepEqual(names(server.tree), names(theirs), "the other tab's tree is still there");
});

test("a refused connection is no server either: the browser, at once and silently", async (t) => {
  const server = Object.assign(fakeServer(), {
    fetch: (async () => {
      throw new TypeError("Failed to fetch");
    }) as Fetch,
  });
  const h = harness(t, server);
  await h.mount();
  assert.deepEqual(h.where, { kind: "browser" });
  assert.deepEqual(h.notices, []);
});

test("a failed write stays unsaved and is tried again until it goes through, with the newest tree", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.fail = 500;
  h.rename("З");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 500"]);
  assert.deepEqual(h.notices, ["notice.saveFailed"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, null, "a failure is not a conflict");
  assert.ok(h.sync.unsaved());

  h.rename("Зе");
  await h.wait(RETRY_DELAY - 1);
  assert.equal(server.posts().length, 2, "an edit does not bring the retry forward");
  await h.wait(1);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 500", "POST /api/tree 500"]);
  assert.deepEqual(h.notices, ["notice.saveFailed"], "only the first failure in a row is told");

  server.fail = 0;
  await h.wait(RETRY_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 200");
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Зе", "the newest tree went");
  assert.deepEqual(h.notices, ["notice.saveFailed", "notice.saved"]);
  assert.equal(h.sync.unsaved(), false);

  h.rename("Зел");
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().length, 5, "then edits go out as ever");
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Зел");
  await h.wait(RETRY_DELAY * 3);
  assert.equal(server.posts().length, 5, "and nothing is retried once it went through");
  assert.deepEqual(h.notices, ["notice.saveFailed", "notice.saved"]);
});

test("a write that gets no answer at all has failed too, and is tried again", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.down = true;
  h.rename("Ж");
  await h.wait(SAVE_DELAY);
  await h.wait(RETRY_DELAY);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree refused", "POST /api/tree refused"]);
  assert.deepEqual(h.notices, ["notice.saveFailed"]);
  server.down = false;
  await h.wait(RETRY_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 200");
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Ж");
  assert.deepEqual(h.notices, ["notice.saveFailed", "notice.saved"]);
});

test("a failed write is not taken for saved: what the tab counts as written is what the server holds", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  const held = h.state.tree;
  server.fail = 500;
  h.rename("Л");
  await h.wait(SAVE_DELAY);
  h.act({ type: "undo" });
  assert.equal(h.state.tree, held, "back to exactly what the server holds");
  await h.wait(RETRY_DELAY);
  assert.equal(server.posts().length, 2, "so the retry has nothing to send");
  assert.deepEqual(h.notices, ["notice.saveFailed", "notice.saved"]);
  assert.equal(h.sync.unsaved(), false);

  server.fail = 0;
  h.rename("Л");
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 200", "made again, the edit goes");
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Л");
});

test("a server slower than the probe timeout is asked again, then the tree stays in the browser with a word", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  server.hang = true;
  const h = harness(t, server);
  await h.mount();
  h.rename("И");
  await h.wait(PROBE_TIMEOUT - 1);
  assert.equal(h.where, null);
  for (let i = 1; i < PROBE_TRIES; i++) {
    await h.wait(i === 1 ? 1 : PROBE_TIMEOUT);
    assert.equal(h.where, null, "still asking after " + i + " silences");
  }
  assert.equal(h.kept.length, 0, "while it is asked, nothing is written anywhere");
  assert.deepEqual(h.notices, []);
  await h.wait(PROBE_TIMEOUT);
  assert.deepEqual(server.log, Array(PROBE_TRIES).fill("GET /api/tree hangs"));
  assert.deepEqual(h.where, { kind: "browser" });
  assert.deepEqual(h.notices, ["notice.serverSilent"]);
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts(), [], "the edits stay in the browser");
  assert.equal(Object.values(h.kept.at(-1)?.people ?? {})[0]?.name, "И");
});

test("a slow server that answers the next time it is asked is used", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  server.hang = true;
  const h = harness(t, server);
  await h.mount();
  server.hang = false; // awake now, but the first question has already gone unanswered
  await h.wait(PROBE_TIMEOUT - 1);
  assert.equal(h.where, null);
  await h.wait(1);
  assert.deepEqual(h.where, { kind: "disk", dir: "/data/persons", store: "disk", guarded: false, role: "admin", blocked: null });
  assert.deepEqual(names(h.state.tree), names(tree(2)));
  assert.deepEqual(h.notices, []);
});

test("the closing beacon goes only when something is unsaved", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  h.sync.flush(h.state.tree);
  assert.equal(h.beacons.length, 0, "everything is on the server: nothing to send");

  h.rename("П"); // a pending autosave
  assert.ok(h.sync.unsaved());
  assert.equal(h.sync.askOnClose(h.state.tree), false, "a beacon carries it: no need to ask");
  h.sync.flush(h.state.tree);
  assert.equal(h.beacons.length, 1);
  assert.equal(h.beacons[0].sent, true);
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().length, 1, "what the beacon carried is not sent again behind it");

  h.rename("Пе");
  h.sync.hide(); // a write in flight
  h.sync.flush(h.state.tree);
  assert.equal(h.beacons.length, 2);
  await h.wait(0);

  server.fail = 500;
  h.rename("Пет");
  await h.wait(SAVE_DELAY); // a failed write
  h.sync.flush(h.state.tree);
  assert.equal(h.beacons.length, 3);
});

test("a hidden page sends a pending autosave at once, with an ordinary request", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  h.rename("Р");
  h.sync.hide();
  await h.wait(0);
  assert.equal(server.posts().length, 2);
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Р");
  assert.equal(h.sync.unsaved(), false);
  h.sync.hide();
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().length, 2, "nothing pending: nothing goes");
  assert.deepEqual(h.beacons, []);
});

test("a tree too big for the closing beacon makes the page ask before closing, while it is unsaved", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  const id = Object.keys(h.state.tree.people)[0];
  h.act({ type: "update", id, patch: { alt: ["х".repeat(70000)] }, quiet: true });
  assert.equal(h.sync.fitsBeacon(h.state.tree), false);
  assert.equal(h.sync.askOnClose(h.state.tree), true, "unsaved, and a beacon cannot carry it");
  h.sync.hide(); // the person stays, the page goes out of sight: the write goes as an ordinary request
  await h.wait(0);
  assert.equal(server.posts().at(-1), "POST /api/tree 200");
  assert.equal(h.sync.askOnClose(h.state.tree), false, "written: the tab closes without a question");
  h.sync.flush(h.state.tree);
  assert.deepEqual(h.beacons, []);
});

test("after a memory server restarts empty, the tab writes its tree back at once and says so", async (t) => {
  const server = fakeServer({ store: "memory", tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.restart();
  h.rename("К");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 409", "POST /api/tree 200"]);
  assert.deepEqual(names(server.tree), names(h.state.tree), "the tab's tree is on the server again");
  assert.deepEqual(h.notices, ["notice.restarted"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, null);
  h.rename("Ка");
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 200", "and writing goes on as ever");
  assert.equal(server.tree && Object.values(server.tree.people)[0].name, "Ка");
});

test("when another tab got its tree back onto the restarted server first, it is an ordinary conflict", async (t) => {
  const server = fakeServer({ store: "memory", tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.restart();
  server.beforePost = [() => {}, () => server.edit(tree(4))];
  h.rename("Л");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 409", "POST /api/tree 409"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "conflict");
  assert.deepEqual(h.notices, ["notice.conflict"]);
  assert.deepEqual(names(server.tree), names(tree(4)), "the other tab's tree stays");
});

test("a folder on disk that emptied is not written back: that is an ordinary conflict", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.restart(); // every file gone
  h.rename("М");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 409"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "conflict");
  assert.deepEqual(h.notices, ["notice.conflict"]);
  assert.equal(server.tree, null);
});

test("a tab blocked by a conflict gives its tree back on a reread when the memory server has restarted empty", async (t) => {
  const server = fakeServer({ store: "memory", tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.edit(tree(4));
  h.rename("Н");
  await h.wait(SAVE_DELAY);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "conflict");
  server.restart();
  await h.sync.reread();
  h.render();
  await h.wait(0);
  assert.equal(server.posts().at(-1), "POST /api/tree 200");
  assert.deepEqual(names(server.tree), names(h.state.tree), "the only copy left is on the server again");
  assert.equal(Object.values(h.state.tree.people)[0].name, "Н", "and stays open");
  assert.deepEqual(h.notices, ["notice.conflict", "notice.restarted"]);
  assert.equal(h.where?.kind === "disk" && h.where.blocked, null);
});

test("a recheck of a server still in its old version keeps writing blocked", async (t) => {
  const server = fakeServer({ tree: tree(2), stale: true });
  const h = harness(t, server);
  await h.mount();
  await h.sync.reread();
  h.render();
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "stale");
  h.rename("О");
  await h.wait(SAVE_DELAY * 5);
  assert.deepEqual(server.posts(), []);
});
