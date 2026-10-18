/**
 * The server's HTTP contract, pinned from the outside: every route, both stores, the
 * guard. These tests describe what the server does today — known bugs included, each
 * marked "known issue" — so that a rewrite of its insides cannot change any of it
 * unnoticed. When a known issue gets fixed, its test is the one to turn around.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { basic, card, getTree, jpeg, login, postInTwoParts, postPhoto, postTree, startServer, unzip, unzipBytes, zip, type Running } from "./testing.ts";

/** A small tree with everything the format carries. The names are made up. */
const TREE = {
  people: {
    p1: { id: "p1", name: "Иван Петрович Орлов", maiden: "", alt: [], born: "??.??.1900", died: "12.03.1970", sex: "m", n: 1 },
    p2: { id: "p2", name: "Анна Сергеевна Орлова", maiden: "Соколова", alt: [], born: "", died: "", sex: "f", n: 2 },
    p3: { id: "p3", name: "Пётр Иванович Орлов", maiden: "", alt: ["Петя"], born: "01.02.1925", died: "", sex: "m", n: 3, fx: 10.123, fy: 20.456 },
    p4: { id: "p4", name: "Вера Николаевна Белкина", maiden: "", alt: [], born: "192?", died: "", sex: "f", n: 4 },
  },
  links: [
    { parent: "p1", child: "p3" },
    { parent: "p2", child: "p3" },
  ],
  pairs: [{ a: "p1", b: "p2" }],
  sibs: [{ a: "p3", b: "p4" }],
  timeline: true,
  gap: 1.4,
  hidden: ["p4"],
  seq: 4,
};

const json = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, name), "utf8"));

