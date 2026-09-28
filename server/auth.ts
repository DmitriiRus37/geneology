/** Passwords, the login ticket and who is asking. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export type Role = "admin" | "user";

export const COOKIE = "gen_session";

/** Comparison in constant time, over digests so the length does not leak. */
const same = (a: string, b: string): boolean =>
  timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

export const ticketOf = (req: IncomingMessage): string => {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === COOKIE) return part.slice(at + 1).trim();
  }
  return "";
};

export interface Accounts {
  user: string;
  pass: string;
  /** A second account that may also open /admin. Without it nobody can. */
  adminUser: string;
  adminPass: string;
}

export interface Auth {
  /** a password is set: without one the server is open */
  guarded: boolean;
  hasAdmin: boolean;
  /** One ticket per account, handed out by the login form. */
  ticket: Record<Role, string>;
  /** Which account this pair belongs to, or null if neither. */
  roleOfCreds(name: unknown, pass: unknown): Role | null;
  /** Who is asking: "admin", "user", or null for a stranger. */
  roleOf(req: IncomingMessage): Role | null;
}

export function createAuth({ user, pass, adminUser, adminPass }: Accounts): Auth {
  const guarded = !!(user && pass);
  const hasAdmin = !!(adminUser && adminPass);

  /**
   * Good until the server restarts — exactly as long as the tree in memory lives,
   * so the two expire together.
   */
  const ticket = { user: randomBytes(32).toString("hex"), admin: randomBytes(32).toString("hex") };

  function roleOfCreds(name: unknown, secret: unknown): Role | null {
    const pair = String(name ?? "") + ":" + String(secret ?? "");
    // both are checked every time, so a wrong login costs the same as a wrong password
    const isAdmin = hasAdmin && same(pair, adminUser + ":" + adminPass);
    const isUser = guarded && same(pair, user + ":" + pass);
    return isAdmin ? "admin" : isUser ? "user" : null;
  }

  /**
   * The ticket comes from the login form; Basic stays for curl, the backup and the
   * smoke check. Browsers need the form because Chrome does not reliably show its own
   * password box for a bare address over plain HTTP, and a page we draw ourselves
   * always works.
   *
   * With no password configured at all everyone is an admin: that is a server on
   * your own machine, where there is nobody to keep out.
   */
  function roleOf(req: IncomingMessage): Role | null {
    if (!guarded) return "admin";

    const got = ticketOf(req);
    if (got.length === ticket.admin.length) {
      if (same(got, ticket.admin)) return "admin";
      if (same(got, ticket.user)) return "user";
    }

    const head = req.headers.authorization ?? "";
    if (head.startsWith("Basic ")) {
      try {
        const pair = Buffer.from(head.slice(6), "base64").toString("utf8");
        const at = pair.indexOf(":");
        if (at > -1) return roleOfCreds(pair.slice(0, at), pair.slice(at + 1));
      } catch {
        /* not base64 — a stranger */
      }
    }
    return null;
  }

  return { guarded, hasAdmin, ticket, roleOfCreds, roleOf };
}
