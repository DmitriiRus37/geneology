/**
 * Локальный сервер родословной: отдаёт собранное приложение и хранит людей
 * на диске — по файлу на человека в persons/.
 *
 * Без единой зависимости. Слушает только 127.0.0.1: он пишет в вашу файловую
 * систему, и из сети его быть не должно.
 *
 *   node server.mjs                     # http://127.0.0.1:5179, данные в persons/
 *   node server.mjs --port 8080
 *   node server.mjs --dir /путь/к/папке  # держать людей в другом месте
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

/** Значение ключа командной строки: `--dir /путь`, `--port 8080`. */
const arg = (name) => {
  const at = process.argv.indexOf(name);
  return at > -1 ? process.argv[at + 1] : undefined;
};

const dirArg = arg("--dir");
const PERSONS = dirArg ? resolve(dirArg) : join(ROOT, "persons");
const DIST = join(ROOT, "dist");
const VIEW = "_view.json"; // настройки холста; на человека не похоже, поэтому с подчёркивания

const PORT = Number(arg("--port") ?? 5179);

/** id попадает в имя файла, поэтому пропускаем только безобидные. */
const okId = (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);

const fileOf = (id) => join(PERSONS, id + ".json");

/** Пишем через временный файл: оборванная запись не испортит существующий. */
async function writeAtomic(path, text) {
  const tmp = path + ".tmp";
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

/** Переписываем файл, только если он и правда изменился: mtime — часть отпечатка папки. */
async function writeIfChanged(path, text) {
  let old = null;
  try {
    old = await readFile(path, "utf8");
  } catch {
    /* файла ещё нет — просто создаём */
  }
  if (old === text) return false;
  await writeAtomic(path, text);
  return true;
}

/**
 * Отпечаток состояния папки. Вкладка присылает тот отпечаток, который видела
 * последним; если на диске с тех пор что-то изменилось — запись отклоняется.
 * Без этого забытая открытая вкладка со старым древом затирала свежие правки.
 */
async function revOf() {
  let names;
  try {
    names = await readdir(PERSONS);
  } catch {
    return "empty";
  }
  const parts = [];
  for (const n of names.sort()) {
    if (!n.endsWith(".json")) continue;
    const st = await stat(join(PERSONS, n));
    parts.push(n + ":" + Math.round(st.mtimeMs) + ":" + st.size);
  }
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Взаимная связь записана в обеих карточках — в древо она попадает один раз. */
function collect(others, id, kind, seen, out) {
  for (const b of others) {
    if (!okId(b)) continue;
    const key = kind + "|" + [id, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ a: id, b });
  }
}

/* ---------------------------- чтение с диска ---------------------------- */

async function readTree() {
  let names = [];
  try {
    names = await readdir(PERSONS);
  } catch {
    return null; // директории ещё нет — приложение засеет её само
  }
  const people = {};
  const links = [];
  const pairs = [];
  const sibs = [];
  const seen = new Set();
  let view = {};

  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    let raw;
    try {
      raw = JSON.parse(await readFile(join(PERSONS, name), "utf8"));
    } catch (e) {
      console.warn("пропускаю " + name + ": " + e.message);
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
    // и брак, и явное родство записаны у обоих — берём каждую пару по одному разу
    collect(spouses, id, "sp", seen, pairs);
    collect(siblings, id, "sib", seen, sibs);
  }

  // связи на исчезнувших людей выкидываем молча
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

/* ---------------------------- запись на диск ---------------------------- */

async function writeTree(tree) {
  await mkdir(PERSONS, { recursive: true });
  const people = tree?.people && typeof tree.people === "object" ? tree.people : {};
  const ids = Object.keys(people).filter(okId);

  const blank = () => Object.fromEntries(ids.map((id) => [id, []]));
  const parents = blank();
  const spouses = blank();
  const siblings = blank();

  /** Взаимная связь пишется в обе карточки — иначе половина её потеряется. */
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
    if (await writeIfChanged(fileOf(id), JSON.stringify(doc, null, 2) + "\n")) written++;
  }

  const hidden = Array.isArray(tree.hidden) ? tree.hidden.filter((id) => okId(id) && people[id]) : [];
  const viewText = JSON.stringify({ timeline: !!tree.timeline, gap: tree.gap ?? 1, hidden }, null, 2) + "\n";
  await writeIfChanged(join(PERSONS, VIEW), viewText);

  // удалённые люди уходят вместе со своими файлами
  let removed = 0;
  const keep = new Set(ids.map((id) => id + ".json"));
  for (const name of await readdir(PERSONS)) {
    if (!name.endsWith(".json") || name.startsWith("_") || keep.has(name)) continue;
    await unlink(join(PERSONS, name));
    removed++;
  }
  return { written, removed, total: ids.length };
}

/* -------------------------------- сервер -------------------------------- */

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8" };

const readBody = (req) =>
  new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 32e6) rej(new Error("слишком большое тело запроса"));
    });
    req.on("end", () => res(data));
    req.on("error", rej);
  });

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

let queue = Promise.resolve(); // записи идут по очереди, чтобы не наступать друг на друга

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");

    if (url.pathname === "/api/tree" && req.method === "GET") {
      const tree = await readTree();
      return json(res, 200, { ok: true, tree, dir: PERSONS, rev: await revOf() });
    }

    if (url.pathname === "/api/tree" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body || typeof body.rev !== "string" || !body.tree) {
        return json(res, 400, { ok: false, error: "запись без отпечатка версии не принимается" });
      }
      const run = async () => {
        const now = await revOf();
        if (body.rev !== now) return { conflict: true, rev: now };
        const st = await writeTree(body.tree);
        return { ...st, rev: await revOf() };
      };
      const out = await (queue = queue.then(run, run));
      if (out.conflict) {
        console.log(
          new Date().toLocaleTimeString("ru-RU") +
            "  запись отклонена: вкладка не видела последних правок на диске",
        );
        return json(res, 409, { ok: false, conflict: true, rev: out.rev });
      }
      if (out.written || out.removed) {
        console.log(
          new Date().toLocaleTimeString("ru-RU") +
            "  людей: " + out.total +
            ", записано: " + out.written +
            (out.removed ? ", удалено: " + out.removed : ""),
        );
      }
      return json(res, 200, { ok: true, ...out });
    }

    if (url.pathname.startsWith("/api/")) return json(res, 404, { ok: false, error: "нет такого метода" });

    // всё остальное — само приложение
    const file = url.pathname === "/" || url.pathname === "/index.html" ? "genealogy.html" : url.pathname.slice(1);
    if (file.includes("..") || file.startsWith("/")) return json(res, 400, { ok: false, error: "плохой путь" });
    try {
      const body = await readFile(join(DIST, file));
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Нет собранного приложения. Выполните: npm run build\n");
    }
  } catch (e) {
    console.error(e);
    json(res, 500, { ok: false, error: String(e && e.message) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Родословная: http://127.0.0.1:" + PORT);
  console.log("Люди на диске: " + PERSONS);
  console.log("Остановить — Ctrl+C");
});