/** The newest row of the sign-in log. */
const lastRow = (srv: Running) => {
  const lines = readFileSync(join(srv.logs, "logins.jsonl"), "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
};

/**
 * The request-log line of the request sent with this user agent, split at spaces. It is
 * written once the answer has gone out, so it may land a moment after the client has it.
 */
async function accessLine(srv: Running, ua: string): Promise<string[]> {
  const file = join(srv.logs, "access.log");
  const until = Date.now() + 5000;
  for (;;) {
    const line = (existsSync(file) ? readFileSync(file, "utf8") : "").split("\n").find((l) => l.endsWith('"' + ua + '"'));
    if (line) return line.split(" ");
    if (Date.now() > until) throw new Error("no request-log line for " + ua);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("an open server on a folder", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "disk" });
  });
  after(() => srv.stop());

  test("health answers", async () => {
    const r = await fetch(srv.base + "/api/health");
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  test("an empty folder gives no tree and the fingerprint 'empty'", async () => {
    const { status, body } = await getTree(srv.base);
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, tree: null, dir: srv.dir, store: "disk", guarded: false, role: "admin", rev: "empty" });
  });

  test("a write without a fingerprint is refused", async () => {
    const r = await fetch(srv.base + "/api/tree", { method: "POST", body: JSON.stringify({ tree: TREE }) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).ok, false);
  });

  test("a write with the current fingerprint becomes one card per person and a view file", async () => {
    const { status, body } = await postTree(srv.base, "empty", TREE);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.written, 4);
    assert.equal(body.removed, 0);
    assert.equal(body.total, 4);
    assert.match(body.rev, /^[0-9a-f]{16}$/);
    assert.deepEqual(readdirSync(srv.dir).sort(), ["_view.json", "p1.json", "p2.json", "p3.json", "p4.json"]);
    assert.deepEqual(json(srv.dir, "p3.json"), {
      id: "p3",
      name: "Пётр Иванович Орлов",
      maiden: "",
      alt: ["Петя"],
      born: "01.02.1925",
      died: "",
      sex: "m",
      n: 3,
      parents: ["p1", "p2"],
      spouses: [],
      siblings: ["p4"],
      fx: 10.12,
      fy: 20.46,
    });
    assert.deepEqual(json(srv.dir, "p1.json").spouses, ["p2"], "a marriage is written into both cards");
    assert.deepEqual(json(srv.dir, "p2.json").spouses, ["p1"]);
    assert.deepEqual(json(srv.dir, "p4.json").siblings, ["p3"], "a kinship is written into both cards");
    assert.deepEqual(json(srv.dir, "_view.json"), { timeline: true, gap: 1.4, hidden: ["p4"] });
  });

  test("reading back gives the tree as it was written", async () => {
    const { body } = await getTree(srv.base);
    const p = TREE.people;
    assert.deepEqual(body.tree, {
      people: {
        p1: { ...p.p1 },
        p2: { ...p.p2 },
        p3: { ...p.p3, fx: 10.12, fy: 20.46 },
        p4: { ...p.p4 },
      },
      links: TREE.links,
      pairs: TREE.pairs,
      sibs: TREE.sibs,
      timeline: true,
      gap: 1.4,
      hidden: ["p4"],
      seq: 4,
    });
  });

  test("a write with an old fingerprint is refused and changes nothing", async () => {
    const before = readFileSync(join(srv.dir, "p1.json"), "utf8");
    const { status, body } = await postTree(srv.base, "0000000000000000", { ...TREE, people: {} });
    assert.equal(status, 409);
    assert.equal(body.conflict, true);
    assert.equal(body.rev, (await getTree(srv.base)).body.rev, "the refusal carries the current fingerprint");
    assert.equal(readFileSync(join(srv.dir, "p1.json"), "utf8"), before);
  });

  test("an unchanged write rewrites nothing, and the fingerprint stays", async () => {
    const { body: now } = await getTree(srv.base);
    const { body } = await postTree(srv.base, now.rev, now.tree);
    assert.equal(body.written, 0);
    assert.equal(body.removed, 0);
    assert.equal(body.rev, now.rev);
  });

  test("a person missing from the next write leaves with their file", async () => {
    const { body: now } = await getTree(srv.base);
    const people = { ...now.tree.people };
    delete people.p4;
    const { body } = await postTree(srv.base, now.rev, { ...now.tree, people, sibs: [], hidden: [] });
    assert.equal(body.removed, 1);
    assert.equal(existsSync(join(srv.dir, "p4.json")), false);
    assert.deepEqual(json(srv.dir, "p3.json").siblings, [], "the kinship goes from the other card too");
  });

  test("an archive cannot be uploaded over a tree in a folder", async () => {
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(zip({ "p9.json": card("p9", "X") })) });
    assert.equal(r.status, 409);
    assert.equal(existsSync(join(srv.dir, "p9.json")), false);
  });

  test("the download is the folder's files as a zip under persons/", async () => {
    const r = await fetch(srv.base + "/api/download");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/zip");
    assert.equal(r.headers.get("content-disposition"), 'attachment; filename="persons.zip"');
    const files = unzip(Buffer.from(await r.arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), ["persons/_view.json", "persons/p1.json", "persons/p2.json", "persons/p3.json"]);
    assert.equal(files["persons/p1.json"], readFileSync(join(srv.dir, "p1.json"), "utf8"));
  });

  test("the admin page opens for everyone when there is no password", async () => {
    const r = await fetch(srv.base + "/admin");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/html/);
  });

  test("the sign-in log is not kept without LOG_DIR", async () => {
    const r = await fetch(srv.base + "/admin/logins.jsonl");
    assert.equal(r.status, 404);
  });

  test("an unknown API method is a 404", async () => {
    const r = await fetch(srv.base + "/api/nothing");
    assert.equal(r.status, 404);
    assert.equal((await r.json()).ok, false);
  });

  test("a path that climbs out of the build is refused", async () => {
    const r = await fetch(srv.base + "/..%2Fserver.mjs");
    assert.equal(r.status, 400);
  });

  test("the app page is served", async (t) => {
    if (!existsSync(join(import.meta.dirname, "..", "dist", "genealogy.html"))) {
      t.skip("dist/ is not built: run npm run build");
      return;
    }
    const r = await fetch(srv.base + "/");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await r.text(), /<div id="root">/);
  });
});

