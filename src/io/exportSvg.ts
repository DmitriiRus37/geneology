import type { BBox } from "../layout/layout.ts";
import { download } from "./files.ts";

/** Fonts and colours are sewn into the file: the picture must open anywhere. */
const STYLE =
  "<style>" +
  ".link{fill:none;stroke:#7A8B9C;stroke-width:1.6}" +
  ".link.hot{stroke:#7A8B9C;stroke-width:1.6}" +
  ".joint{fill:#7A8B9C}.joint.hot{fill:#7A8B9C}" +
  'text.name{font-family:Georgia,"Times New Roman","DejaVu Serif",serif;font-size:14.5px;fill:#16202B}' +
  'text.maiden{font-family:Georgia,"Times New Roman","DejaVu Serif",serif;font-style:italic;font-size:11.5px;fill:#6B7A89}' +
  'text.yrs{font-family:Arial,"DejaVu Sans",sans-serif;font-size:11.5px;fill:#5B6B7C}' +
  'text.alt{font-family:Arial,"DejaVu Sans",sans-serif;font-size:10.5px;fill:#94A1AD}' +
  "rect.box{fill:#fff;stroke:#C3CDD8;stroke-width:1}" +
  "circle.chip{stroke:none}" +
  "circle.photo{fill:#E6EBF0;stroke:#C3CDD8;stroke-width:1}" +
  'text.mark{font-family:Arial,"DejaVu Sans",sans-serif;font-size:11.5px;font-weight:600}' +
  ".node.dim{opacity:1}" +
  ".node.sel rect.box{stroke:#C3CDD8;stroke-width:1}" +
  "</style>";

const MARKERS =
  '<defs><marker id="tip" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
  '<path d="M0.5 0.8 L7 4 L0.5 7.2 Z" fill="#7A8B9C"/></marker>' +
  '<marker id="tipHot" viewBox="0 0 8 8" refX="6.6" refY="4" markerWidth="6.5" markerHeight="6.5" orient="auto">' +
  '<path d="M0.5 0.8 L7 4 L0.5 7.2 Z" fill="#7A8B9C"/></marker></defs>';

/** The canvas colour: both the picture and the SVG background are filled with it. */
const BACKDROP = "#F7F9FB";

export interface Rendered {
  src: string;
  w: number;
  h: number;
}

/** We take what is already drawn on the canvas and wrap it into a standalone SVG. */
export function renderSvg(b: BBox | null): Rendered | null {
  if (!b) return null;
  const edges = document.getElementById("edges");
  const nodes = document.getElementById("nodes");
  if (!edges || !nodes) return null;
  const pad = 30;
  const w = Math.round(b.w + pad * 2);
  const h = Math.round(b.h + pad * 2);
  const clean = edges.cloneNode(true) as Element;
  clean.querySelectorAll(".hit").forEach((el) => el.remove()); // the transparent click lines are not needed in a picture
  // a photo is a link to this server, which a file opened anywhere else cannot follow:
  // the picture keeps the round frame where the photo stood
  const people = nodes.cloneNode(true) as Element;
  people.querySelectorAll("image").forEach((el) => el.remove());
  const inner = clean.outerHTML + people.outerHTML;
  const src =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
    MARKERS +
    STYLE +
    '<rect width="' + w + '" height="' + h + '" fill="' + BACKDROP + '"/>' +
    '<g transform="translate(' + (pad - b.x1) + "," + (pad - b.y1) + ')">' +
    inner +
    "</g></svg>";
  return { src, w, h };
}

export function exportSvgFile(b: BBox | null): boolean {
  const r = renderSvg(b);
  if (!r) return false;
  download("genealogy.svg", new Blob([r.src], { type: "image/svg+xml" }));
  return true;
}

/**
 * Draw a finished SVG onto a canvas: both PNG and PDF live on this. We fill the
 * background ourselves — a transparent PNG on white paper does not look like the tree on
 * screen.
 */
export function rasterize(r: Rendered, scale: number): Promise<HTMLCanvasElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement("canvas");
      cv.width = Math.round(r.w * scale);
      cv.height = Math.round(r.h * scale);
      const ctx = cv.getContext("2d");
      if (!ctx) return rej(new Error("no canvas"));
      ctx.fillStyle = BACKDROP;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      res(cv);
    };
    img.onerror = () => rej(new Error("the picture did not come together"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.src);
  });
}

export function exportPngFile(b: BBox | null, fail: () => void): boolean {
  const r = renderSvg(b);
  if (!r) return false;
  void rasterize(r, Math.min(2.5, 3200 / Math.max(r.w, r.h, 1)))
    .then((cv) => cv.toBlob((blob) => (blob ? download("genealogy.png", blob) : fail())))
    .catch(fail);
  return true;
}
