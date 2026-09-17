/**
 * Genealogy server: serves the built app and keeps people — one file per person.
 *
 * Two stores, sharing the same tree parsing:
 *
 *   disk   — the persons/ folder, a file per person. This is how it all works locally.
 *   memory — nothing is written to disk at all. The tree arrives as a zip through
 *            "Upload archive", gets edited, and leaves through "Download archive";
 *            a restart loses it. The remote machine runs this mode: no one else's
 *            relatives are left behind on it.
 *
 * Not a single dependency.
 *
 *   node server.mjs                                # http://127.0.0.1:5179, persons/
 *   node server.mjs --port 8080
 *   node server.mjs --dir /path/to/folder          # keep people somewhere else
 *   node server.mjs --store memory --host 0.0.0.0  # this is how the container runs it
 *
 * The password lives in GENEALOGY_USER and GENEALOGY_PASS. While they are empty
 * the server is open: on your own machine a password is pointless. On someone
 * else's it is mandatory — anyone who reaches the port can rewrite the tree.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, gzipSync, inflateRawSync } from "node:zlib";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Value of a command line key: `--dir /path`, `--port 8080`. */
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : undefined;
};

const dirArg = arg("--dir");
const PERSONS = dirArg ? resolve(dirArg) : join(ROOT, "persons");
const DIST = join(ROOT, "dist");
const VIEW = "_view.json"; // canvas settings; does not look like a person, hence the underscore

const PORT = Number(arg("--port") ?? process.env.PORT ?? 5179);
// by default we listen to ourselves only: the server writes to the file system
const HOST = arg("--host") ?? process.env.HOST ?? "127.0.0.1";
const MODE = arg("--store") ?? process.env.GENEALOGY_STORE ?? "disk";

/** An id ends up in a file name, so only harmless ones get through. */
const okId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

/* -------------------------------- password ------------------------------- */

const USER = process.env.GENEALOGY_USER ?? "";
const PASS = process.env.GENEALOGY_PASS ?? "";
const GUARDED = !!(USER && PASS);

/** Comparison in constant time, over digests so the length does not leak. */
const same = (a, b) =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

/** Let through if no password is set or the header matches. */
function allowed(req) {
  if (!GUARDED) return true;
  const head = req.headers.authorization ?? "";
  if (!head.startsWith("Basic ")) return false;
  try {
    return same(Buffer.from(head.slice(6), "base64").toString("utf8"), USER + ":" + PASS);
  } catch {
    return false;
  }
}

/* ----------------------------------- log ---------------------------------- */

/**
 * One line per request into LOG_DIR/access.log. Without LOG_DIR nothing is
 * written: on your own machine the terminal is enough.
 *
 * When the file reaches LOG_MAX it is rotated. access.log is gzipped into
 * access.log.1.gz, the older ones shift up by one, and anything past LOG_KEEP is
 * removed — so at most LOG_KEEP compressed files are kept besides the live one.
 *
 * Headers and bodies never reach the log: the password is in one and the family
 * is in the other. Only the path is written, never the query string.
 */
const LOG_DIR = process.env.LOG_DIR ?? "";
const LOG_MAX = Number(process.env.LOG_MAX ?? 10e6); // 10 MB
const LOG_KEEP = Number(process.env.LOG_KEEP ?? 3);
const LOG_FILE = LOG_DIR ? join(LOG_DIR, "access.log") : "";

let logged = 0; // bytes in the live file

if (LOG_DIR) {
  mkdirSync(LOG_DIR, { recursive: true });
  try {
    logged = statSync(LOG_FILE).size; // picking up after a restart
  } catch {
    logged = 0;
  }
}

const gzName = (n) => LOG_FILE + "." + n + ".gz";

/**
 * Rotation is synchronous on purpose. It happens once per LOG_MAX bytes — tens
 * of thousands of requests apart — and a pause of a fraction of a second is a
 * fair price for never interleaving a rotation with a write.
 */
