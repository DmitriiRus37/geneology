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
import { basic, card, getTree, login, postInTwoParts, postTree, startServer, unzip, zip, type Running } from "./testing.ts";

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

  test("an archive cannot be uploaded into a folder", async () => {
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

  test("known issue SRV-V3: an archive holding only the view file is accepted and wipes the tree", async () => {
    const r = await fetch(srv.base + "/api/upload", {
      method: "POST",
      body: new Uint8Array(zip({ "persons/_view.json": '{"timeline":false,"gap":1,"hidden":[]}' })),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).people, 0);
    assert.deepEqual((await getTree(srv.base)).body.tree.people, {});
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

  const lastRow = () => {
    const lines = readFileSync(join(srv.logs, "logins.jsonl"), "utf8").trim().split("\n");
    return JSON.parse(lines[lines.length - 1]);
  };

  test("known issue SRV-6: X-Forwarded-For from any client is taken as the address", async () => {
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": "10.9.8.7" });
    assert.equal(lastRow().address, "10.9.8.7");
  });

  test("known issue ARC-V1: an overlong X-Forwarded-For is stored uncut", async () => {
    const long = "1".repeat(4000);
    await login(srv.base, "anna", "wrong", { "x-forwarded-for": long });
    assert.equal(lastRow().address, long);
  });
});

describe("known issues of the folder store", () => {
  test("known issue SRV-1: a letter split between two parts of the body is stored broken", async () => {
    const srv = await startServer({ store: "memory" });
    try {
      const name = "Иван Петрович Орлов";
      const body = Buffer.from(JSON.stringify({ rev: "empty", tree: { ...TREE, people: { p1: { ...TREE.people.p1, name } }, links: [], pairs: [], sibs: [], hidden: [] } }));
      const at = body.indexOf(Buffer.from("И")) + 1; // between the two bytes of "И"
      const r = await postInTwoParts(srv.base, "/api/tree", body, at);
      assert.equal(r.status, 200);
      assert.equal((await getTree(srv.base)).body.tree.people.p1.name, "��ван Петрович Орлов");
    } finally {
      await srv.stop();
    }
  });

  test("known issue SRV-2: a card that does not parse is deleted by the next write", async () => {
    const srv = await startServer({
      store: "disk",
      files: { "p1.json": card("p1", "Иван Петрович Орлов"), "p2.json": card("p2", "Анна Сергеевна Орлова").replace('"name"', '"name":,') },
    });
    try {
      const { body } = await getTree(srv.base);
      assert.deepEqual(Object.keys(body.tree.people), ["p1"], "the broken card is skipped on read");
      const out = await postTree(srv.base, body.rev, body.tree);
      assert.equal(out.body.removed, 1);
      assert.equal(existsSync(join(srv.dir, "p2.json")), false);
    } finally {
      await srv.stop();
    }
  });

  test("known issue SRV-5: one card with parents set to null fails the whole read", async () => {
    const srv = await startServer({
      store: "disk",
      files: { "p1.json": card("p1", "Иван Петрович Орлов"), "p2.json": card("p2", "Анна Сергеевна Орлова", { parents: null }) },
    });
    try {
      assert.equal((await getTree(srv.base)).status, 500);
    } finally {
      await srv.stop();
    }
  });

  test("known issue ARC-V2: other JSON files in the folder are taken for cards, rewritten or deleted", async () => {
    const srv = await startServer({
      store: "disk",
      files: {
        "p1.json": card("p1", "Иван Петрович Орлов"),
        "settings.json": '{"theme":"dark"}\n',
        "genealogy (1).json": "{}\n",
      },
    });
    try {
      const { body } = await getTree(srv.base);
      assert.deepEqual(Object.keys(body.tree.people).sort(), ["p1", "settings"], "a file whose name passes as an id becomes a person");
      await postTree(srv.base, body.rev, body.tree);
      const settings = json(srv.dir, "settings.json");
      assert.equal(settings.id, "settings");
      assert.equal("theme" in settings, false, "its own content is gone");
      assert.equal(existsSync(join(srv.dir, "genealogy (1).json")), false, "a file whose name is not an id is deleted");
    } finally {
      await srv.stop();
    }
  });
});
