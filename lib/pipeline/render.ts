/**
 * Browser-side rasterisation: render a pdf.js page to one canvas, then slice a
 * Deep Zoom (DZI) tile pyramid from it, plus crop each legend glyph.
 *
 * One-time authoring step. Renders the full page once at the target scale
 * (kept within the canvas size cap), then halves repeatedly for the pyramid —
 * far cheaper than re-rendering the PDF per tile.
 */

import type { BBox } from "./types";

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  scale: number; // device px per PDF point
  width: number; // px
  height: number; // px
}

type PdfPage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
};

const CANVAS_CAP = 8192; // safe across browsers

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** render the whole page to a single canvas at the largest scale that fits the cap */
export async function renderPage(page: PdfPage, targetDpi = 220): Promise<RenderedPage> {
  const at1 = page.getViewport({ scale: 1 });
  let scale = targetDpi / 72;
  const longest = Math.max(at1.width, at1.height) * scale;
  if (longest > CANVAS_CAP) scale *= CANVAS_CAP / longest;

  const vp = page.getViewport({ scale });
  const width = Math.ceil(vp.width);
  const height = Math.ceil(vp.height);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { canvas, scale, width, height };
}

export interface Tile {
  level: number;
  col: number;
  row: number;
  blob: Blob;
}

export interface DziResult {
  /** the .dzi descriptor XML */
  descriptor: string;
  tiles: Tile[];
  tileSize: number;
  overlap: number;
  width: number;
  height: number;
}

const halveCanvas = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const w = Math.max(1, Math.ceil(src.width / 2));
  const h = Math.max(1, Math.ceil(src.height / 2));
  const dst = makeCanvas(w, h);
  const ctx = dst.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return dst;
};

const toBlob = (c: HTMLCanvasElement, type = "image/webp", quality = 0.9): Promise<Blob> =>
  new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), type, quality),
  );

/**
 * Slice `rendered` into a DZI pyramid. DZI level N has the image scaled to
 * 2^(N - maxLevel); maxLevel is ceil(log2(maxDimension)).
 */
export async function buildDzi(
  rendered: RenderedPage,
  { tileSize = 512, overlap = 1, format = "webp" as "webp" | "png" } = {},
): Promise<DziResult> {
  const { width, height } = rendered;
  const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
  const tiles: Tile[] = [];
  const mime = format === "png" ? "image/png" : "image/webp";

  let canvas = rendered.canvas;
  for (let level = maxLevel; level >= 0; level--) {
    const cols = Math.ceil(canvas.width / tileSize);
    const rows = Math.ceil(canvas.height / tileSize);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * tileSize - (col > 0 ? overlap : 0);
        const y = row * tileSize - (row > 0 ? overlap : 0);
        const w = Math.min(tileSize + (col > 0 ? overlap : 0) + overlap, canvas.width - x);
        const h = Math.min(tileSize + (row > 0 ? overlap : 0) + overlap, canvas.height - y);
        const t = makeCanvas(w, h);
        t.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        tiles.push({ level, col, row, blob: await toBlob(t, mime) });
      }
    }
    if (level > 0) canvas = halveCanvas(canvas);
  }

  const descriptor =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Image xmlns="http://schemas.microsoft.com/deepzoom/2008"` +
    ` Format="${format}" Overlap="${overlap}" TileSize="${tileSize}">` +
    `<Size Width="${width}" Height="${height}"/></Image>`;

  return { descriptor, tiles, tileSize, overlap, width, height };
}

export interface CropMeta {
  canvas: HTMLCanvasElement;
  /** device-space (PDF point) origin of the crop's top-left */
  originDevice: { x: number; y: number };
  /** crop canvas pixels per device point */
  scale: number;
}

/** crop a device-space box out of the rendered page, keeping the coord mapping */
export function cropRegionMeta(
  rendered: RenderedPage,
  box: BBox,
  { pad = 0, upscale = 1 }: { pad?: number; upscale?: number } = {},
): CropMeta | null {
  const s = rendered.scale;
  const dx0 = Math.max(0, box.x0 - pad);
  const dy0 = Math.max(0, box.y0 - pad);
  const x = dx0 * s;
  const y = dy0 * s;
  const w = Math.min(rendered.width - x, (box.x1 - box.x0 + 2 * pad) * s);
  const h = Math.min(rendered.height - y, (box.y1 - box.y0 + 2 * pad) * s);
  if (w < 1 || h < 1) return null;
  const c = makeCanvas(Math.ceil(w * upscale), Math.ceil(h * upscale));
  const ctx = c.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(rendered.canvas, x, y, w, h, 0, 0, c.width, c.height);
  return { canvas: c, originDevice: { x: dx0, y: dy0 }, scale: s * upscale };
}

/** crop a device-space box out of the rendered page into its own canvas */
export function cropRegion(
  rendered: RenderedPage,
  box: BBox,
  opts: { pad?: number; upscale?: number } = {},
): HTMLCanvasElement | null {
  return cropRegionMeta(rendered, box, opts)?.canvas ?? null;
}

/**
 * Threshold light CAD linework to pure black/white and optionally fatten the
 * strokes — Tesseract can't read hairline outlined text without this.
 * Mutates and returns the canvas.
 */
export function binarize(
  canvas: HTMLCanvasElement,
  { threshold = 235, thicken = 1 }: { threshold?: number; thicken?: number } = {},
): HTMLCanvasElement {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  let ink = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    ink[p] = lum < threshold ? 1 : 0;
  }
  for (let t = 0; t < thicken; t++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1 && !on; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && ink[ny * w + nx]) on = 1;
          }
        }
        next[y * w + x] = on;
      }
    }
    ink = next;
  }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = ink[p] ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** crop each legend glyph out of the rendered page (device coords × scale) */
export async function cropGlyphs(
  rendered: RenderedPage,
  glyphBoxes: { rowIndex: number; box: BBox }[],
  pad = 3,
): Promise<{ rowIndex: number; blob: Blob }[]> {
  const s = rendered.scale;
  const out: { rowIndex: number; blob: Blob }[] = [];
  for (const { rowIndex, box } of glyphBoxes) {
    const x = Math.max(0, (box.x0 - pad) * s);
    const y = Math.max(0, (box.y0 - pad) * s);
    const w = Math.min(rendered.width - x, (box.x1 - box.x0 + 2 * pad) * s);
    const h = Math.min(rendered.height - y, (box.y1 - box.y0 + 2 * pad) * s);
    if (w < 1 || h < 1) continue;
    const c = makeCanvas(Math.ceil(w), Math.ceil(h));
    const ctx = c.getContext("2d", { alpha: false })!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(rendered.canvas, x, y, w, h, 0, 0, w, h);
    out.push({ rowIndex, blob: await toBlob(c, "image/png") });
  }
  return out;
}

/** DZI tile path convention used by the asset route + OpenSeadragon config */
export const tileKey = (level: number, col: number, row: number, format = "webp") =>
  `tiles/${level}/${col}_${row}.${format}`;