function rotate() {
  try {
    rmSync(gzName(LOG_KEEP), { force: true }); // the oldest one goes
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      try {
        renameSync(gzName(i), gzName(i + 1));
      } catch {
        /* that number does not exist yet */
      }
    }
    if (LOG_KEEP >= 1) writeFileSync(gzName(1), gzipSync(readFileSync(LOG_FILE)));
    rmSync(LOG_FILE, { force: true });
  } catch (e) {
    console.error("log rotation failed: " + (e && e.message));
  }
  logged = 0;
}

/** Trim anything that could break the line apart. */
const clean = (v, max) => String(v ?? "-").replace(/[\r\n\t]+/g, " ").slice(0, max) || "-";

function logRequest(req, res, started) {
  if (!LOG_DIR) return;
  // behind a proxy the real address comes in a header; without one it is the socket
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const ip = (fwd || req.socket?.remoteAddress || "-").replace(/^::ffff:/, "");
  const line =
    [
      new Date().toISOString(),
      clean(ip, 45),
      clean(req.method, 8),
      clean(String(req.url ?? "").split("?")[0], 200), // path only
      res.statusCode,
      Date.now() - started + "ms",
      '"' + clean(req.headers["user-agent"], 120) + '"',
    ].join(" ") + "\n";
  try {
    appendFileSync(LOG_FILE, line);
    logged += Buffer.byteLength(line);
    if (logged >= LOG_MAX) rotate();
  } catch (e) {
    console.error("could not write the log: " + (e && e.message));
  }
}

/* ----------------------------------- zip ---------------------------------- */

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const SIG_LOCAL = 0x04034b50;
const SIG_ENTRY = 0x02014b50;
const SIG_END = 0x06054b50;
const DOS_1980 = 0x21; // a fixed date: the same tree gives the same archive

/** Build a zip from "name → text". The files are small and textual, so pack them in one go. */
function zipWrite(files) {
  const chunks = [];
  const index = [];
  let at = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const packed = deflateRawSync(raw, { level: 9 });
    // if compression did not help, store it as is
    const deflated = packed.length < raw.length;
    const body = deflated ? packed : raw;
    const sum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names in UTF-8
    local.writeUInt16LE(deflated ? 8 : 0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_1980, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(SIG_ENTRY, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(deflated ? 8 : 0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(DOS_1980, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(0, 30); // extra and comment length
    entry.writeUInt32LE(0, 34); // disk number and internal attributes
    entry.writeUInt32LE(0, 38); // external attributes
    entry.writeUInt32LE(at, 42);

    chunks.push(local, nameBuf, body);
    index.push(entry, nameBuf);
    at += local.length + nameBuf.length + body.length;
  }

  const listSize = index.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(listSize, 12);
  end.writeUInt32LE(at, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...index, end]);
}

const MAX_ENTRIES = 5000;
const MAX_UNPACKED = 64e6; // an unpacked archive must not eat the server's memory

/** Parse a zip into "name → text". We read the index at the end, as one should. */
function zipRead(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === SIG_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("this is not a zip archive");

  const count = buf.readUInt16LE(end + 10);
  const listAt = buf.readUInt32LE(end + 16);
  if (count === 0xffff || listAt === 0xffffffff) throw new Error("this server does not read zip64");
  if (count > MAX_ENTRIES) throw new Error("too many files in the archive");

  const out = new Map();
  let p = listAt;
  let unpacked = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_ENTRY) throw new Error("the archive index is damaged");
    const method = buf.readUInt16LE(p + 10);
    const packedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue; // a folder, not a file
    unpacked += size;
    if (unpacked > MAX_UNPACKED) throw new Error("the archive is too large unpacked");
    if (method !== 0 && method !== 8) throw new Error("unknown compression in the archive: " + name);
    if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== SIG_LOCAL) {
      throw new Error("a file went missing inside the archive: " + name);
    }
    const from = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const body = buf.subarray(from, from + packedSize);
    out.set(name, (method === 8 ? inflateRawSync(body) : body).toString("utf8"));
  }
  return out;
}

/**
 * From the archive we take cards only. The folder inside the archive does not
 * matter — we take the short name, so both `persons/p1.json` and plain `p1.json`
 * land the same way. macOS litter (`__MACOSX`, `._name`, `.DS_Store`) is dropped
 * silently: it is always in there.
 */
