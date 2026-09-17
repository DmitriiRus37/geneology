import type { BBox } from "../layout/layout.ts";
import { rasterize, renderSvg } from "./exportSvg.ts";
import { download } from "./files.ts";

/**
 * PDF со всем древом целиком — одной страницей размером с само древо.
 * Никаких библиотек: картинка кладётся в страницу, а сам файл собирается
 * побайтово. Пиксели жмём тем же zlib, который понимает PDF; если браузер
 * такого не умеет, кладём JPEG.
 */

/** Сколько пикселей на единицу древа: больше — чётче и тяжелее. */
const DPI_SCALE = 3;
/** Ни одна сторона картинки не должна перевалить за это. */
const MAX_SIDE = 7000;
/** Предел размера страницы в PDF — 200 дюймов. */
const MAX_PT = 14000;

const ascii = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
};

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CS("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

const blobBytes = async (cv: HTMLCanvasElement, type: string, q: number): Promise<Uint8Array | null> =>
  new Promise((res) => cv.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a))) : res(null)), type, q));

/** Собираем одностраничный PDF с одной картинкой во всю страницу. */
function buildPdf(
  img: Uint8Array,
  px: number,
  py: number,
  filter: "FlateDecode" | "DCTDecode",
  pageW: number,
  pageH: number,
): Blob {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;
  const put = (v: Uint8Array | string) => {
    const b = typeof v === "string" ? ascii(v) : v;
    parts.push(b);
    at += b.length;
  };
  const obj = (n: number, body: string) => {
    offsets[n] = at;
    put(n + " 0 obj\n" + body + "\nendobj\n");
  };

  put("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageW.toFixed(2) + " " + pageH.toFixed(2) + "]" +
      " /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
  );

  // картинка
  offsets[4] = at;
  put(
    "4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + px + " /Height " + py +
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /" + filter +
      " /Length " + img.length + " >>\nstream\n",
  );
  put(img);
  put("\nendstream\nendobj\n");

  const content = "q " + pageW.toFixed(2) + " 0 0 " + pageH.toFixed(2) + " 0 0 cm /Im0 Do Q\n";
  obj(5, "<< /Length " + content.length + " >>\nstream\n" + content + "endstream");

  const xref = at;
  let table = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  put(table);
  put("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");

  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function exportPdfFile(b: BBox | null, fail: (msg: string) => void): Promise<boolean> {
  const r = renderSvg(b);
  if (!r) return false;
  try {
    const scale = Math.min(DPI_SCALE, MAX_SIDE / Math.max(r.w, r.h, 1));
    const cv = await rasterize(r, scale);

    // страница ровно по размеру древа, но не больше того, что допускает формат
    const fit = Math.min(1, MAX_PT / Math.max(r.w, r.h, 1));
    const pageW = r.w * fit;
    const pageH = r.h * fit;

    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("нет canvas");
    const rgba = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const rgb = new Uint8Array(cv.width * cv.height * 3);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgb[j] = rgba[i];
      rgb[j + 1] = rgba[i + 1];
      rgb[j + 2] = rgba[i + 2];
    }

    const packed = await deflate(rgb);
    const pdf = packed
      ? buildPdf(packed, cv.width, cv.height, "FlateDecode", pageW, pageH)
      : buildPdf(
          (await blobBytes(cv, "image/jpeg", 0.95)) ?? new Uint8Array(),
          cv.width,
          cv.height,
          "DCTDecode",
          pageW,
          pageH,
        );
    download("genealogy.pdf", pdf);
    return true;
  } catch (e) {
    fail((e as Error).message); // подпись «PDF не получился» добавит интерфейс на своём языке
    return true;
  }
}
