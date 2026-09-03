/**
 * Segment the מקרא legend into rows and isolate the symbol glyph in each.
 *
 * The legend text is outlined to curves (no text layer), so we work on geometry
 * + colour only. Strategy:
 *   1. keep coloured, glyph-sized paths in the right-hand glyph column
 *   2. the legend has a known row count at an even pitch — bin each glyph seed
 *      into its row (far more robust than gap detection when rows touch)
 *   3. per row: glyph = seeds in that row + neutral detail whose centre is inside
 *      their box, clipped to a one-row-tall window so a tall neighbour can't bleed in
 *   4. attach the description text (everything else in the row's y-band)
 */

import {
  bboxCenter,
  bboxUnion,
  type BBox,
  type LegendRow,
  type PageVectors,
  type RGB,
  type VectorPath,
} from "./types";

const isNeutral = (c: RGB | null): boolean => {
  if (!c) return true;
  const [r, g, b] = c;
  return Math.abs(r - g) < 16 && Math.abs(g - b) < 16;
};
const colorOf = (p: VectorPath): RGB | null => p.fill ?? p.stroke ?? null;

export interface LegendOptions {
  /** legend frame in device space (origin top-left, y-down, PDF points) */
  legendRect: BBox;
  /** number of data rows (excludes the "מקרא" title). Enables even-pitch binning. */
  expectedRows?: number;
  /** width of the right-hand glyph column (device px) */
  glyphBand?: number;
  /** largest a single glyph can be (device px) */
  maxGlyph?: number;
}

export function segmentLegend(page: PageVectors, opts: LegendOptions): LegendRow[] {
  const { legendRect, expectedRows, glyphBand = 40, maxGlyph = 28 } = opts;
  const bandStart = legendRect.x1 - glyphBand;

  const inRect = (p: VectorPath) => {
    const [cx, cy] = bboxCenter(p.bbox);
    return (
      cx >= legendRect.x0 - 4 &&
      cx <= legendRect.x1 + 4 &&
      cy >= legendRect.y0 - 4 &&
      cy <= legendRect.y1 + 4
    );
  };
  const inside = page.paths.filter(inRect);
  if (!inside.length) return [];

  // coloured glyph-column seeds
  const seeds = inside
    .filter((p) => {
      const [cx] = bboxCenter(p.bbox);
      const w = p.bbox.x1 - p.bbox.x0;
      const h = p.bbox.y1 - p.bbox.y0;
      return cx >= bandStart && !isNeutral(colorOf(p)) && w <= maxGlyph && h <= maxGlyph;
    })
    .sort((a, b) => bboxCenter(a.bbox)[1] - bboxCenter(b.bbox)[1]);
  if (!seeds.length) return [];

  const seedY = seeds.map((p) => bboxCenter(p.bbox)[1]);
  const yTop = seedY[0];
  const yBot = seedY[seedY.length - 1];

  // assign each seed a row index
  let rowCount: number;
  let pitch: number;
  if (expectedRows && expectedRows > 1) {
    rowCount = expectedRows;
    pitch = (yBot - yTop) / (expectedRows - 1);
  } else {
    // fall back to gap clustering to estimate the row count
    let n = 1;
    for (let i = 1; i < seedY.length; i++) if (seedY[i] - seedY[i - 1] > 9) n++;
    rowCount = n;
    pitch = (yBot - yTop) / Math.max(1, n - 1);
  }
  const rowOf = (cy: number) =>
    Math.max(0, Math.min(rowCount - 1, Math.round((cy - yTop) / (pitch || 1))));

  const buckets: VectorPath[][] = Array.from({ length: rowCount }, () => []);
  seeds.forEach((p, i) => buckets[rowOf(seedY[i])].push(p));

  const half = (pitch || maxGlyph) / 2 + 3;
  const rows: LegendRow[] = [];
  buckets.forEach((glyphSeeds, r) => {
    if (!glyphSeeds.length) return;
    const rowCenter = yTop + r * pitch;
    let glyphPaths = [...glyphSeeds];
    let glyphBBox = glyphPaths.map((p) => p.bbox).reduce(bboxUnion);

    // neutral detail inside the glyph box, but only within this row's y-window
    for (const p of inside) {
      if (glyphPaths.includes(p)) continue;
      const [cx, cy] = bboxCenter(p.bbox);
      const w = p.bbox.x1 - p.bbox.x0;
      const h = p.bbox.y1 - p.bbox.y0;
      if (w > maxGlyph || h > maxGlyph) continue;
      if (Math.abs(cy - rowCenter) > half) continue;
      if (
        cx >= glyphBBox.x0 - 3 &&
        cx <= glyphBBox.x1 + 3 &&
        cy >= glyphBBox.y0 - 3 &&
        cy <= glyphBBox.y1 + 3
      ) {
        glyphPaths.push(p);
        glyphBBox = bboxUnion(glyphBBox, p.bbox);
      }
    }

    const bandMembers = inside.filter((p) => Math.abs(bboxCenter(p.bbox)[1] - rowCenter) <= half);
    const textPaths = bandMembers.filter(
      (p) => !glyphPaths.includes(p) && bboxCenter(p.bbox)[0] < bandStart,
    );
    const textBBox = textPaths.length ? textPaths.map((p) => p.bbox).reduce(bboxUnion) : null;
    const rowBBox = bandMembers.length
      ? bandMembers.map((p) => p.bbox).reduce(bboxUnion)
      : glyphBBox;

    rows.push({ rowIndex: rows.length, rowBBox, glyphBBox, glyphPaths, textBBox });
  });

  return rows;
}
