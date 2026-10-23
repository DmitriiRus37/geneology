/**
 * What leaves the browser as a file: the SVG, PNG and PDF pictures of the tree, a
 * photo shrunk for a card, and the browser's own copy. happy-dom has no canvas, so a
 * small fake one stands in: it records what is drawn and hands back fixed pixels.
 */
import { downloads } from "../testing/dom.ts";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, test } from "node:test";
import type { BBox } from "../layout/layout.ts";
import { exportPdfFile } from "./exportPdf.ts";
import { exportPngFile, exportSvgFile, rasterize, renderSvg } from "./exportSvg.ts";
import { readJson } from "./files.ts";
import { loadStored, store } from "./local.ts";
import { PHOTO_SIDE, shrinkPhoto } from "./photo.ts";
import { cardsFor } from "../ui/cards.ts";

/** A canvas 2D context that remembers its calls; every pixel is (10, 20, 30). */
const drawn: string[] = [];
let blobOut: (type: string) => Blob | null = (type) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type });
let noContext = false;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  if (noContext) return null;
  const cv = this;
  return {
    set fillStyle(v: string) {
      drawn.push("fill " + v);
    },
    set font(v: string) {
      drawn.push("font " + v);
    },
    fillRect: (x: number, y: number, w: number, h: number) => drawn.push(`rect ${x},${y},${w},${h}`),
    scale: (x: number, y: number) => drawn.push(`scale ${x},${y}`),
    drawImage: (_img: unknown, ...a: number[]) => drawn.push("image " + a.join(",")),
    measureText: (text: string) => ({ width: text.length * 10 }),
    getImageData: () => {
      const data = new Uint8ClampedArray(cv.width * cv.height * 4);
      for (let i = 0; i < data.length; i += 4) data.set([10, 20, 30, 255], i);
      return { data };
    },
  } as unknown as CanvasRenderingContext2D;
} as typeof HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, type?: string, q?: number) {
  drawn.push(`toBlob ${type} ${q}`);
  setTimeout(() => cb(blobOut(type ?? "image/png")), 0);
};

const box = (w: number, h: number): BBox => ({ x1: 10, y1: 20, x2: 10 + w, y2: 20 + h, w, h });

beforeEach(() => {
  document.body.innerHTML =
    '<svg><g id="edges"><path class="hit" d="M0 0"/><path class="link" d="M0 0L5 5"/></g>' +
    '<g id="nodes"><g class="node"><image href="/api/photo/x.jpg"/><text class="name">Ivan</text></g></g></svg>';
  drawn.length = 0;
  downloads.length = 0;
  noContext = false;
  blobOut = (type) => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], { type });
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("the SVG is the drawn canvas with a margin, without the click lines and the photos", async () => {
  assert.equal(renderSvg(null), null, "no tree, no picture");
  const r = renderSvg(box(100, 50))!;
  assert.equal(r.w, 160);
  assert.equal(r.h, 110);
  assert.match(r.src, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="160" height="110" viewBox="0 0 160 110">/);
  assert.ok(r.src.includes('<g transform="translate(20,10)">'), "the tree is moved into the margin");
  assert.ok(!r.src.includes('class="hit"'));
  assert.ok(!r.src.includes("<image"));
  assert.ok(r.src.includes("Ivan") && r.src.includes("<style>") && r.src.includes('marker id="tip"'));
  assert.equal($$count("#edges .hit"), 1, "the page itself keeps them");

  assert.equal(exportSvgFile(box(100, 50)), true);
  assert.equal(downloads[0].name, "genealogy.svg");
  assert.equal(downloads[0].blob.type, "image/svg+xml");
  assert.equal(await downloads[0].blob.text(), r.src);

  document.body.innerHTML = "";
  assert.equal(renderSvg(box(100, 50)), null, "nothing drawn, nothing to take");
  assert.equal(exportSvgFile(box(100, 50)), false);
});

const $$count = (sel: string) => document.querySelectorAll(sel).length;

test("rasterizing fills the backdrop and scales the picture", async () => {
  const cv = await rasterize({ src: "<svg xmlns='http://www.w3.org/2000/svg'/>", w: 100, h: 40 }, 2);
  assert.equal(cv.width, 200);
  assert.equal(cv.height, 80);
  assert.deepEqual(drawn, ["fill #F7F9FB", "rect 0,0,200,80", "scale 2,2", "image 0,0"]);

  noContext = true;
  await assert.rejects(rasterize({ src: "<svg/>", w: 1, h: 1 }, 1), /no canvas/);
});

test("a PNG goes out as a file; one the canvas cannot encode is reported", async () => {
  let failed = 0;
  assert.equal(exportPngFile(null, () => failed++), false);
  assert.equal(exportPngFile(box(100, 50), () => failed++), true);
  await until(() => downloads.length === 1);
  assert.equal(downloads[0].name, "genealogy.png");
  assert.ok(drawn.some((d) => d.startsWith("scale 2.5,2.5")), "a small tree is drawn at 2.5×");

  blobOut = () => null;
  exportPngFile(box(100, 50), () => failed++);
  await until(() => failed === 1);
});

async function until(ok: () => boolean) {
  for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), "timed out");
}