function cardsOf(entries) {
  const out = new Map();
  for (const [name, text] of entries) {
    if (name.includes("__MACOSX/")) continue;
    const base = name.slice(name.lastIndexOf("/") + 1);
    if (base.startsWith("._") || base === ".DS_Store" || !base.endsWith(".json")) continue;
    if (base !== VIEW && !okId(base.slice(0, -5))) continue;
    out.set(base, text);
  }
  return out;
}

/* --------------------------------- stores -------------------------------- */

/** We write through a temporary file: an interrupted write will not spoil the existing one. */
async function writeAtomic(path, text) {
  const tmp = path + ".tmp";
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

/**
 * A folder on disk. The fingerprint comes from file mtime and size: the tab sends
 * the one it saw last, and if something on disk changed since then the write is
 * refused. Without this a forgotten open tab with an old tree used to overwrite
 * fresh edits.
 */
const diskStore = {
  kind: "disk",
  where: PERSONS,
  async names() {
    try {
      return (await readdir(PERSONS)).filter((n) => n.endsWith(".json"));
    } catch {
      return null; // the directory does not exist yet — the app will seed it itself
    }
  },
  read: (name) => readFile(join(PERSONS, name), "utf8"),
  async write(name, text) {
    await mkdir(PERSONS, { recursive: true });
    let old = null;
    try {
      old = await readFile(join(PERSONS, name), "utf8");
    } catch {
      /* no file yet — just create it */
    }
    // rewrite only if the file really changed: mtime is part of the fingerprint
    if (old === text) return false;
    await writeAtomic(join(PERSONS, name), text);
    return true;
  },
  remove: (name) => unlink(join(PERSONS, name)),
  async rev() {
    const names = await diskStore.names();
    if (!names) return "empty";
    const parts = [];
    for (const n of names.sort()) {
      const st = await stat(join(PERSONS, n));
      parts.push(n + ":" + Math.round(st.mtimeMs) + ":" + st.size);
    }
    return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
  },
};

/**
 * The same thing, but in memory: nothing reaches the disk. The fingerprint is
 * computed over the contents — there is no mtime to take here, and the meaning
 * of it is the same.
 */
const memStore = {
  kind: "memory",
  where: "server memory",
  files: new Map(),
  async names() {
    return memStore.files.size ? [...memStore.files.keys()] : null;
  },
  async read(name) {
    return memStore.files.get(name) ?? "";
  },
  async write(name, text) {
    if (memStore.files.get(name) === text) return false;
    memStore.files.set(name, text);
    return true;
  },
  async remove(name) {
    memStore.files.delete(name);
  },
  async rev() {
    if (!memStore.files.size) return "empty";
    const sum = createHash("sha1");
    for (const n of [...memStore.files.keys()].sort()) sum.update(n).update(memStore.files.get(n));
    return sum.digest("hex").slice(0, 16);
  },
};

const store = MODE === "memory" ? memStore : diskStore;

/** A mutual link is written in both cards — it reaches the tree once. */
function collect(others, id, kind, seen, out) {
  for (const b of others) {
    if (!okId(b)) continue;
    const key = kind + "|" + [id, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: id, b });
  }
}

/* ---------------------------- reading the store --------------------------- */

async function readTree() {
  const names = await store.names();
  if (!names) return null; // empty — the app will seed it itself
  const people = {};
  const links = [];
  const pairs = [];
  const sibs = [];
  const seen = new Set();
  let view = {};

  for (const name of [...names].sort()) {
    let raw;
    try {
      raw = JSON.parse(await store.read(name));
    } catch (e) {
      console.warn("skipping " + name + ": " + e.message);
      continue;
    }
    if (name === VIEW) {
      view = raw || {};
      continue;
    }
    if (name.startsWith("_")) continue;
    const id = okId(raw?.id) ? raw.id : name.slice(0, -5);
    if (!okId(id)) continue;
    const { parents = [], spouses = [], siblings = [], ...person } = raw || {};
    people[id] = { ...person, id };
    for (const p of parents) if (okId(p)) links.push({ parent: p, child: id });
    // a marriage and an explicit kinship are written in both cards — take each pair once
    collect(spouses, id, "sp", seen, pairs);
    collect(siblings, id, "sib", seen, sibs);
  }

  // links to people who disappeared are dropped silently
  const alive = (id) => Object.hasOwn(people, id);
  return {
    people,
    links: links.filter((l) => alive(l.parent) && alive(l.child)),
    pairs: pairs.filter((p) => alive(p.a) && alive(p.b)),
    sibs: sibs.filter((p) => alive(p.a) && alive(p.b)),
    timeline: !!view.timeline,
    gap: typeof view.gap === "number" ? view.gap : 1,
    hidden: Array.isArray(view.hidden) ? view.hidden.filter((id) => okId(id) && alive(id)) : [],
    seq: Object.values(people).reduce((m, p) => Math.max(m, p.n || 0), 0),
  };
}