describe("a server in memory", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory" });
  });
  after(() => srv.stop());

  test("it starts empty", async () => {
    const { body } = await getTree(srv.base);
    assert.deepEqual(body, { ok: true, tree: null, dir: "server memory", store: "memory", guarded: false, role: "admin", rev: "empty" });
  });

  test("a broken archive is refused", async () => {
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(Buffer.from("not a zip at all")) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "this is not a zip archive");
  });

  test("an archive with no cards is refused", async () => {
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(zip({ "readme.txt": "hello" })) });
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, "there are no cards (.json) in the archive");
  });

  test("an archive replaces the tree, and macOS litter in it is ignored", async () => {
    const archive = zip({
      "persons/p1.json": card("p1", "Иван Петрович Орлов", { sex: "m", spouses: ["p2"] }),
      "persons/p2.json": card("p2", "Анна Сергеевна Орлова", { sex: "f", n: 2, spouses: ["p1"] }),
      "__MACOSX/persons/._p1.json": "junk",
      "persons/.DS_Store": "junk",
      "persons/._p2.json": "junk",
    });
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(archive) });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.people, 2);
    assert.match(body.rev, /^[0-9a-f]{16}$/);
    const { body: now } = await getTree(srv.base);
    assert.deepEqual(Object.keys(now.tree.people).sort(), ["p1", "p2"]);
    assert.deepEqual(now.tree.pairs, [{ a: "p1", b: "p2" }]);
    assert.equal(now.rev, body.rev);
  });

  test("writes go to memory with the same fingerprint rules", async () => {
    const { body: now } = await getTree(srv.base);
    const stale = await postTree(srv.base, "empty", TREE);
    assert.equal(stale.status, 409);
    const { status, body } = await postTree(srv.base, now.rev, TREE);
    assert.equal(status, 200);
    assert.equal(body.total, 4);
    assert.deepEqual(Object.keys((await getTree(srv.base)).body.tree.people).sort(), ["p1", "p2", "p3", "p4"]);
  });

  test("the download returns what is in memory", async () => {
    const files = unzip(Buffer.from(await (await fetch(srv.base + "/api/download")).arrayBuffer()));
    assert.deepEqual(Object.keys(files).sort(), ["persons/_view.json", "persons/p1.json", "persons/p2.json", "persons/p3.json", "persons/p4.json"]);
    assert.equal(JSON.parse(files["persons/p3.json"]).fx, 10.12);
  });

  test("an archive with no person's card in it is refused and the tree stays", async () => {
    const before = (await getTree(srv.base)).body.tree.people;
    const archives: Record<string, string>[] = [
      { "persons/_view.json": '{"timeline":false,"gap":1,"hidden":[]}' },
      { "persons/p9.json": "{ not json" },
      { "persons/settings.json": '{"theme":"dark"}' },
    ];
    for (const files of archives) {
      const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(zip(files)) });
      assert.equal(r.status, 400);
      assert.equal((await r.json()).error, "there are no cards (.json) in the archive");
    }
    assert.deepEqual((await getTree(srv.base)).body.tree.people, before);
  });
});

