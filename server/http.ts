/** Request bodies in, answers out. */
import type { IncomingMessage, ServerResponse } from "node:http";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const MAX_BODY = 32e6;

export const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((res, rej) => {
    let data = "";
    // decoded as a stream: a letter split between two chunks of the body arrives whole
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      data += c;
      if (data.length > MAX_BODY) rej(new Error("request body too large"));
    });
    req.on("end", () => res(data));
    req.on("error", rej);
  });

/** An archive arrives as it is, in bytes: collecting it into a string is not an option. */
export const readBuffer = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((res, rej) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) return rej(new Error("archive too large"));
      parts.push(c);
    });
    req.on("end", () => res(Buffer.concat(parts)));
    req.on("error", rej);
  });

export const json = (res: ServerResponse, code: number, body: unknown): void => {
  res.writeHead(code, { "content-type": MIME[".json"], "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export const page = (res: ServerResponse, code: number, body: string): void => {
  res.writeHead(code, { "content-type": MIME[".html"], "cache-control": "no-store" });
  res.end(body);
};

export const redirect = (res: ServerResponse, to: string): void => {
  res.writeHead(303, { location: to, "cache-control": "no-store" });
  res.end();
};