/* ---------------------------- writing the store --------------------------- */

async function writeTree(tree) {
  const people = tree?.people && typeof tree.people === "object" ? tree.people : {};
  const ids = Object.keys(people).filter(okId);

  const blank = () => Object.fromEntries(ids.map((id) => [id, []]));
  const parents = blank();
  const spouses = blank();
  const siblings = blank();

  /** A mutual link is written into both cards — otherwise half of it is lost. */
  const both = (list, into) => {
    for (const p of list || []) {
      if (!people[p.a] || !people[p.b] || !into[p.a] || !into[p.b]) continue;
      if (!into[p.a].includes(p.b)) into[p.a].push(p.b);
      if (!into[p.b].includes(p.a)) into[p.b].push(p.a);
    }
  };

  for (const l of tree.links || []) {
    if (parents[l.child] && people[l.parent] && !parents[l.child].includes(l.parent)) {
      parents[l.child].push(l.parent);
    }
  }
  both(tree.pairs, spouses);
  both(tree.sibs, siblings);

  let written = 0;
  for (const id of ids) {
    const p = people[id];
    const doc = {
      id,
      name: String(p.name ?? ""),
      maiden: p.maiden || "",
      alt: Array.isArray(p.alt) ? p.alt : [],
      born: p.born || "",
      died: p.died || "",
      sex: p.sex || "u",
      n: p.n || 0,
      parents: parents[id],
      spouses: spouses[id],
      siblings: siblings[id],
    };
    if (typeof p.fx === "number" && typeof p.fy === "number") {
      doc.fx = Math.round(p.fx * 100) / 100;
      doc.fy = Math.round(p.fy * 100) / 100;
    }
    if (await store.write(id + ".json", JSON.stringify(doc, null, 2) + "\n")) written++;
  }

  const hidden = Array.isArray(tree.hidden) ? tree.hidden.filter((id) => okId(id) && people[id]) : [];
  const viewText = JSON.stringify({ timeline: !!tree.timeline, gap: tree.gap ?? 1, hidden }, null, 2) + "\n";
  await store.write(VIEW, viewText);

  // deleted people leave together with their files
  let removed = 0;
  const keep = new Set(ids.map((id) => id + ".json"));
  for (const name of (await store.names()) ?? []) {
    if (name.startsWith("_") || keep.has(name)) continue;
    await store.remove(name);
    removed++;
  }
  return { written, removed, total: ids.length };
}

/* --------------------------------- server -------------------------------- */

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" };
const MAX_BODY = 32e6;

const readBody = (req) =>
  new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) rej(new Error("request body too large"));
    });
    req.on("end", () => res(data));
    req.on("error", rej);
  });

/** An archive arrives as it is, in bytes: collecting it into a string is not an option. */
const readBuffer = (req) =>
  new Promise((res, rej) => {
    const parts = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) return rej(new Error("archive too large"));
      parts.push(c);
    });
    req.on("end", () => res(Buffer.concat(parts)));
    req.on("error", rej);
  });

/** A timestamp for the log line. */
const now = () => new Date().toISOString().slice(11, 19);

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

let queue = Promise.resolve(); // writes go in turn so they do not step on each other