describe("a server with passwords", () => {
  const USER: [string, string] = ["anna", "secret-one"];
  const ADMIN: [string, string] = ["root", "secret-two"];
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory", user: USER, admin: ADMIN, logs: true });
  });
  after(() => srv.stop());

  test("health answers without a password", async () => {
    assert.equal((await fetch(srv.base + "/api/health")).status, 200);
  });

  test("without a password the API answers 401 with a Basic challenge", async () => {
    const r = await fetch(srv.base + "/api/tree");
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("www-authenticate"), 'Basic realm="Genealogy", charset="UTF-8"');
    assert.equal(await r.text(), "A password is needed\n");
  });

  test("a browser without a password is sent to the login form", async () => {
    const r = await fetch(srv.base + "/", { headers: { accept: "text/html" }, redirect: "manual" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/login");
  });

  test("the login form is served to a stranger", async () => {
    const r = await fetch(srv.base + "/login");
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<form/);
  });

  test("Basic credentials open the API, with the role they belong to", async () => {
    const user = await getTree(srv.base, basic(...USER));
    assert.equal(user.status, 200);
    assert.equal(user.body.role, "user");
    assert.equal(user.body.guarded, true);
    assert.equal((await getTree(srv.base, basic(...ADMIN))).body.role, "admin");
    assert.equal((await fetch(srv.base + "/api/tree", { headers: basic("anna", "wrong") })).status, 401);
  });

  test("the form hands out a session cookie that opens the API", async () => {
    const r = await fetch(srv.base + "/login", { method: "POST", body: new URLSearchParams({ u: USER[0], p: USER[1] }), redirect: "manual" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/");
    assert.match(r.headers.get("set-cookie") ?? "", /^gen_session=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/);
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    assert.equal((await getTree(srv.base, { cookie })).body.role, "user");
  });

  test("the admin is sent to /admin, and the login form sends a signed-in visitor home", async () => {
    const r = await fetch(srv.base + "/login", { method: "POST", body: new URLSearchParams({ u: ADMIN[0], p: ADMIN[1] }), redirect: "manual" });
    assert.equal(r.headers.get("location"), "/admin");
    const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    const again = await fetch(srv.base + "/login", { headers: { cookie }, redirect: "manual" });
    assert.equal(again.status, 303);
    assert.equal(again.headers.get("location"), "/admin");
  });

  test("a wrong password gets the form again with 401, and not at once", async () => {
    const started = Date.now();
    const r = await fetch(srv.base + "/login", { method: "POST", body: new URLSearchParams({ u: "anna", p: "nope" }) });
    assert.equal(r.status, 401);
    assert.match(await r.text(), /<form/);
    assert.ok(Date.now() - started >= 350, "a refused sign-in is slowed down");
  });

  test("logout clears the cookie", async () => {
    const r = await fetch(srv.base + "/logout", { redirect: "manual" });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), "/login");
    assert.equal(r.headers.get("set-cookie"), "gen_session=; Path=/; HttpOnly; Max-Age=0");
  });

  test("the admin page is for the admin only", async () => {
    const user = await login(srv.base, ...USER);
    const admin = await login(srv.base, ...ADMIN);
    assert.equal((await fetch(srv.base + "/admin", { headers: { cookie: user } })).status, 403);
    const r = await fetch(srv.base + "/admin", { headers: { cookie: admin } });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /anna/, "the page lists the sign-ins");
  });

  test("the sign-in log is kept on disk and served to the admin", async () => {
    const admin = await login(srv.base, ...ADMIN);
    const r = await fetch(srv.base + "/admin/logins.jsonl", { headers: { cookie: admin } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
    const rows = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(rows.some((x) => x.login === "anna" && x.result === "user"));
    assert.ok(rows.some((x) => x.login === "anna" && x.result === "refused"));
    for (const x of rows) assert.deepEqual(Object.keys(x), ["when", "login", "address", "result", "browser"]);
    assert.equal((await fetch(srv.base + "/admin/logins.jsonl", { headers: { cookie: await login(srv.base, ...USER) } })).status, 403);
  });
});

describe("the sign-in log and the address a client claims", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory", user: ["anna", "secret-one"], logs: true });
  });
  after(() => srv.stop());

  test("X-Forwarded-For is ignored: the address is the connection's", async () => {
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": "10.9.8.7" });
    assert.equal(lastRow(srv).address, "127.0.0.1");
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": "1".repeat(4000) });
    assert.equal(lastRow(srv).address, "127.0.0.1");
  });

  test("the request log ignores X-Forwarded-For too", async () => {
    await fetch(srv.base + "/api/health", { headers: { "x-forwarded-for": "10.9.8.7", "user-agent": "probe-untrusted" } });
    assert.equal((await accessLine(srv, "probe-untrusted"))[1], "127.0.0.1");
  });
});

