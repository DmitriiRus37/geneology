/**
 * The pages the server draws itself: the login form, the sign-in log and the
 * "not for this account" page.
 */
import type { Attempt } from "./attempts.ts";

/**
 * Everything below is drawn into HTML, and the login field is filled in by
 * whoever is knocking — so nothing reaches the page unescaped.
 */
export const esc = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** Both server-drawn pages share this: they must sit right on a phone too. */
const HEAD =
  '<meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';

const SHELL =
  "*{-webkit-tap-highlight-color:transparent}" +
  "body{font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
  "background:#1b232e;color:#e6ebf1;margin:0;" +
  // the notch, the rounded corners and the home indicator
  "padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right))" +
  " max(20px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left))}" +
  "h1{font:400 20px Georgia,serif;margin:0 0 2px}" +
  ".sub{color:#93a2b3;font-size:12.5px;margin:0 0 18px}" +
  // a link is tapped with a finger here, not clicked with a pointer
  "a{color:#c08a2e;display:inline-block;padding:6px 0}";

/** How many rows the page draws at once; the rest stay in the file. */
export const ADMIN_ROWS = 500;

export interface AdminPageData {
  /** every attempt kept, oldest first */
  attempts: Attempt[];
  /** how many are kept at most */
  max: number;
  /** where they are kept; "" when only in memory */
  file: string;
  placeOf: (ip: string) => string;
}

/** The sign-in log: newest first, the refused ones marked. */
export function adminPage({ attempts, max, file, placeOf }: AdminPageData): string {
  const shown = attempts.slice(-ADMIN_ROWS);
  const rows = shown
    .slice()
    .reverse()
    .map((a) => {
      const who = a.role ? '<span class="ok">' + esc(a.role) + "</span>" : '<span class="no">refused</span>';
      return (
        "<tr><td class=t>" + esc(a.at.replace("T", " ").slice(0, 19)) + "</td>" +
        "<td>" + esc(a.name || "—") + "</td>" +
        "<td class=ip>" + esc(a.ip) + "</td>" +
        "<td>" + who + "</td>" +
        "<td class=geo>" + esc(placeOf(a.ip)) + "</td>" +
        "<td class=ua>" + esc(a.ua || "—") + "</td></tr>"
      );
    })
    .join("");

  const refused = attempts.filter((a) => !a.role).length;
  const ips = new Set(attempts.map((a) => a.ip)).size;

  return (
    '<!doctype html><html lang="en">' + HEAD +
    "<title>Genealogy · who signed in</title><style>" + SHELL +
    "table{border-collapse:collapse;width:100%;font-size:12.5px}" +
    "th{text-align:left;color:#93a2b3;font-weight:400;border-bottom:1px solid #33404f;padding:6px 10px 6px 0}" +
    "td{padding:5px 10px 5px 0;border-bottom:1px solid #232d3a;vertical-align:top}" +
    ".t{color:#93a2b3;white-space:nowrap}.ip{font-family:ui-monospace,Menlo,monospace}" +
    ".ok{color:#6aa84f}.no{color:#e9a79f}" +
    ".ua{color:#6b7a89;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".geo{color:#93a2b3;white-space:nowrap}" +
    // on a phone six columns do not fit: the table scrolls on its own rather than
    // dragging the whole page sideways, and the browser string steps aside
    ".wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}" +
    "@media(max-width:620px){.ua{display:none}th:last-child{display:none}}" +
    ".n{display:inline-block;margin-right:18px;color:#93a2b3;font-size:12.5px}" +
    ".n b{color:#e6ebf1;font-weight:600}" +
    "</style><h1>Who signed in</h1>" +
    '<p class="sub">Sign-ins and attempts at one, newest first. The newest ' + max +
    (file ? " are kept in " + esc(file) + " and survive a restart. " : " are kept in memory only. ") +
    '<a href="/">Tree</a> · <a href="/admin">Refresh</a>' +
    (file ? ' · <a href="/admin/logins.jsonl">Raw file</a>' : "") +
    ' · <a href="/logout">Log out</a></p>' +
    '<p><span class="n">records <b>' + attempts.length +
    (attempts.length > shown.length ? " <small>(newest " + shown.length + " shown)</small>" : "") +
    "</b></span>" +
    '<span class="n">refused <b>' + refused + "</b></span>" +
    '<span class="n">addresses <b>' + ips + "</b></span></p>" +
    '<div class="wrap"><table><tr><th>when (UTC)</th><th>login</th><th>address</th><th>result</th><th>where from</th><th>browser</th></tr>' +
    (rows || '<tr><td colspan=6 style="color:#6b7a89;padding-top:12px">Nobody yet.</td></tr>') +
    "</table></div></html>"
  );
}

/** Shown when a signed-in non-admin asks for /admin. */
export const notForYou = (): string =>
  '<!doctype html><html lang="en">' + HEAD +
  "<title>Genealogy</title><style>" + SHELL + "</style>" +
  "<h1>Not for this account</h1>" +
  '<p class="sub">This page belongs to the administrator. ' +
  '<a href="/">Back to the tree</a> · <a href="/logout">Log out as someone else</a></p></html>';

/** The login page. `bad` marks a second attempt after a wrong password. */
export const loginPage = (bad: boolean): string =>
  '<!doctype html><html lang="en">' + HEAD +
  "<title>Genealogy</title><style>" +
  "*{-webkit-tap-highlight-color:transparent}" +
  "body{font:15px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
  "background:#1b232e;color:#e6ebf1;display:flex;min-height:100dvh;margin:0;align-items:center;" +
  "justify-content:center;padding:16px;box-sizing:border-box}" +
  "form{background:#232d3a;border:1px solid #33404f;border-radius:8px;padding:26px 28px;" +
  "width:100%;max-width:320px;box-sizing:border-box}" +
  "h1{font:400 19px Georgia,serif;margin:0 0 4px}p{color:#93a2b3;font-size:12.5px;margin:0 0 16px}" +
  "label{display:block;font-size:12px;color:#93a2b3;margin:10px 0 4px}" +
  // 16px exactly: anything smaller and iOS zooms the page on focus and never zooms back
  "input{width:100%;box-sizing:border-box;background:#1b232e;color:#e6ebf1;border:1px solid #33404f;" +
  "border-radius:5px;padding:11px 10px;font-size:16px}" +
  "button{width:100%;margin-top:16px;background:#c08a2e;border:0;border-radius:5px;color:#1b1200;" +
  "font-weight:600;font-size:16px;padding:13px;cursor:pointer;min-height:44px}" +
  ".bad{color:#e9a79f;font-size:12.5px;margin-top:12px}" +
  "</style><form method=post action=/login>" +
  "<h1>Genealogy</h1><p>The tree is behind a password.</p>" +
  // no autofocus: on a phone the keyboard springs up over the rest of the form
  "<label for=u>Login</label><input id=u name=u autocomplete=username>" +
  "<label for=p>Password</label><input id=p name=p type=password autocomplete=current-password>" +
  "<button type=submit>Enter</button>" +
  (bad ? '<p class="bad">Wrong login or password.</p>' : "") +
  "</form></html>";
