/**
 * The two command-line tools, run the way a person runs them: `metrics.ts` on the
 * sample tree and on a folder, `smoke.mjs` against test servers of every kind.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { card, startServer, zip } from "../server/testing.ts";

const run = promisify(execFile);
const tool = (name: string) => join(import.meta.dirname, name);

/** Run a tool; its exit code and everything it printed. */
async function exec(name: string, ...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [tool(name), ...args]);
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code: number; stdout: string; stderr: string };
    return { code: err.code, out: err.stdout + err.stderr };
  }
}

test("metrics: both modes of the sample tree, with every figure", async () => {
  const { code, out } = await exec("metrics.ts", "seed");
  assert.equal(code, 0, out);
  assert.match(out, /=== by generations · people \d+ ===/);
  assert.match(out, /=== by years · people \d+ ===/);
  for (const line of ["overlapping cards", "lines through a card", "segments closer than 5 px", "slanted lines", "line crossings", "bus pairs", "arrows to children", "tree size"]) {
    assert.equal(out.split(line).length - 1, 2, line + " in both modes");
  }
  assert.match(out, /overlapping cards \.+ 0\n/, "the sample tree has no overlaps");
});

test("metrics: a persons folder, read the way the server reads it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "genealogy-metrics-"));
  try {
    await writeFile(join(dir, "a.json"), card("a", "Ivan", { spouses: ["b"] }));
    await writeFile(join(dir, "b.json"), card("b", "Maria", { spouses: ["a"] }));
    await writeFile(join(dir, "c.json"), card("c", "Oleg", { parents: ["a", "b"] }));
    await writeFile(join(dir, "notes.txt"), "not a card");
    const { code, out } = await exec("metrics.ts", dir);
    assert.equal(code, 0, out);
    assert.match(out, /people 3 ===/);
    assert.match(out, /arrows to children \.+ 1 vertical, 0 stepped/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("smoke: a folder on disk with a tree and a password passes, and refuses the archive back", async () => {
  const srv = await startServer({ user: ["u", "p"], files: { "a.json": card("a", "Ivan") } });
  try {
    const { code, out } = await exec("smoke.mjs", srv.base, "u", "p");
    assert.equal(code, 0, out);
    assert.match(out, /ok {2}without a password \/api\/tree gives 401/);
    assert.match(out, /ok {2}uploading over a tree on disk is refused/);
    assert.match(out, /people in the tree: 1, store: disk/);
    assert.match(out, /all checks passed/);
  } finally {
    await srv.stop();
  }
});

test("smoke: a server in memory takes its own archive back; an empty one refuses an empty archive", async () => {
  const mem = await startServer({ store: "memory" });
  try {
    const empty = await exec("smoke.mjs", mem.base);
    assert.equal(empty.code, 0, empty.out);
    assert.match(empty.out, /no password given/);
    assert.match(empty.out, /ok {2}nobody has opened it yet: an empty archive is refused/);

    const up = await fetch(mem.base + "/api/upload", { method: "POST", body: new Uint8Array(zip({ "persons/a.json": card("a", "Ivan") })) });
    assert.equal(up.status, 200);
    const full = await exec("smoke.mjs", mem.base);
    assert.equal(full.code, 0, full.out);
    assert.match(full.out, /ok {2}the same archive uploads back {2}— people=1/);
  } finally {
    await mem.stop();
  }
});

test("smoke: a wrong password and an absent server fail", async () => {
  const srv = await startServer({ user: ["u", "p"] });
  try {
    const wrong = await exec("smoke.mjs", srv.base, "u", "nope");
    assert.equal(wrong.code, 1);
    assert.match(wrong.out, /FAIL the app page is served/);
    assert.match(wrong.out, /FAIL \/api\/tree answers {2}— status 401/);
    assert.match(wrong.out, /check\(s\) FAILED/);
  } finally {
    await srv.stop();
  }
  const gone = await exec("smoke.mjs", srv.base);
  assert.equal(gone.code, 1);
  assert.match(gone.out, /FAIL {2}cannot reach/);
});
