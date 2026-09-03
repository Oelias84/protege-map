/**
 * Rasterise a set of vector paths into a small normalised bitmap and compare
 * bitmaps by rotation-tolerant normalised cross-correlation.
 *
 * This is the precise classifier: the coarse signature (signature.ts) gates by
 * colour and size, then every legend glyph and every candidate blob is rendered
 * the same way and matched here. Pure math — identical in the browser and Node.
 */

import { bboxUnion, type BBox, type VectorPath } from "./types";

export interface GlyphRaster {
  size: number;
  /** length size*size, values 0..1, ink = 1 */
  data: Float32Array;
}

/**
 * @param paths   the strokes that make up the glyph
 * @param bbox    tight box to normalise into (defaults to union of paths)
 * @param size    output grid edge (default 32)
 * @param pad     fraction of the grid left as margin on each side (default 0.14)
 */
export function rasterizeGlyph(
  paths: VectorPath[],
  bbox?: BBox,
  size = 32,
  pad = 0.14,
): GlyphRaster {
  const box = bbox ?? paths.map((p) => p.bbox).reduce(bboxUnion);
  const bw = Math.max(1e-3, box.x1 - box.x0);
  const bh = Math.max(1e-3, box.y1 - box.y0);
  // preserve aspect ratio: fit the longer side into the padded grid
  const inner = size * (1 - 2 * pad);
  const scale = inner / Math.max(bw, bh);
  const offX = (size - bw * scale) / 2;
  const offY = (size - bh * scale) / 2;

  const data = new Float32Array(size * size);
  const splat = (x: number, y: number, w: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= size - 1 || yi >= size - 1) return;
    const fx = x - xi;
    const fy = y - yi;
    data[yi * size + xi] += w * (1 - fx) * (1 - fy);
    data[yi * size + xi + 1] += w * fx * (1 - fy);
    data[(yi + 1) * size + xi] += w * (1 - fx) * fy;
    data[(yi + 1) * size + xi + 1] += w * fx * fy;
  };

  for (const p of paths) {
    const pts = p.points;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = offX + (pts[i] - box.x0) * scale;
      const ay = offY + (pts[i + 1] - box.y0) * scale;
      const bx = offX + (pts[i + 2] - box.x0) * scale;
      const by = offY + (pts[i + 3] - box.y0) * scale;
      const len = Math.hypot(bx - ax, by - ay);
      const steps = Math.max(1, Math.ceil(len * 2));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        splat(ax + (bx - ax) * t, ay + (by - ay) * t, 1);
      }
    }
  }

  let max = 0;
  for (const v of data) if (v > max) max = v;
  if (max > 0) for (let i = 0; i < data.length; i++) data[i] = Math.min(1, data[i] / max);
  return { size, data };
}

/** zero-mean normalised cross-correlation of two equal-size rasters, −1..1 */
export function ncc(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-9 ? 0 : num / den;
}

/** rotate a size×size raster by k*90° */
export function rot90(src: Float32Array, size: number, k: number): Float32Array {
  k = ((k % 4) + 4) % 4;
  if (k === 0) return src;
  const out = new Float32Array(src.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let nx: number;
      let ny: number;
      if (k === 1) {
        nx = size - 1 - y;
        ny = x;
      } else if (k === 2) {
        nx = size - 1 - x;
        ny = size - 1 - y;
      } else {
        nx = y;
        ny = size - 1 - x;
      }
      out[ny * size + nx] = src[y * size + x];
    }
  }
  return out;
}

export interface Template {
  symbolId: string;
  raster: GlyphRaster;
}

/** best-matching template for a candidate raster, testing 4 rotations */
export function classifyRaster(
  cand: GlyphRaster,
  templates: Template[],
  { rotations = [0, 1, 2, 3] as number[] } = {},
): { symbolId: string; score: number } {
  let bestId = templates[0]?.symbolId ?? "";
  let best = -Infinity;
  for (const t of templates) {
    if (t.raster.size !== cand.size) continue;
    for (const k of rotations) {
      const r = k === 0 ? cand.data : rot90(cand.data, cand.size, k);
      const s = ncc(r, t.raster.data);
      if (s > best) {
        best = s;
        bestId = t.symbolId;
      }
    }
  }
  return { symbolId: bestId, score: best };
}
