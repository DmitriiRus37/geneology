/**
 * Every route, in the order they are tried: the open ones, then the guard, then
 * the administrator's, then the API by path, then the app itself.
 */
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { AccessLog } from "./accesslog.ts";
import type { Attempts } from "./attempts.ts";
import { COOKIE, type Auth, type Role } from "./auth.ts";
import type { Geo } from "./geo.ts";
import { json, MIME, page, readBody, readBuffer, redirect } from "./http.ts";
import { ADMIN_ROWS, adminPage, loginPage, notForYou } from "./pages.ts";
import { cardsOf, type Tree } from "./tree.ts";
import { zipRead, zipWrite } from "./zip.ts";

export interface Services {
  auth: Auth;
  attempts: Attempts;
  geo: Geo;
  tree: Tree;
  accessLog: AccessLog;
  /** the built app */
  dist: string;
  /** logins.jsonl, or "" when nothing is kept on disk */
  loginsFile: string;
  attemptsMax: number;
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  role: Role | null;
}

/** Matched on the whole `req.url`; no method means any. */
interface ExactRoute {
  url: string;
  method?: string;
  run(ctx: Ctx): unknown;
}

/** Matched on the path, after the guard. */
interface PathRoute {
  path: string;
  method: string;
  run(ctx: Ctx & { url: URL }): unknown;
}

/** A timestamp for the log line. */
const now = () => new Date().toISOString().slice(11, 19);

const home = (r: Role) => (r === "admin" ? "/admin" : "/");

