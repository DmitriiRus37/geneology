/**
 * Who came knocking: the last ATTEMPTS_MAX sign-ins and attempts at one, newest
 * last, kept both in memory and in LOG_DIR/logins.jsonl so a restart does not lose
 * them. The file is the record; memory is just the copy the page is drawn from.
 *
 * One JSON object per line. Nothing needs escaping rules of its own: JSON.stringify
 * already handles quotes, line breaks and anything else the login field can carry,
 * and a line that will not parse is simply skipped on the way back in.
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";

export interface Attempt {
  /** ISO time */
  at: string;
  /** the login typed, cut to 64 characters */
  name: string;
  ip: string;
  /** the account it opened, "" when refused */
  role: string;
  /** the browser, cut to 160 characters */
  ua: string;
}

/** The address the request really came from: a proxy puts it in a header. */
export const ipOf = (req: IncomingMessage): string => {
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return (fwd || req.socket?.remoteAddress || "-").replace(/^::ffff:/, "");
};

const asRow = (a: Attempt): string =>
  JSON.stringify({ when: a.at, login: a.name, address: a.ip, result: a.role || "refused", browser: a.ua });

export interface AttemptsOptions {
  /** how many are kept */
  max: number;
  /** logins.jsonl; "" keeps them in memory only */
  file: string;
}

export interface Attempts {
  /** oldest first; the same array for the life of the process */
  list: Attempt[];
  /** Read back what earlier runs wrote, keeping only the newest `max`. */
  load(): void;
  record(req: IncomingMessage, name: unknown, role: string | null): void;
}

export function createAttempts({ max, file }: AttemptsOptions): Attempts {
  const list: Attempt[] = [];
  let rows = 0; // records in the file

  function load() {
    if (!file) return;
    let lines;
    try {
      lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      return; // nobody has signed in on this machine yet
    }
    rows = lines.length;
    for (const line of lines.slice(-max)) {
      try {
        const r = JSON.parse(line);
        list.push({
          at: String(r.when ?? ""),
          name: String(r.login ?? ""),
          ip: String(r.address ?? ""),
          role: r.result === "refused" ? "" : String(r.result ?? ""),
          ua: String(r.browser ?? ""),
        });
      } catch {
        /* a half-written line from a kill at the wrong moment — skip it */
      }
    }
  }

  /** Rewrite the file from memory: memory already holds exactly the newest ones. */
  function trim() {
    try {
      writeFileSync(file, list.map(asRow).join("\n") + "\n");
      rows = list.length;
    } catch (e) {
      console.error("could not trim the sign-in log: " + (e && (e as Error).message));
    }
  }

  function record(req: IncomingMessage, name: unknown, role: string | null) {
    const one: Attempt = {
      at: new Date().toISOString(),
      name: String(name ?? "").slice(0, 64),
      ip: ipOf(req),
      role: role ?? "",
      ua: String(req.headers["user-agent"] ?? "").slice(0, 160),
    };
    list.push(one);
    // a ring in all but name: the oldest go once the cap is reached
    if (list.length > max) list.splice(0, list.length - max);

    if (!file) return;
    try {
      appendFileSync(file, asRow(one) + "\n");
      rows++;
      // rewriting on every append would be silly; a quarter over the cap is close enough
      if (rows > max * 1.25) trim();
    } catch (e) {
      console.error("could not write the sign-in log: " + (e && (e as Error).message));
    }
  }

  return { list, load, record };
}