describe("behind a proxy of our own (GENEALOGY_TRUST_PROXY=1)", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory", user: ["anna", "secret-one"], logs: true, env: { GENEALOGY_TRUST_PROXY: "1" } });
  });
  after(() => srv.stop());

  test("the address is the rightmost X-Forwarded-For entry, not what the client wrote before it", async () => {
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": "10.9.8.7, 203.0.113.5" });
    assert.equal(lastRow(srv).address, "203.0.113.5");
    await fetch(srv.base + "/api/health", { headers: { "x-forwarded-for": "10.9.8.7, 203.0.113.5", "user-agent": "probe-trusted" } });
    assert.equal((await accessLine(srv, "probe-trusted"))[1], "203.0.113.5", "the request log takes the same entry");
  });

  test("an overlong address is cut to 45 characters", async () => {
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": "10.9.8.7, " + "1".repeat(4000) });
    assert.equal(lastRow(srv).address, "1".repeat(45));
  });

  test("without the header the address is the connection's", async () => {
    await login(srv.base, "anna", "wrong");
    assert.equal(lastRow(srv).address, "127.0.0.1");
  });
});

describe("edge cases of the stores", () => {
  test("a letter split between two parts of the body arrives whole", async () => {
    const srv = await startServer({ store: "memory" });
    try {
      const name = "Иван Петрович Орлов";
      const body = Buffer.from(JSON.stringify({ rev: "empty", tree: { ...TREE, people: { p1: { ...TREE.people.p1, name } }, links: [], pairs: [], sibs: [], hidden: [] } }));
      const at = body.indexOf(Buffer.from("И")) + 1; // between the two bytes of "И"
      const r = await postInTwoParts(srv.base, "/api/tree", body, at);
      assert.equal(r.status, 200);
      assert.equal((await getTree(srv.base)).body.tree.people.p1.name, name);
    } finally {
      await srv.stop();
    }
  });

  test("a card that does not parse survives the next write", async () => {
    const srv = await startServer({
      store: "disk",
      files: { "p1.json": card("p1", "Иван Петрович Орлов"), "p2.json": card("p2", "Анна Сергеевна Орлова").replace('"name"', '"name":,') },
    });
    try {
      const { body } = await getTree(srv.base);
      assert.deepEqual(Object.keys(body.tree.people), ["p1"], "the broken card is skipped on read");
      const out = await postTree(srv.base, body.rev, body.tree);
      assert.equal(out.body.removed, 0);
      assert.equal(existsSync(join(srv.dir, "p2.json")), true);
    } finally {
      await srv.stop();
    }
  });

  test("link lists that are not arrays read as empty, and the rest of the tree reads", async () => {
    const srv = await startServer({
      store: "disk",
      files: {
        "a.json": card("a", "Иван Петрович Орлов"),
        "p1.json": card("p1", "Анна Сергеевна Орлова", { parents: null }),
        // a string is not walked letter by letter: "a" is somebody's id here
        "p2.json": card("p2", "Пётр Иванович Орлов", { parents: "a", spouses: { a: "a" }, siblings: 7 }),
      },
    });
    try {
      const { status, body } = await getTree(srv.base);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body.tree.people).sort(), ["a", "p1", "p2"]);
      assert.equal(body.tree.people.p1.name, "Анна Сергеевна Орлова", "the card's person is still there");
      assert.equal("parents" in body.tree.people.p1, false);
      assert.deepEqual([body.tree.links, body.tree.pairs, body.tree.sibs], [[], [], []]);
    } finally {
      await srv.stop();
    }
  });

  test("JSON that is no person's card is not read, not rewritten and not deleted", async () => {
    const others: Record<string, string> = {
      "settings.json": '{"theme":"dark"}\n',
      "list.json": '["p1"]\n',
      "nothing.json": "null\n",
      "count.json": "7\n",
      "numbered.json": '{"id":7,"name":null}\n',
      "genealogy (1).json": "{}\n",
    };
    const srv = await startServer({ store: "disk", files: { "p1.json": card("p1", "Иван Петрович Орлов"), ...others } });
    try {
      const { body } = await getTree(srv.base);
      assert.deepEqual(Object.keys(body.tree.people), ["p1"]);
      const out = await postTree(srv.base, body.rev, body.tree);
      assert.equal(out.status, 200);
      assert.equal(out.body.removed, 0);
      for (const [name, text] of Object.entries(others)) assert.equal(readFileSync(join(srv.dir, name), "utf8"), text, name + " is left as it was");
    } finally {
      await srv.stop();
    }
  });

  test("ids named after Object.prototype members are nobody's: skipped on read, never deleted", async () => {
    const others: Record<string, string> = {
      "constructor.json": card("constructor", "Иван Петрович Орлов"),
      "toString.json": '{"name":"Анна Сергеевна Орлова"}\n',
      "hasOwnProperty.json": card("hasOwnProperty", "Вера Николаевна Белкина"),
    };
    const srv = await startServer({
      store: "disk",
      files: {
        ...others,
        "p1.json": card("p1", "Пётр Иванович Орлов", { parents: ["constructor"], spouses: ["toString"] }),
        // an id like that inside the card falls back to the file name, as any unusable id does
        "p2.json": card("p2", "Мария Петровна Орлова", { id: "__proto__" }),
      },
    });
    try {
      const { status, body } = await getTree(srv.base);
      assert.equal(status, 200);
      assert.deepEqual(Object.keys(body.tree.people).sort(), ["p1", "p2"]);
      assert.deepEqual([body.tree.links, body.tree.pairs], [[], []]);
      const out = await postTree(srv.base, body.rev, body.tree);
      assert.equal(out.body.removed, 0);
      for (const [name, text] of Object.entries(others)) assert.equal(readFileSync(join(srv.dir, name), "utf8"), text, name + " is left as it was");
    } finally {
      await srv.stop();
    }
  });
});