/** The PDF's objects by number, checked against its cross-reference table. */
function parsePdf(bytes: Buffer) {
  const text = bytes.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4\n"));
  assert.ok(text.endsWith("%%EOF\n"));
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");
  const offsets = text
    .slice(startxref)
    .split("\n")
    .filter((l) => / 00000 n $/.test(l))
    .map((l) => Number(l.slice(0, 10)));
  assert.equal(offsets.length, 5);
  offsets.forEach((at, i) => assert.equal(text.slice(at, at + 8), `${i + 1} 0 obj\n`, "the offset of object " + (i + 1)));
  const image = text.slice(offsets[3]);
  const head = image.slice(0, image.indexOf("stream\n"));
  const length = Number(head.match(/\/Length (\d+)/)![1]);
  const from = offsets[3] + head.length + "stream\n".length;
  return { text, head, data: bytes.subarray(from, from + length) };
}

test("the PDF is one page the size of the tree with the picture deflated into it", async () => {
  assert.equal(await exportPdfFile(null, () => {}), false);
  assert.equal(await exportPdfFile(box(100, 50), assert.fail), true);
  assert.equal(downloads[0].name, "genealogy.pdf");
  assert.equal(downloads[0].blob.type, "application/pdf");
  const pdf = parsePdf(Buffer.from(await downloads[0].blob.arrayBuffer()));
  assert.ok(pdf.text.includes("/MediaBox [0 0 160.00 110.00]"));
  assert.ok(pdf.head.includes("/Width 480 /Height 330"), "three pixels per unit");
  assert.ok(pdf.head.includes("/Filter /FlateDecode"));
  const rgb = inflateSync(pdf.data);
  assert.equal(rgb.length, 480 * 330 * 3);
  assert.deepEqual([...rgb.subarray(0, 6)], [10, 20, 30, 10, 20, 30], "RGB without the alpha");
});

test("without CompressionStream the PDF carries a JPEG; a huge tree is capped", async () => {
  const CS = globalThis.CompressionStream;
  Reflect.deleteProperty(globalThis, "CompressionStream");
  try {
    assert.equal(await exportPdfFile(box(30000, 100), assert.fail), true);
  } finally {
    globalThis.CompressionStream = CS;
  }
  const pdf = parsePdf(Buffer.from(await downloads[0].blob.arrayBuffer()));
  assert.ok(pdf.head.includes("/Filter /DCTDecode"));
  assert.deepEqual([...pdf.data], [0xff, 0xd8, 0xff, 1, 2, 3]);
  assert.ok(drawn.includes("toBlob image/jpeg 0.95"));
  assert.match(pdf.text, /\/MediaBox \[0 0 14000\.00 \d+\.\d\d\]/, "no page side over 200 inches");
  assert.match(pdf.head, /\/Width 7000 /, "no picture side over 7000 pixels");
});

test("a PDF that fails says why", async () => {
  noContext = true;
  const why: string[] = [];
  assert.equal(await exportPdfFile(box(10, 10), (m) => why.push(m)), true);
  assert.deepEqual(why, ["no canvas"]);
  assert.equal(downloads.length, 0);
});

test("a photo is turned upright, shrunk to PHOTO_SIDE on its long side and encoded as a JPEG", async () => {
  const closed: number[] = [];
  const bitmap = (width: number, height: number) => ({ width, height, close: () => closed.push(width) });
  const opened: unknown[] = [];
  globalThis.createImageBitmap = (async (_f: Blob, o: unknown) => {
    opened.push(o);
    return bitmap(1280, 960);
  }) as unknown as typeof createImageBitmap;
  const jpeg = await shrinkPhoto(new Blob(["raw"]));
  assert.equal(jpeg.type, "image/jpeg");
  assert.deepEqual(opened, [{ imageOrientation: "from-image" }]);
  assert.deepEqual(drawn, ["fill #fff", `rect 0,0,${PHOTO_SIDE},480`, `image 0,0,${PHOTO_SIDE},480`, "toBlob image/jpeg 0.85"]);
  assert.deepEqual(closed, [1280]);

  drawn.length = 0;
  globalThis.createImageBitmap = (async () => bitmap(300, 1)) as unknown as typeof createImageBitmap;
  await shrinkPhoto(new Blob(["raw"]));
  assert.ok(drawn.includes("image 0,0,300,1"), "a small picture keeps its size");

  blobOut = () => null;
  await assert.rejects(shrinkPhoto(new Blob(["raw"])), /could not be encoded/);
  noContext = true;
  await assert.rejects(shrinkPhoto(new Blob(["raw"])), /no canvas/);
  assert.equal(closed.length, 4, "the bitmap is let go every time");
});

test("a JSON file is read only when it holds people", async () => {
  assert.deepEqual(await readJson(new File(['{"people":{}}'], "t.json")), { people: {} });
  await assert.rejects(readJson(new File(['{"nobody":1}'], "t.json")), /no people/);
  await assert.rejects(readJson(new File(["nope"], "t.json")));
});

test("the browser's copy survives a full or forbidden storage", () => {
  localStorage.clear();
  assert.equal(loadStored(), null);
  store({ people: { a: { id: "a", name: "Ivan" } } } as never);
  assert.equal(loadStored()?.people.a.name, "Ivan");
  localStorage.setItem("genealogy:v3", '{"people":{}}');
  assert.equal(loadStored(), null, "an empty copy does not count");
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  try {
    assert.doesNotThrow(() => store({ people: {} } as never));
  } finally {
    Storage.prototype.setItem = set;
  }
});

test("in a browser the cards are measured on a canvas", () => {
  const size = cardsFor("en")({ id: "a", name: "Ivan", maiden: "", alt: [], born: "", died: "", sex: "u", n: 1 } as never);
  assert.ok(drawn.some((d) => d.startsWith("font ")), "the canvas measured the text");
  assert.equal(size.lines[0].t, "Ivan");
  assert.equal(cardsFor("en"), cardsFor("en"), "one sizer per language");
});
