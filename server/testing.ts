/**
 * What the server tests stand on. Each test group gets a real `node server.mjs` on a
 * free port with a temporary folder of its own, and takes it down afterwards. The
 * server is driven over HTTP only — the boundary a browser, the backup and the smoke
 * check use — so the tests do not care how the server is put together inside, which
 * is exactly what lets them guard a rewrite of it.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, inflateRawSync } from "node:zlib";

const ROOT = join(import.meta.dirname, "..");

export interface ServerOptions {
  store?: "disk" | "memory";
  /** GENEALOGY_USER and GENEALOGY_PASS */
  user?: [string, string];
  /** GENEALOGY_ADMIN_USER and GENEALOGY_ADMIN_PASS */
  admin?: [string, string];
  /** turn on LOG_DIR: the request log and logins.jsonl, in a folder of their own */
  logs?: boolean;
  /** files to put into the persons folder before the server starts */
  files?: Record<string, string>;
  /** more environment, set after the developer's own GENEALOGY_* and LOG_* are cleared */
  env?: Record<string, string>;
}

export interface Running {
  /** http://127.0.0.1:<port> */
  base: string;
  /** the persons folder of the disk store */
  dir: string;
  /** the log folder, or "" when logs are off */
  logs: string;
  /** everything the server has printed so far */
  output: () => string;
  stop: () => Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const at = probe.address();
      const port = typeof at === "object" && at ? at.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export async function startServer(opts: ServerOptions = {}): Promise<Running> {
  const home = await mkdtemp(join(tmpdir(), "genealogy-test-"));
  const dir = join(home, "persons");
  const logs = opts.logs ? join(home, "logs") : "";
  if (opts.files) {
    await mkdir(dir, { recursive: true });
    for (const [name, text] of Object.entries(opts.files)) await writeFile(join(dir, name), text);
  }

  // the developer's own settings must not leak into a test server
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(GENEALOGY_|LOG_)/.test(k) && k !== "PORT" && k !== "HOST") env[k] = v;
  }
  if (opts.user) [env.GENEALOGY_USER, env.GENEALOGY_PASS] = opts.user;
  if (opts.admin) [env.GENEALOGY_ADMIN_USER, env.GENEALOGY_ADMIN_PASS] = opts.admin;
  if (logs) env.LOG_DIR = logs;
  Object.assign(env, opts.env);

  const port = await freePort();
  const args = ["--port", String(port), "--host", "127.0.0.1", "--store", opts.store ?? "disk", "--dir", dir];
  const child = spawn(process.execPath, [join(ROOT, "server.mjs"), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => (out += c));
  child.stderr.on("data", (c) => (out += c));

  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 10_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error("the test server exited:\n" + out);
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > until) {
      child.kill();
      throw new Error("the test server did not come up:\n" + out);
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const stop = async () => {
    if (child.exitCode === null) {
      const gone = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      await gone;
    }
    await rm(home, { recursive: true, force: true });
  };
  return { base, dir, logs, output: () => out, stop };
}

/* ---------------------------------- HTTP ---------------------------------- */

export const basic = (user: string, pass: string): Record<string, string> => ({
  authorization: "Basic " + Buffer.from(user + ":" + pass).toString("base64"),
});

/** Sign in through the form, as a browser does: the cookie to send back, or "". */
export async function login(base: string, user: string, pass: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(base + "/login", {
    method: "POST",
    headers,
    body: new URLSearchParams({ u: user, p: pass }),
    redirect: "manual",
  });
  return (r.headers.get("set-cookie") ?? "").split(";")[0];
}

export async function getTree(base: string, headers: Record<string, string> = {}) {
  const r = await fetch(base + "/api/tree", { headers });
  return { status: r.status, body: await r.json() };
}

export async function postTree(base: string, rev: string, tree: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + "/api/tree", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ rev, tree }),
  });
  return { status: r.status, body: await r.json() };
}

/**
 * A POST whose body reaches the server in two separate TCP writes, split at `at`
 * bytes — the way a large body arrives over a real network.
 */
export function postInTwoParts(base: string, path: string, body: Buffer, at: number): Promise<{ status: number; text: string }> {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: url.pathname, method: "POST", headers: { "content-type": "application/json", "content-length": body.length } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      },
    );
    req.on("error", reject);
    req.flushHeaders();
    req.write(body.subarray(0, at));
    setTimeout(() => req.end(body.subarray(at)), 80);
  });
}

/* ----------------------------------- zip ---------------------------------- */

/** A zip with stored, uncompressed entries — enough for the server to read. */
export function zip(files: Record<string, string | Buffer>): Buffer {
  const parts: Buffer[] = [];
  const index: Buffer[] = [];
  let at = 0;
  const names = Object.keys(files);
  for (const name of names) {
    const n = Buffer.from(name, "utf8");
    const body = Buffer.from(files[name]);
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(body.length, 24);
    entry.writeUInt16LE(n.length, 28);
    entry.writeUInt32LE(at, 42);
    index.push(entry, n);
    at += 30 + n.length + body.length;
  }
  const list = Buffer.concat(index);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(list.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([...parts, list, end]);
}

/** Read a zip the server sent: name -> text, stored or deflated entries. */
export function unzip(buf: Buffer): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipBytes(buf)).map(([name, bytes]) => [name, bytes.toString("utf8")]));
}

/** The same, name -> bytes: what photos are read with. */
export function unzipBytes(buf: Buffer): Record<string, Buffer> {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip archive");
  const out: Record<string, Buffer> = {};
  let p = buf.readUInt32LE(end + 16);
  for (let i = buf.readUInt16LE(end + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const from = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(from, from + packed);
    out[name] = method === 8 ? inflateRawSync(body) : Buffer.from(body);
  }
  return out;
}

/* --------------------------------- photos --------------------------------- */

/** Bytes that pass for a JPEG: the server checks only how a JPEG starts. */
export const jpeg = (tail: string): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(tail)]);

export async function postPhoto(base: string, bytes: Buffer, headers: Record<string, string> = {}) {
  const r = await fetch(base + "/api/photo", { method: "POST", headers, body: new Uint8Array(bytes) });
  return { status: r.status, body: await r.json() };
}

/* ---------------------------------- cards --------------------------------- */

/** A card as it lies in persons/, with the fields the server writes. */
export const card = (id: string, name: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ id, name, maiden: "", alt: [], born: "", died: "", sex: "u", n: 1, parents: [], spouses: [], siblings: [], ...extra }, null, 2) + "\n";
