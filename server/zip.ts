/**
 * Zip archives, hand-rolled on node:zlib: the server has no dependencies. Enough for
 * what the tree needs — small text files and the photos, stored or deflated, no zip64.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf: Buffer): number => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const SIG_LOCAL = 0x04034b50;
const SIG_ENTRY = 0x02014b50;
const SIG_END = 0x06054b50;
const DOS_1980 = 0x21; // a fixed date: the same tree gives the same archive

/** Build a zip from "name → text or bytes". The files are small, so pack them in one go. */
export function zipWrite(files: Map<string, string | Buffer>): Buffer {
  const chunks: Buffer[] = [];
  const index: Buffer[] = [];
  let at = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = typeof text === "string" ? Buffer.from(text, "utf8") : text;
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

/** Parse a zip into "name → bytes". We read the index at the end, as one should. */
export function zipRead(buf: Buffer): Map<string, Buffer> {
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

  const out = new Map<string, Buffer>();
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
    out.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
  }
  return out;
}
