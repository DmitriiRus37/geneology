/** Command line keys and environment variables, read once into one object. */
import { join, resolve } from "node:path";

export interface Config {
  /** the persons folder of the disk store */
  persons: string;
  /** the built app */
  dist: string;
  port: number;
  host: string;
  /** "memory", or anything else for the disk store */
  mode: string;
  /** where anything we keep on disk goes; "" writes nothing at all */
  logDir: string;
  logMax: number;
  logKeep: number;
  /** LOG_DIR/access.log, or "" */
  logFile: string;
  /** LOG_DIR/logins.jsonl, or "" */
  loginsFile: string;
  user: string;
  pass: string;
  adminUser: string;
  adminPass: string;
  /** how many sign-ins and attempts are kept */
  attemptsMax: number;
  /**
   * GENEALOGY_TRUST_PROXY=1: a proxy of our own stands in front and appends the client's
   * address to X-Forwarded-For. Off by default — the port is published directly, and
   * then the header is whatever the client chose to write into it.
   */
  trustProxy: boolean;
  /** wrong passwords from one address before it is locked out */
  lockTries: number;
  /** the window those are counted in, and how long the lockout lasts, in ms */
  lockMs: number;
}

/** `root` is the repository: persons/ and dist/ are looked for there. */
export function readConfig(argv: string[], env: Record<string, string | undefined>, root: string): Config {
  /** Value of a command line key: `--dir /path`, `--port 8080`. */
  const arg = (name: string) => {
    const at = argv.indexOf(name);
    return at > -1 ? argv[at + 1] : undefined;
  };

  const dirArg = arg("--dir");
  // Where anything we keep on disk goes. Empty means nothing is written at all:
  // on your own machine the terminal is enough.
  const logDir = env.LOG_DIR ?? "";
  return {
    persons: resolve(dirArg ?? env.GENEALOGY_DIR ?? join(root, "persons")),
    dist: join(root, "dist"),
    port: Number(arg("--port") ?? env.PORT ?? 5179),
    // by default we listen to ourselves only: the server writes to the file system
    host: arg("--host") ?? env.HOST ?? "127.0.0.1",
    mode: arg("--store") ?? env.GENEALOGY_STORE ?? "disk",
    logDir,
    logMax: Number(env.LOG_MAX ?? 10e6), // 10 MB
    logKeep: Number(env.LOG_KEEP ?? 3),
    logFile: logDir ? join(logDir, "access.log") : "",
    loginsFile: logDir ? join(logDir, "logins.jsonl") : "",
    user: env.GENEALOGY_USER ?? "",
    pass: env.GENEALOGY_PASS ?? "",
    adminUser: env.GENEALOGY_ADMIN_USER ?? "",
    adminPass: env.GENEALOGY_ADMIN_PASS ?? "",
    attemptsMax: Number(env.GENEALOGY_ATTEMPTS ?? 10000),
    trustProxy: env.GENEALOGY_TRUST_PROXY === "1",
    lockTries: Number(env.GENEALOGY_LOCK_TRIES ?? 5),
    lockMs: Number(env.GENEALOGY_LOCK_MINUTES ?? 15) * 60e3,
  };
}