export function createHandler(s: Services): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const { auth, attempts, geo, tree } = s;

  const open: ExactRoute[] = [
    // The only thing open without a password: "are you alive". No people and no
    // count of them here — docker needs it to tell whether the container came up.
    { url: "/api/health", run: ({ res }) => json(res, 200, { ok: true }) },

    // The login form and the ticket it hands out. Open by definition: this is
    // where one goes to stop being a stranger.
    {
      url: "/login",
      method: "GET",
      run: ({ res, role }) => (role ? redirect(res, home(role)) : page(res, 200, loginPage(false))),
    },
    {
      url: "/login",
      method: "POST",
      async run({ req, res }) {
        const form = new URLSearchParams(await readBody(req));
        const name = form.get("u") ?? "";
        const got = auth.guarded ? auth.roleOfCreds(name, form.get("p") ?? "") : "admin";
        attempts.record(req, name, got);
        if (got) {
          res.writeHead(303, {
            location: home(got),
            // no Secure flag: over plain http the browser would drop the cookie
            "set-cookie": COOKIE + "=" + auth.ticket[got] + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800",
          });
          return res.end();
        }
        await new Promise((r) => setTimeout(r, 400)); // guessing should be slow
        return page(res, 401, loginPage(true));
      },
    },
    {
      url: "/logout",
      run({ res }) {
        res.writeHead(303, { location: "/login", "set-cookie": COOKIE + "=; Path=/; HttpOnly; Max-Age=0" });
        return res.end();
      },
    },
  ];

  /** A browser is sent to the form; everything else keeps the plain 401 that curl, the backup and the smoke check expect. */
  const refuse = ({ req, res }: Ctx) => {
    if (String(req.headers.accept ?? "").includes("text/html")) return redirect(res, "/login");
    res.writeHead(401, {
      "www-authenticate": 'Basic realm="Genealogy", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
    });
    return res.end("A password is needed\n");
  };

  // Only the administrator, and only when there is one at all.
  const admin: ExactRoute[] = [
    {
      url: "/admin",
      async run({ res, role }) {
        if (role !== "admin") return page(res, 403, notForYou());
        // only the addresses actually about to be drawn, and never at anyone else's
        // request: a stranger signing in does not send their address anywhere
        await geo.fill(attempts.list.slice(-ADMIN_ROWS).map((a) => a.ip));
        return page(res, 200, adminPage({ attempts: attempts.list, max: s.attemptsMax, file: s.loginsFile, placeOf: geo.placeOf }));
      },
    },
    {
      url: "/admin/logins.jsonl",
      run({ res, role }) {
        if (role !== "admin") return page(res, 403, notForYou());
        if (!s.loginsFile) return json(res, 404, { ok: false, error: "nothing is kept on disk: LOG_DIR is not set" });
        let body;
        try {
          body = readFileSync(s.loginsFile);
        } catch {
          body = Buffer.alloc(0); // nobody has signed in yet
        }
        // plain text on purpose: one glance in the browser, no download needed
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
        return res.end(body);
      },
    },
  ];

  const api: PathRoute[] = [
    {
      path: "/api/tree",
      method: "GET",
      async run({ res, role }) {
        const got = await tree.read();
        return json(res, 200, {
          ok: true,
          tree: got,
          dir: tree.store.where,
          store: tree.store.kind,
          guarded: auth.guarded,
          role: role ?? "",
          rev: await tree.store.rev(),
        });
      },
    },
    {
      path: "/api/tree",
      method: "POST",
      async run({ req, res }) {
        const body = JSON.parse((await readBody(req)) || "{}");
        if (!body || typeof body.rev !== "string" || !body.tree) {
          return json(res, 400, { ok: false, error: "a write without a version fingerprint is not accepted" });
        }
        const out = await tree.save(body.rev, body.tree);
        if (out.conflict) {
          console.log(now() + "  write refused: the tab had not seen the latest edits");
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
      },
    },
    // An archive of cards replaces the whole tree. Into a folder on disk this is
    // not allowed: that is the user's data, and we will not wipe it in one request.
    {
      path: "/api/upload",
      method: "POST",
      async run({ req, res }) {
        if (tree.store.kind !== "memory") {
          return json(res, 409, { ok: false, error: "the server writes into a folder on disk — an archive cannot be uploaded here" });
        }
        let cards;
        try {
          cards = cardsOf(zipRead(await readBuffer(req)));
        } catch (e) {
          return json(res, 400, { ok: false, error: String(e && (e as Error).message) });
        }
        if (!cards.size) return json(res, 400, { ok: false, error: "there are no cards (.json) in the archive" });
        const out = await tree.upload(cards);
        const people = Object.keys(out.tree?.people ?? {}).length;
        console.log(now() + "  archive loaded, people: " + people);
        return json(res, 200, { ok: true, people, ...out });
      },
    },
    // The same files that would lie in persons/, only as one archive.
    {
      path: "/api/download",
      method: "GET",
      async run({ res }) {
        const files = new Map<string, string>();
        for (const [n, text] of await tree.files()) files.set("persons/" + n, text);
        const zip = zipWrite(files);
        res.writeHead(200, {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="persons.zip"',
          "content-length": zip.length,
          "cache-control": "no-store",
        });
        return res.end(zip);
      },
    },
  ];

  /** Everything else is the app itself. */
  async function app({ res, url }: Ctx & { url: URL }) {
    const file = url.pathname === "/" || url.pathname === "/index.html" ? "genealogy.html" : url.pathname.slice(1);
    if (file.includes("..") || file.startsWith("/")) return json(res, 400, { ok: false, error: "bad path" });
    try {
      const body = await readFile(join(s.dist, file));
      const ext = file.slice(file.lastIndexOf("."));
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("The app has not been built. Run: npm run build\n");
    }
  }

  const exact = (routes: ExactRoute[], req: IncomingMessage) =>
    routes.find((r) => r.url === req.url && (!r.method || r.method === req.method));

  return async (req, res) => {
    // written once the answer has gone out, so the status is the real one
    const started = Date.now();
    res.on("finish", () => s.accessLog(req, res, started));

    try {
      const ctx: Ctx = { req, res, role: auth.roleOf(req) };
      const free = exact(open, req);
      if (free) return void (await free.run(ctx));
      if (!ctx.role) return void refuse(ctx);
      const own = exact(admin, req);
      if (own) return void (await own.run(ctx));

      const url = new URL(req.url as string, "http://" + (req.headers.host ?? "127.0.0.1"));
      const route = api.find((r) => r.path === url.pathname && r.method === req.method);
      if (route) return void (await route.run({ ...ctx, url }));
      if (url.pathname.startsWith("/api/")) return json(res, 404, { ok: false, error: "no such method" });
      await app({ ...ctx, url });
    } catch (e) {
      console.error(e);
      json(res, 500, { ok: false, error: String(e && (e as Error).message) });
    }
  };
}