const server = createServer(async (req, res) => {
  // written once the answer has gone out, so the status is the real one
  const started = Date.now();
  res.on("finish", () => logRequest(req, res, started));

  try {
    // The only thing open without a password: "are you alive". No people and no
    // count of them here — docker needs it to tell whether the container came up.
    if (req.url === "/api/health") return json(res, 200, { ok: true });

    if (!allowed(req)) {
      res.writeHead(401, {
        "www-authenticate": 'Basic realm="Genealogy", charset="UTF-8"',
        "content-type": "text/plain; charset=utf-8",
      });
      return res.end("A password is needed\n");
    }

    const url = new URL(req.url, "http://" + (req.headers.host ?? "127.0.0.1"));

    if (url.pathname === "/api/tree" && req.method === "GET") {
      const tree = await readTree();
      return json(res, 200, { ok: true, tree, dir: store.where, store: store.kind, rev: await store.rev() });
    }

    if (url.pathname === "/api/tree" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body || typeof body.rev !== "string" || !body.tree) {
        return json(res, 400, { ok: false, error: "a write without a version fingerprint is not accepted" });
      }
      const run = async () => {
        const now = await store.rev();
        if (body.rev !== now) return { conflict: true, rev: now };
        const st = await writeTree(body.tree);
        return { ...st, rev: await store.rev() };
      };
      const out = await (queue = queue.then(run, run));
      if (out.conflict) {
        console.log(
          now() + "  write refused: the tab had not seen the latest edits",
        );
        return json(res, 409, { ok: false, conflict: true, rev: out.rev });
      }
      if (out.written || out.removed) {
        console.log(
          new Date().toLocaleTimeString("ru-RU") +
            "  people: " + out.total +
            ", written: " + out.written +
            (out.removed ? ", removed: " + out.removed : ""),
        );
      }
      return json(res, 200, { ok: true, ...out });
    }

    // An archive of cards replaces the whole tree. Into a folder on disk this is
    // not allowed: that is the user's data, and we will not wipe it in one request.
    if (url.pathname === "/api/upload" && req.method === "POST") {
      if (store.kind !== "memory") {
        return json(res, 409, { ok: false, error: "the server writes into a folder on disk — an archive cannot be uploaded here" });
      }
      let cards;
      try {
        cards = cardsOf(zipRead(await readBuffer(req)));
      } catch (e) {
        return json(res, 400, { ok: false, error: String(e && e.message) });
      }
      if (!cards.size) return json(res, 400, { ok: false, error: "there are no cards (.json) in the archive" });
      const run = async () => {
        memStore.files = cards;
        return { tree: await readTree(), rev: await store.rev() };
      };
      const out = await (queue = queue.then(run, run));
      const people = Object.keys(out.tree?.people ?? {}).length;
      console.log(now() + "  archive loaded, people: " + people);
      return json(res, 200, { ok: true, people, ...out });
    }

    // The same files that would lie in persons/, only as one archive.
    if (url.pathname === "/api/download" && req.method === "GET") {
      const names = (await store.names()) ?? [];
      const files = new Map();
      for (const n of [...names].sort()) files.set("persons/" + n, await store.read(n));
      const zip = zipWrite(files);
      res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="persons.zip"',
        "content-length": zip.length,
        "cache-control": "no-store",
      });
      return res.end(zip);
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { ok: false, error: "no such method" });

    // everything else is the app itself
    const file = url.pathname === "/" || url.pathname === "/index.html" ? "genealogy.html" : url.pathname.slice(1);
    if (file.includes("..") || file.startsWith("/")) return json(res, 400, { ok: false, error: "bad path" });
    try {
      const body = await readFile(join(DIST, file));
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("The app has not been built. Run: npm run build\n");
    }
  } catch (e) {
    console.error(e);
    json(res, 500, { ok: false, error: String(e && e.message) });
  }
});

server.listen(PORT, HOST, () => {
  console.log("Genealogy: http://" + HOST + ":" + PORT);
  console.log(store.kind === "memory" ? "People in memory: a restart loses them" : "People on disk: " + PERSONS);
  if (LOG_DIR) {
    console.log(
      "Requests: " + LOG_FILE + " (rotated at " + Math.round(LOG_MAX / 1e6) + " MB, " + LOG_KEEP + " kept gzipped)",
    );
  }
  if (!GUARDED && HOST !== "127.0.0.1") {
    console.warn("WARNING: the port is open to the outside with no password. Set GENEALOGY_USER and GENEALOGY_PASS.");
  }
  console.log("Stop it with Ctrl+C");
});
