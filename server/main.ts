/**
 * Genealogy server: serves the built app and keeps people — one file per person.
 *
 * Two stores, sharing the same tree parsing (src/model/cards.ts):
 *
 *   disk   — the persons/ folder, a file per person. This is how it all works locally.
 *   memory — nothing is written to disk at all. The tree arrives as a zip through
 *            "Upload archive", gets edited, and leaves through "Download archive";
 *            a restart loses it. The remote machine runs this mode: no one else's
 *            relatives are left behind on it.
 *
 * Not a single dependency. This file only reads the settings, builds the parts and
 * starts listening; every part is a file of its own next to it.
 *
 *   node server.mjs                                # http://127.0.0.1:5179, persons/
 *   node server.mjs --port 8080
 *   node server.mjs --dir /path/to/folder          # keep people somewhere else
 *   node server.mjs --store memory --host 0.0.0.0  # this is how the container runs it
 *
 * The password lives in GENEALOGY_USER and GENEALOGY_PASS. While they are empty
 * the server is open: on your own machine a password is pointless. On someone
 * else's it is mandatory — anyone who reaches the port can rewrite the tree.
 *
 * GENEALOGY_ADMIN_USER and GENEALOGY_ADMIN_PASS add a second account, the only
 * one that may open /admin and read who has been signing in. Without them the
 * page exists for nobody. The administrator lands on it straight after signing
 * in, and can still open the tree.
 */
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createAccessLog } from "./accesslog.ts";
import { createAttempts } from "./attempts.ts";
import { createAuth } from "./auth.ts";
import { readConfig } from "./config.ts";
import { createGeo } from "./geo.ts";
import { createHandler } from "./routes.ts";
import { diskStore, memStore } from "./stores.ts";
import { createTree } from "./tree.ts";

const config = readConfig(process.argv, process.env, join(import.meta.dirname, ".."));
const { host, port, logDir, logFile, logMax, logKeep } = config;
if (logDir) mkdirSync(logDir, { recursive: true });

const auth = createAuth(config);
const attempts = createAttempts({ max: config.attemptsMax, file: config.loginsFile });
attempts.load();
const accessLog = createAccessLog({ file: logFile, max: logMax, keep: logKeep });
const store = config.mode === "memory" ? memStore() : diskStore(config.persons);

const server = createServer(
  createHandler({
    auth,
    attempts,
    geo: createGeo(),
    tree: createTree(store),
    accessLog,
    dist: config.dist,
    loginsFile: config.loginsFile,
    attemptsMax: config.attemptsMax,
  }),
);

server.listen(port, host, () => {
  console.log("Genealogy: http://" + host + ":" + port);
  console.log(store.kind === "memory" ? "People in memory: a restart loses them" : "People on disk: " + config.persons);
  if (logDir) {
    const size = logMax >= 1e6 ? logMax / 1e6 + " MB" : Math.round(logMax / 1e3) + " KB";
    console.log("Requests: " + logFile + " (rotated at " + size + ", " + logKeep + " kept gzipped)");
  }
  if (auth.guarded) {
    console.log(auth.hasAdmin ? "Accounts: " + config.user + ", " + config.adminUser + " (admin, /admin)" : "Accounts: " + config.user);
  }
  if (!auth.guarded && host !== "127.0.0.1") {
    console.warn("WARNING: the port is open to the outside with no password. Set GENEALOGY_USER and GENEALOGY_PASS.");
  }
  console.log("Stop it with Ctrl+C");
});
