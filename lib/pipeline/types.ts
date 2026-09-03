/**
 * Shared domain types for the plan-ingestion pipeline.
 * All geometry is in *device space*: origin top-left, y-down, units = PDF points
 * (i.e. the pdf.js viewport at scale 1). Normalised coords are 0..1 of page size.
 */

export type RGB = [number, number, number]; // each channel 0..255

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A single painted path, already flattened to device space. */
export interface VectorPath {
  bbox: BBox;
  /** on-path vertices, flattened [x0,y0,x1,y1,...] in device space */
  points: number[];
  fill: RGB | null;
  stroke: RGB | null;
  /** the paint operator that flushed this path (stroke | fill | fillStroke | ...) */
  paint: string;
}

export interface PageVectors {
  /** device px at scale 1 (equals PDF points) */
  width: number;
  height: number;
  paths: VectorPath[];
}

export interface LegendRow {
  rowIndex: number; // 0 = topmost data row (title row excluded)
  rowBBox: BBox;
  glyphBBox: BBox;
  glyphPaths: VectorPath[];
  textBBox: BBox | null;
}

export interface GlyphSignature {
  /** quantised color -> count, e.g. { "255,0,255": 3, "0,0,0": 5 } */
  colors: Record<string, number>;
  width: number;
  height: number;
  aspect: number;
  pathCount: number;
  /** total path length / (width + height) — scale-invariant */
  strokeLen: number;
  /** 8x8 ink-occupancy grid, row-major, values 0..1 */
  cells: number[];
}

export interface SymbolDef {
  id: string; // stable slug
  rowIndex: number;
  labelHe: string;
  signature: GlyphSignature;
  expectedCount?: number; // from the BOQ table, if known
}

export interface PlacementCandidate {
  symbolId: string;
  x: number; // normalised 0..1
  y: number; // normalised 0..1
  confidence: number; // 0..1
  bbox: BBox; // device space
}

export interface PlanSpec {
  pageWidth: number;
  pageHeight: number;
  renderDpi: number;
  symbols: SymbolDef[];
  candidates: PlacementCandidate[];
}

/* ------------------------------- geometry ------------------------------- */

export const bboxUnion = (a: BBox, b: BBox): BBox => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

export const bboxCenter = (b: BBox): [number, number] => [
  (b.x0 + b.x1) / 2,
  (b.y0 + b.y1) / 2,
];

export const bboxArea = (b: BBox): number =>
  Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export const bboxContainsPoint = (b: BBox, x: number, y: number, pad = 0): boolean =>
  x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;

export const bboxIntersects = (a: BBox, b: BBox, pad = 0): boolean =>
  a.x0 - pad <= b.x1 && a.x1 + pad >= b.x0 && a.y0 - pad <= b.y1 && a.y1 + pad >= b.y0;