describe("photos", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "disk" });
  });
  after(() => srv.stop());

  test("a JPEG is stored under a name made of its contents, and served back", async () => {
    const bytes = jpeg("one");
    const a = await postPhoto(srv.base, bytes);
    assert.equal(a.status, 200);
    assert.match(a.body.photo, /^[0-9a-f]{16}\.jpg$/);
    assert.deepEqual(readFileSync(join(srv.dir, "photos", a.body.photo)), bytes);
    const again = await postPhoto(srv.base, bytes);
    assert.equal(again.body.photo, a.body.photo);

    const r = await fetch(srv.base + "/api/photo/" + a.body.photo);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/jpeg");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.match(r.headers.get("cache-control") ?? "", /immutable/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes);
  });

  test("anything but a JPEG is refused", async () => {
    const r = await postPhoto(srv.base, Buffer.from("<svg onload=alert(1)>"));
    assert.equal(r.status, 400);
  });

  test("an unknown or malformed photo name is a 404", async () => {
    for (const name of ["0123456789abcdef.jpg", "..%2Fp1.json", "x.jpg", ""]) {
      assert.equal((await fetch(srv.base + "/api/photo/" + name)).status, 404, name);
    }
  });

  test("photos do not move the fingerprint", async () => {
    const before = (await getTree(srv.base)).body.rev;
    await postPhoto(srv.base, jpeg("fingerprint"));
    assert.equal((await getTree(srv.base)).body.rev, before);
  });

  test("a card keeps a well-formed photo name and drops any other", async () => {
    const { body: ph } = await postPhoto(srv.base, jpeg("card"));
    const { body: now } = await getTree(srv.base);
    const tree = {
      people: {
        p1: { id: "p1", name: "A", sex: "m", n: 1, photo: ph.photo },
        p2: { id: "p2", name: "B", sex: "f", n: 2, photo: "../../etc/passwd" },
      },
      links: [],
      pairs: [],
      sibs: [],
      seq: 2,
    };
    assert.equal((await postTree(srv.base, now.rev, tree)).status, 200);
    assert.equal(json(srv.dir, "p1.json").photo, ph.photo);
    assert.equal("photo" in json(srv.dir, "p2.json"), false);
    const { body: back } = await getTree(srv.base);
    assert.equal(back.tree.people.p1.photo, ph.photo);
  });

  test("the download carries the photos the cards show, and no other", async () => {
    const { body: shown } = await postPhoto(srv.base, jpeg("shown"));
    await postPhoto(srv.base, jpeg("nobody's"));
    const { body: now } = await getTree(srv.base);
    const tree = { people: { p1: { id: "p1", name: "A", sex: "m", n: 1, photo: shown.photo } }, links: [], pairs: [], sibs: [], seq: 1 };
    await postTree(srv.base, now.rev, tree);
    const files = unzipBytes(Buffer.from(await (await fetch(srv.base + "/api/download")).arrayBuffer()));
    const photos = Object.keys(files).filter((n) => n.startsWith("persons/photos/"));
    assert.deepEqual(photos, ["persons/photos/" + shown.photo]);
    assert.deepEqual(files[photos[0]], jpeg("shown"));
  });
});

