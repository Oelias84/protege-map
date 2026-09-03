/**
 * Walk a pdf.js operator list and reconstruct every painted vector path in
 * device space, carrying its resolved fill / stroke colour.
 *
 * Works in the browser and in Node (legacy build). It needs only:
 *   - the operator list from `page.getOperatorList()`
 *   - the `OPS` enum from the pdfjs module
 *   - `viewport.transform` from `page.getViewport({ scale: 1 })`
 *
 * Raster XObjects (the ~6k hatch slivers in CAD exports) are intentionally ignored.
 */

import type { BBox, PageVectors, RGB, VectorPath } from "./types";

type Matrix = [number, number, number, number, number, number];

/** m ∘ n  (apply n, then m) — pdf.js Util.transform convention */
function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function applyPt(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const grayToRgb = (g: number): RGB => {
  const v = clamp255(g <= 1 ? g * 255 : g);
  return [v, v, v];
};
const cmykToRgb = (c: number, m: number, y: number, k: number): RGB => [
  clamp255(255 * (1 - Math.min(1, c + k))),
  clamp255(255 * (1 - Math.min(1, m + k))),
  clamp255(255 * (1 - Math.min(1, y + k))),
];
const rgbArg = (a: number[]): RGB => {
  // pdf.js emits 0..255 ints for setFillRGBColor; be tolerant of 0..1 too.
  const scaled = a.some((v) => v > 1);
  return [
    clamp255(scaled ? a[0] : a[0] * 255),
    clamp255(scaled ? a[1] : a[1] * 255),
    clamp255(scaled ? a[2] : a[2] * 255),
  ];
};

interface GState {
  ctm: Matrix;
  fill: RGB | null;
  stroke: RGB | null;
}

export interface OperatorList {
  fnArray: number[];
  argsArray: any[];
}

/** The bits of a pdf.js PageViewport we need. */
export interface ViewportLike {
  transform: number[];
  width: number;
  height: number;
}

const PAINT_OPS = new Set([
  "fill",
  "eoFill",
  "stroke",
  "fillStroke",
  "eoFillStroke",
  "closeStroke",
  "closeFillStroke",
  "closeEOFillStroke",
]);

export function extractVectors(
  opList: OperatorList,
  OPS: Record<string, number>,
  viewport: ViewportLike,
): PageVectors {
  const name: Record<number, string> = {};
  for (const [k, v] of Object.entries(OPS)) name[v] = k;

  const base = viewport.transform.slice() as Matrix;
  let gs: GState = { ctm: base.slice() as Matrix, fill: null, stroke: null };
  const stack: GState[] = [];

  const paths: VectorPath[] = [];
  let pendingPts: number[] | null = null;
  let pendingBBox: BBox | null = null;

  const bumpBBox = (b: BBox, x: number, y: number) => {
    if (x < b.x0) b.x0 = x;
    if (y < b.y0) b.y0 = y;
    if (x > b.x1) b.x1 = x;
    if (y > b.y1) b.y1 = y;
  };

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = name[opList.fnArray[i]];
    const args = opList.argsArray[i];

    switch (op) {
      case "save":
        stack.push({ ctm: gs.ctm.slice() as Matrix, fill: gs.fill, stroke: gs.stroke });
        break;
      case "restore": {
        const s = stack.pop();
        if (s) gs = s;
        break;
      }
      case "transform":
        gs.ctm = mul(gs.ctm, args as Matrix);
        break;

      case "setFillRGBColor":
        gs.fill = rgbArg(args);
        break;
      case "setStrokeRGBColor":
        gs.stroke = rgbArg(args);
        break;
      case "setFillGray":
        gs.fill = grayToRgb(args[0]);
        break;
      case "setStrokeGray":
        gs.stroke = grayToRgb(args[0]);
        break;
      case "setFillCMYKColor":
        gs.fill = cmykToRgb(args[0], args[1], args[2], args[3]);
        break;
      case "setStrokeCMYKColor":
        gs.stroke = cmykToRgb(args[0], args[1], args[2], args[3]);
        break;

      case "constructPath": {
        // pdf.js v4: args = [subOps: number[], coords: number[] | Float32Array, minMax?]
        const coords: ArrayLike<number> = args[1];
        const pts: number[] = [];
        const bb: BBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (let k = 0; k + 1 < coords.length; k += 2) {
          const [dx, dy] = applyPt(gs.ctm, coords[k], coords[k + 1]);
          pts.push(dx, dy);
          bumpBBox(bb, dx, dy);
        }
        if (pts.length) {
          pendingPts = pts;
          pendingBBox = bb;
        }
        break;
      }

      case "endPath":
      case "clip":
      case "eoClip":
        pendingPts = null;
        pendingBBox = null;
        break;

      default:
        if (PAINT_OPS.has(op) && pendingPts && pendingBBox) {
          paths.push({
            bbox: pendingBBox,
            points: pendingPts,
            fill: gs.fill,
            stroke: gs.stroke,
            paint: op,
          });
          pendingPts = null;
          pendingBBox = null;
        }
    }
  }

  return { width: viewport.width, height: viewport.height, paths };
}
