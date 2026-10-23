/**
 * Smoke check for a running instance — local or remote. Not a replacement for
 * `npm test`: it does not touch the layout, it answers one question only, "is
 * the thing that was just deployed actually alive and complete".
 *
 * It never changes a tree: the archive round trip runs only against a server in
 * memory mode, and even there it puts back exactly what it took. A folder on disk
 * refuses an archive while it holds a tree, and an empty archive is refused anywhere.
 *
 *   node tools/smoke.mjs http://127.0.0.1:5179
 *   node tools/smoke.mjs https://example.org user pass
 */
const [base = "http://127.0.0.1:5179", user = "", pass = ""] = process.argv.slice(2);
const auth = user && pass ? { authorization: "Basic " + Buffer.from(user + ":" + pass).toString("base64") } : {};

let failed = 0;
const check = (ok, what, extra = "") => {
  if (!ok) failed++;
  console.log((ok ? "  ok  " : " FAIL ") + what + (extra ? "  — " + extra : ""));
};

const get = (path, opts = {}) => fetch(base + path, { ...opts, headers: { ...auth, ...(opts.headers ?? {}) } });

/* --- is it up at all --- */
let health;
try {
  health = await fetch(base + "/api/health");
} catch (e) {
  console.log(" FAIL  cannot reach " + base + "  — " + e.message);
  process.exit(1);
}
check(health.status === 200, "/api/health answers 200", "status " + health.status);

/* --- is the password actually asked for --- */
if (user && pass) {
  const bare = await fetch(base + "/api/tree");
  check(bare.status === 401, "without a password /api/tree gives 401", "status " + bare.status);
  const wrong = await fetch(base + "/api/tree", {
    headers: { authorization: "Basic " + Buffer.from(user + ":" + pass + "x").toString("base64") },
  });
  check(wrong.status === 401, "a wrong password gives 401", "status " + wrong.status);
} else {
  console.log("  --  no password given: the guard is not checked");
}

/* --- does the page come out --- */
const page = await get("/");
const html = await page.text();
check(page.status === 200 && html.includes("<html"), "the app page is served", html.length + " bytes");

/* --- does the tree read --- */
const treeRes = await get("/api/tree");
// a refusal (a wrong password) is text, not JSON: it fails the check, not the script
const tree = await treeRes.json().catch(() => ({}));
check(tree.ok === true, "/api/tree answers", "status " + treeRes.status + ", store=" + tree.store);
const people = Object.keys(tree.tree?.people ?? {}).length;
console.log("  --  people in the tree: " + people + ", store: " + tree.store);

/* --- does the archive come out, and does it go back in unchanged --- */
const dl = await get("/api/download");
const zip = Buffer.from(await dl.arrayBuffer());
check(dl.status === 200 && zip.length > 0, "the archive downloads", zip.length + " bytes");
check(zip.subarray(0, 2).toString() === "PK", "the archive really is a zip");

if (people && tree.store !== "memory") {
  const up = await get("/api/upload", { method: "POST", body: zip });
  check(up.status === 409, "uploading over a tree on disk is refused", "status " + up.status);
} else if (people) {
  const up = await get("/api/upload", { method: "POST", body: zip });
  const body = await up.json();
  check(up.ok && body.people === people, "the same archive uploads back", "people=" + body.people);
} else {
  // A freshly deployed instance is empty until someone opens the page: there is
  // no archive to put back yet, and an empty one is refused on purpose — it must
  // not be able to wipe a tree by accident.
  const empty = await get("/api/upload", { method: "POST", body: zip });
  check(empty.status === 400, "nobody has opened it yet: an empty archive is refused", "status " + empty.status);
}

const junk = await get("/api/upload", { method: "POST", body: Buffer.from("not an archive") });
check(junk.status === 400, "junk instead of an archive is refused with 400", "status " + junk.status);

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
