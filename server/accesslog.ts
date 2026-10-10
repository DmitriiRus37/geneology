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
import { appendFileSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { gzipSync } from "node:zlib";
import { ipOf } from "./attempts.ts";
import { ticketOf } from "./auth.ts";

export interface AccessLogOptions {
  /** access.log; "" writes nothing */
  file: string;
  /** bytes at which the live file is rotated */
  max: number;
  /** gzipped files kept */
  keep: number;
  /** take the address from X-Forwarded-For (see `ipOf`) */
  trustProxy: boolean;
}

export type AccessLog = (req: IncomingMessage, res: ServerResponse, started: number) => void;

/** Trim anything that could break the line apart. */
const clean = (v: unknown, max: number): string => String(v ?? "-").replace(/[\r\n\t]+/g, " ").slice(0, max) || "-";

export function createAccessLog({ file, max, keep, trustProxy }: AccessLogOptions): AccessLog {
  let logged = 0; // bytes in the live file

  if (file) {
    try {
      logged = statSync(file).size; // picking up after a restart
    } catch {
      logged = 0;
    }
  }

  const gzName = (n: number) => file + "." + n + ".gz";

  /**
   * Rotation is synchronous on purpose. It happens once per LOG_MAX bytes — tens
   * of thousands of requests apart — and a pause of a fraction of a second is a
   * fair price for never interleaving a rotation with a write.
   */
  function rotate() {
    try {
      rmSync(gzName(keep), { force: true }); // the oldest one goes
      for (let i = keep - 1; i >= 1; i--) {
        try {
          renameSync(gzName(i), gzName(i + 1));
        } catch {
          /* that number does not exist yet */
        }
      }
      if (keep >= 1) writeFileSync(gzName(1), gzipSync(readFileSync(file)));
      rmSync(file, { force: true });
    } catch (e) {
      console.error("log rotation failed: " + (e && (e as Error).message));
    }
    logged = 0;
  }

  return (req, res, started) => {
    if (!file) return;
    // How the caller identified itself — never with what. `-` against a 401 is a
    // login page that was never filled in, `auth` against one is a wrong password,
    // and from the status code alone the two look identical.
    const creds = req.headers.authorization ? "auth" : ticketOf(req) ? "cookie" : "-";
    const line =
      [
        new Date().toISOString(),
        clean(ipOf(req, trustProxy), 45),
        clean(req.method, 8),
        clean(String(req.url ?? "").split("?")[0], 200), // path only
        res.statusCode,
        creds,
        Date.now() - started + "ms",
        '"' + clean(req.headers["user-agent"], 120) + '"',
      ].join(" ") + "\n";
    try {
      appendFileSync(file, line);
      logged += Buffer.byteLength(line);
      if (logged >= max) rotate();
    } catch (e) {
      console.error("could not write the log: " + (e && (e as Error).message));
    }
  };
}
