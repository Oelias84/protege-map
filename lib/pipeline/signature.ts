/**
 * Build a scale-invariant signature for a cluster of paths (a legend glyph or a
 * candidate instance on the plan) and compare two signatures.
 */

import { bboxUnion, type BBox, type GlyphSignature, type VectorPath } from "./types";

const GRID = 8;

/** quantise a colour to a 32-step lattice so near-identical inks collapse together */
const quantColor = (c: [number, number, number] | null): string => {
  if (!c) return "none";
  const q = (v: number) => Math.round(v / 32) * 32;
  return `${q(c[0])},${q(c[1])},${q(c[2])}`;
};

export function buildSignature(paths: VectorPath[], bbox?: BBox): GlyphSignature {
  const box = bbox ?? paths.map((p) => p.bbox).reduce(bboxUnion);
  const w = Math.max(1e-3, box.x1 - box.x0);
  const h = Math.max(1e-3, box.y1 - box.y0);

  const colors: Record<string, number> = {};
  let strokeLen = 0;
  const cells = new Array(GRID * GRID).fill(0);

  for (const p of paths) {
    const key = quantColor(p.fill ?? p.stroke ?? null);
    colors[key] = (colors[key] ?? 0) + 1;

    const pts = p.points;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const x0 = pts[i], y0 = pts[i + 1], x1 = pts[i + 2], y1 = pts[i + 3];
      strokeLen += Math.hypot(x1 - x0, y1 - y0);
      // stamp both endpoints + midpoint into the occupancy grid
      for (const [px, py] of [
        [x0, y0],
        [x1, y1],
        [(x0 + x1) / 2, (y0 + y1) / 2],
      ] as const) {
        const gx = Math.min(GRID - 1, Math.max(0, Math.floor(((px - box.x0) / w) * GRID)));
        const gy = Math.min(GRID - 1, Math.max(0, Math.floor(((py - box.y0) / h) * GRID)));
        cells[gy * GRID + gx] += 1;
      }
    }
  }

  const maxCell = Math.max(1, ...cells);
  for (let i = 0; i < cells.length; i++) cells[i] /= maxCell;

  return {
    colors,
    width: w,
    height: h,
    aspect: w / h,
    pathCount: paths.length,
    strokeLen: strokeLen / (w + h),
    cells,
  };
}

const cosine = (a: Record<string, number>, b: Record<string, number>): number => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const va = a[k] ?? 0, vb = b[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  return dot === 0 ? 0 : dot / Math.sqrt(na * nb);
};

export interface DistanceWeights {
  color: number;
  size: number;
  shape: number;
  count: number;
  stroke: number;
}

const DEFAULT_WEIGHTS: DistanceWeights = {
  color: 1.6,
  size: 0.8,
  shape: 1.0,
  count: 0.5,
  stroke: 0.5,
};

/** 0 = identical, grows with dissimilarity */
export function signatureDistance(
  a: GlyphSignature,
  b: GlyphSignature,
  w: DistanceWeights = DEFAULT_WEIGHTS,
): number {
  const colorTerm = 1 - cosine(a.colors, b.colors);

  const sizeTerm =
    Math.abs(Math.log(a.width / b.width)) + Math.abs(Math.log(a.height / b.height));

  let shape = 0;
  for (let i = 0; i < a.cells.length; i++) shape += (a.cells[i] - b.cells[i]) ** 2;
  shape = Math.sqrt(shape / a.cells.length);

  const countTerm =
    Math.abs(a.pathCount - b.pathCount) / (a.pathCount + b.pathCount + 1);

  const strokeTerm =
    Math.abs(a.strokeLen - b.strokeLen) / (a.strokeLen + b.strokeLen + 1e-3);

  return (
    w.color * colorTerm +
    w.size * sizeTerm +
    w.shape * shape +
    w.count * countTerm +
    w.stroke * strokeTerm
  );
}

/** squash a distance into a 0..1 confidence */
export const distanceToConfidence = (d: number, k = 1.1): number =>
  Math.exp(-k * Math.max(0, d));
