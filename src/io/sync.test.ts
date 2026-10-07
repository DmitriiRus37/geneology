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
import { createSync, PROBE_TIMEOUT, SAVE_DELAY, type Where } from "./sync.ts";

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
        return new Promise((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(new DOMException("gave up", "AbortError"))),
        );
      }
      const rev = stale ? undefined : srv.rev();
      return answer(input, method, 200, { ok: true, tree: clone(srv.tree), dir: "/data/persons", store, guarded: false, role: "admin", rev });
    }
    if (input === "/api/tree" && method === "POST") {
      const body = JSON.parse(String(init.body));
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
  assert.deepEqual(h.where, { kind: "browser" });
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

test("known issue: after a reread, undo writes the old tree over someone else's edits", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  h.act({ type: "add", spec: { name: "Жанна" } });
  await h.wait(SAVE_DELAY);
  const theirs = tree(6);
  server.edit(theirs);

  await h.sync.reread(); // a silent load keeps the undo history
  h.render();
  await h.wait(0);
  h.act({ type: "undo" });
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 200", "the write is accepted");
  assert.deepEqual(names(server.tree), names(tree(2)), "the tree from before the reread is back on the server");
  assert.notDeepEqual(names(server.tree), names(theirs), "the other tab's tree is gone");
});

test("known issue: a failed write other than a conflict is dropped silently and never retried", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.fail = 500;
  h.rename("З");
  await h.wait(SAVE_DELAY);
  await h.wait(SAVE_DELAY * 10);
  assert.deepEqual(server.posts().slice(1), ["POST /api/tree 500"]);
  assert.deepEqual(h.notices, [], "nobody is told");
  assert.equal(h.where?.kind === "disk" && h.where.blocked, null);
});

test("known issue: a server slower than the probe timeout is taken for none, silently", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  server.hang = true;
  const h = harness(t, server);
  await h.mount();
  await h.wait(PROBE_TIMEOUT - 1);
  assert.equal(h.where, null);
  await h.wait(1);
  assert.deepEqual(h.where, { kind: "browser" });
  assert.deepEqual(h.notices, []);
  h.rename("И");
  await h.wait(SAVE_DELAY);
  assert.deepEqual(server.posts(), [], "the edits stay in the browser");
  assert.ok(h.kept.length > 0);
});

test("known issue: the closing write of a large tree is refused by the browser and nobody hears of it", async (t) => {
  const server = fakeServer({ tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  const id = Object.keys(h.state.tree.people)[0];
  h.act({ type: "update", id, patch: { alt: [ "х".repeat(70000) ] }, quiet: true });
  const before = server.log.length;
  h.sync.flush(h.state.tree);
  assert.equal(h.beacons.length, 1);
  assert.equal(h.beacons[0].sent, false);
  assert.equal(server.log.length, before, "no other request goes instead");
  assert.deepEqual(h.notices, []);
});

test("known issue: after a memory server restarts, the tab holds the only copy and cannot save it", async (t) => {
  const server = fakeServer({ store: "memory", tree: tree(2) });
  const h = harness(t, server);
  await h.mount();
  await h.wait(0);
  server.restart();
  h.rename("К");
  await h.wait(SAVE_DELAY);
  assert.equal(server.posts().at(-1), "POST /api/tree 409");
  await h.sync.reread(); // the server has nothing to give: the tab stays blocked
  h.render();
  assert.equal(h.where?.kind === "disk" && h.where.blocked, "conflict");
  h.rename("Ка");
  await h.wait(SAVE_DELAY * 5);
  assert.equal(server.posts().at(-1), "POST /api/tree 409");
  assert.equal(server.tree, null);
});
