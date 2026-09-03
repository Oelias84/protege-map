/**
 * Locate the מקרא legend on a sheet automatically, so the operator doesn't have
 * to draw the box (and land it in the wrong place).
 *
 * The legend's fingerprint: a tall, tight, vertical column of small *coloured*
 * glyphs (many symbol types → several distinct colours), roughly evenly spaced,
 * sitting in a margin/panel rather than the drawing body. Scattered plan
 * instances form wide, colour-poor, irregular clusters and lose badly.
 */

import { bboxCenter, type BBox, type PageVectors, type RGB } from "./types";

const isNeutral = (c: RGB | null) => {
  if (!c) return true;
  const [r, g, b] = c;
  return Math.abs(r - g) < 16 && Math.abs(g - b) < 16;
};
const isRed = (c: RGB | null) => !!c && c[0] > 180 && c[1] < 90 && c[2] < 90; // loop wiring
const quant = (c: RGB) => `${Math.round(c[0] / 48) * 48},${Math.round(c[1] / 48) * 48},${Math.round(c[2] / 48) * 48}`;

export interface LegendGuess {
  rect: BBox;
  /** ratio of best column score to the runner-up — >2 is a confident lock */
  separation: number;
  rows: number;
}

export function findLegend(page: PageVectors): LegendGuess | null {
  const { width: W, height: H } = page;

  // coloured, glyph-sized seed points
  const seeds = page.paths
    .filter((p) => {
      const w = p.bbox.x1 - p.bbox.x0;
      const h = p.bbox.y1 - p.bbox.y0;
      if (w < 3 || h < 3 || w > 28 || h > 28) return false;
      const c = p.fill ?? p.stroke ?? null;
      return c && !isNeutral(c) && !isRed(c);
    })
    .map((p) => {
      const [x, y] = bboxCenter(p.bbox);
      return { x, y, c: quant((p.fill ?? p.stroke) as RGB) };
    })
    .sort((a, b) => a.x - b.x);
  if (seeds.length < 12) return null;

  // 1-D cluster on x (a glyph column is ~15-40 px wide)
  const cols: (typeof seeds)[] = [];
  let cur: typeof seeds = [];
  let lastX = -Infinity;
  for (const s of seeds) {
    if (cur.length && s.x - lastX > 22) {
      cols.push(cur);
      cur = [];
    }
    cur.push(s);
    lastX = s.x;
  }
  if (cur.length) cols.push(cur);

  let best: { score: number; pts: typeof seeds; rows: number } | null = null;
  let second = 0;

  for (const pts of cols) {
    if (pts.length < 8) continue;
    const ys = [...pts].sort((a, b) => a.y - b.y);

    const rowYs: number[] = [];
    for (const p of ys) if (!rowYs.length || p.y - rowYs[rowYs.length - 1] > 9) rowYs.push(p.y);
    const rows = rowYs.length;
    if (rows < 8) continue;

    const gaps = rowYs.slice(1).map((y, i) => y - rowYs[i]).filter((g) => g > 4);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
    const cv =
      Math.sqrt(gaps.reduce((a, g) => a + (g - meanGap) ** 2, 0) / (gaps.length || 1)) /
      (meanGap || 1);
    // a faint/tiny glyph row can be missed — estimate the true count from the span
    const medGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || meanGap;
    const spanRows = medGap > 4 ? Math.round((rowYs[rowYs.length - 1] - rowYs[0]) / medGap) + 1 : rows;
    const rowCount = Math.max(rows, spanRows);

    const colors = new Set(pts.map((p) => p.c)).size;
    if (colors < 3) continue;

    const xs = pts.map((p) => p.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const y0 = ys[0].y;
    const y1 = ys[ys.length - 1].y;

    const fcx = cx / W;
    const fcy = (y0 + y1) / 2 / H;
    const marginBonus = (fcx > 0.7 || fcx < 0.16 ? 1.6 : 1) * (fcy > 0.6 || fcy < 0.18 ? 1.3 : 1);

    const score =
      (rowCount * Math.pow(colors, 1.3) * marginBonus * Math.min(1, (y1 - y0) / 180)) /
      (1 + cv * 2) /
      (1 + xSpread / 25);

    if (!best || score > best.score) {
      second = best?.score ?? 0;
      best = { score, pts, rows: rowCount };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best || best.score < 8) return null;

  // build the rect: glyph column + the text column beside it
  const xs = best.pts.map((p) => p.x);
  const ys = best.pts.map((p) => p.y);
  const colX0 = Math.min(...xs);
  const colX1 = Math.max(...xs);
  const y0 = Math.min(...ys) - 28;
  const y1 = Math.max(...ys) + 34;

  // Which side holds the description text? Hebrew legends put text on the LEFT of
  // the glyph, so default there; only flip if the strip immediately right of the
  // column is clearly denser with row-aligned outlined text than the left strip.
  const nearRow = (y: number) => y >= y0 - 8 && y <= y1 + 8;
  let leftMass = 0;
  let rightMass = 0;
  for (const p of page.paths) {
    const w = p.bbox.x1 - p.bbox.x0;
    const h = p.bbox.y1 - p.bbox.y0;
    if (w > 30 || h > 16 || !isNeutral(p.fill ?? p.stroke ?? null)) continue;
    const [cx, cy] = bboxCenter(p.bbox);
    if (!nearRow(cy)) continue;
    if (cx < colX0 - 6 && cx > colX0 - 150) leftMass++;
    else if (cx > colX1 + 6 && cx < colX1 + 150) rightMass++;
  }
  const textLeft = !(rightMass > leftMass * 1.5 && rightMass > 30);

  const rect: BBox = {
    x0: textLeft ? colX0 - 320 : colX0 - 16,
    x1: textLeft ? colX1 + 16 : colX1 + 320,
    y0: Math.max(0, y0),
    y1: Math.min(H, y1),
  };
  // clamp to page
  rect.x0 = Math.max(0, rect.x0);
  rect.x1 = Math.min(W, rect.x1);

  return { rect, separation: best.score / (second || 1), rows: best.rows };
}