describe("photos on a server in memory", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory" });
  });
  after(() => srv.stop());

  test("an archive brings its photos, and they are served", async () => {
    const name = "0123456789abcdef.jpg";
    const archive = zip({
      "persons/p1.json": card("p1", "A", { photo: name }),
      ["persons/photos/" + name]: jpeg("from the archive"),
      "persons/photos/fedcba9876543210.jpg": Buffer.from("not a jpeg"),
      ["__MACOSX/persons/photos/._" + name]: "junk",
    });
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(archive) });
    assert.equal(r.status, 200);
    const got = await fetch(srv.base + "/api/photo/" + name);
    assert.equal(got.status, 200);
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), jpeg("from the archive"));
    assert.equal((await fetch(srv.base + "/api/photo/fedcba9876543210.jpg")).status, 404);
    // and it leaves with the next download
    const files = unzipBytes(Buffer.from(await (await fetch(srv.base + "/api/download")).arrayBuffer()));
    assert.deepEqual(files["persons/photos/" + name], jpeg("from the archive"));
  });

  test("a photo posted to memory is served until the next archive replaces it", async () => {
    const { body } = await postPhoto(srv.base, jpeg("memory"));
    assert.equal((await fetch(srv.base + "/api/photo/" + body.photo)).status, 200);
    await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(zip({ "persons/p1.json": card("p1", "A") })) });
    assert.equal((await fetch(srv.base + "/api/photo/" + body.photo)).status, 404);
  });
});

describe("photos behind a password", () => {
  let srv: Running;
  before(async () => {
    srv = await startServer({ store: "memory", user: ["fam", "secret"] });
  });
  after(() => srv.stop());

  test("neither posting nor fetching a photo works without one", async () => {
    assert.equal((await postPhoto(srv.base, jpeg("x")).catch(() => ({ status: 401 }))).status, 401);
    const { body } = await postPhoto(srv.base, jpeg("x"), basic("fam", "secret"));
    assert.equal((await fetch(srv.base + "/api/photo/" + body.photo)).status, 401);
    assert.equal((await fetch(srv.base + "/api/photo/" + body.photo, { headers: basic("fam", "secret") })).status, 200);
  });
});

describe("an archive into an empty folder", () => {
  let srv: Running;
  before(async () => {
    // a view and a file that is nobody's card do not make a tree
    srv = await startServer({ store: "disk", files: { "_view.json": "{}\n", "notes.json": '{"title":"not a card"}\n' } });
  });
  after(() => srv.stop());

  test("an empty folder takes an archive, photos and all, and then refuses the next one", async () => {
    const name = "0123456789abcdef.jpg";
    const first = zip({
      "persons/p1.json": card("p1", "A", { photo: name }),
      "persons/_view.json": JSON.stringify({ timeline: true, gap: 1, hidden: [] }),
      ["persons/photos/" + name]: jpeg("restored"),
    });
    const r = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(first) });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).people, 1);
    assert.equal(json(srv.dir, "p1.json").photo, name);
    assert.deepEqual(readFileSync(join(srv.dir, "photos", name)), jpeg("restored"));
    assert.equal(readFileSync(join(srv.dir, "notes.json"), "utf8"), '{"title":"not a card"}\n');
    const { body } = await getTree(srv.base);
    assert.equal(body.tree.timeline, true);

    const second = await fetch(srv.base + "/api/upload", { method: "POST", body: new Uint8Array(zip({ "persons/p2.json": card("p2", "B") })) });
    assert.equal(second.status, 409);
    assert.equal(existsSync(join(srv.dir, "p2.json")), false);
    assert.deepEqual(Object.keys((await getTree(srv.base)).body.tree.people), ["p1"]);
  });
});
