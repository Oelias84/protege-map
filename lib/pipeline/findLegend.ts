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
  /** how the legend was located */
  via: "text" | "geometry";
}

/** minimal shape of a pdf.js text item */
export interface TextItem {
  str: string;
  /** [a, b, c, d, e, f] — e,f are the x,y origin in PDF space (y-up) */
  transform: number[];
  width?: number;
  height?: number;
}

const LEGEND_WORDS = ["מקרא", "מקרא הסימנים", "מקרא סימנים", "רשימת סמלים", "legend", "key"];
const norm = (s: string) => s.trim().toLowerCase().replace(/[:\s]+/g, "");
const rev = (s: string) => [...s].reverse().join("");

/**
 * Find the legend title in the text layer. CAD exports often keep it as real
 * text; some reverse Hebrew glyph order, so we test the string and its reverse.
 * Returns the title's bbox in device space (y-down, origin top-left).
 */
export function findLegendTitle(items: TextItem[], pageHeight: number): BBox | null {
  const targets = new Set<string>();
  for (const w of LEGEND_WORDS) {
    targets.add(norm(w));
    targets.add(norm(rev(w)));
  }
  const isHit = (s: string) => {
    const n = norm(s);
    return n.length > 0 && [...targets].some((t) => n === t || (t.length >= 4 && n.includes(t)));
  };

  for (let i = 0; i < items.length; i++) {
    // check the item alone and joined with the next two (words get split)
    const joins = [items[i].str, items[i].str + (items[i + 1]?.str ?? ""), items[i].str + (items[i + 1]?.str ?? "") + (items[i + 2]?.str ?? "")];
    if (!joins.some(isHit)) continue;
    const t = items[i].transform;
    const w = items[i].width ?? 30;
    const h = items[i].height ?? 12;
    const x0 = t[4];
    const y1 = pageHeight - t[5]; // baseline, device space
    return { x0, y0: y1 - h, x1: x0 + w, y1 };
  }
  return null;
}

export interface FindLegendOptions {
  /** legend title bbox from the text layer (findLegendTitle) — a strong anchor */
  title?: BBox | null;
}

/** one scored candidate column of repeated marks */
export interface LegendColumn {
  colX0: number;
  colX1: number;
  cx: number;
  y0: number; // top of first mark
  y1: number; // top of last mark
  rowCount: number;
  score: number;
}

/**
 * Score vertical columns of small, evenly-spaced repeated marks.
 *
 * - "strict" (default): coloured symbols only, needs a few distinct colours and
 *   8+ rows. High precision — this is what auto-pick trusts.
 * - "loose": also accepts single-colour / black line symbols and 6+ rows. Too
 *   noisy to auto-pick (title blocks, schedules score high), but useful as a
 *   candidate list to confirm with OCR of the "מקרא" title.
 */
export function legendColumnCandidates(
  page: PageVectors,
  opts: FindLegendOptions & { mode?: "strict" | "loose" } = {},
): LegendColumn[] {
  const { width: W, height: H } = page;
  const title = opts.title ?? null;
  const loose = opts.mode === "loose";
  const [titleCx] = title ? bboxCenter(title) : [NaN];
  const minRows = loose ? 6 : 8;

  const seeds: { x: number; y: number; c: string }[] = [];
  // spatial index of small outlined-text-ish marks, bucketed by (x/24, y/6)
  const textGrid = new Set<string>();
  const gkey = (x: number, y: number) => `${Math.floor(x / 24)},${Math.floor(y / 6)}`;

  for (const p of page.paths) {
    const w = p.bbox.x1 - p.bbox.x0;
    const h = p.bbox.y1 - p.bbox.y0;
    if (w < 1 || h < 1) continue;
    const c = p.fill ?? p.stroke ?? null;
    const [x, y] = bboxCenter(p.bbox);
    if (w <= 26 && h <= 14 && isNeutral(c)) textGrid.add(gkey(x, y));
    if (w < 3 || h < 3 || w > 28 || h > 28 || isRed(c)) continue;
    if (!loose && !(c && !isNeutral(c))) continue; // strict: coloured only
    seeds.push({ x, y, c: c && !isNeutral(c) ? quant(c) : "" });
  }
  seeds.sort((a, b) => a.x - b.x);
  if (seeds.length < 10) return [];

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

  const out: LegendColumn[] = [];
  for (const pts of cols) {
    if (pts.length < minRows) continue;
    const ys = [...pts].sort((a, b) => a.y - b.y);

    const rowYs: number[] = [];
    for (const p of ys) if (!rowYs.length || p.y - rowYs[rowYs.length - 1] > 9) rowYs.push(p.y);
    const rows = rowYs.length;
    if (rows < minRows) continue;

    const gaps = rowYs.slice(1).map((y, i) => y - rowYs[i]).filter((g) => g > 4);
    const meanGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
    const cv =
      Math.sqrt(gaps.reduce((a, g) => a + (g - meanGap) ** 2, 0) / (gaps.length || 1)) /
      (meanGap || 1);
    const medGap = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] || meanGap;
    const spanRows = medGap > 4 ? Math.round((rowYs[rowYs.length - 1] - rowYs[0]) / medGap) + 1 : rows;
    const rowCount = Math.max(rows, spanRows);

    const colors = new Set(pts.map((p) => p.c).filter(Boolean)).size;
    if (!loose && colors < 3) continue; // strict: a real legend shows several symbol colours

    const xs = pts.map((p) => p.x);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const y0 = ys[0].y;
    const y1 = ys[ys.length - 1].y;

    // does each row have outlined text beside it? (legend rows do; device clusters don't)
    let rowsWithText = 0;
    for (const ry of rowYs) {
      let has = false;
      for (let dx = 24; dx <= 320 && !has; dx += 24) {
        if (textGrid.has(gkey(cx - dx, ry)) || textGrid.has(gkey(cx + dx, ry))) has = true;
      }
      if (has) rowsWithText++;
    }
    const textRatio = rowsWithText / rowYs.length;

    const fcx = cx / W;
    const fcy = (y0 + y1) / 2 / H;
    const marginBonus = (fcx > 0.7 || fcx < 0.16 ? 1.3 : 1) * (fcy > 0.6 || fcy < 0.18 ? 1.15 : 1);

    let titleBonus = 1;
    if (title) {
      const alignsX = Math.abs(cx - titleCx) < 240;
      const startsBelow = y0 >= title.y0 - 12 && y0 <= title.y1 + 100;
      if (alignsX && startsBelow) titleBonus = 6;
      else if (alignsX || startsBelow) titleBonus = 2;
    }

    const colourTerm = loose ? 1 + Math.pow(colors, 0.7) : Math.pow(colors, 1.3);
    const score =
      (rowCount *
        colourTerm *
        (0.5 + textRatio) *
        marginBonus *
        titleBonus *
        Math.min(1, (y1 - y0) / 170)) /
      (1 + cv * 2) /
      (1 + xSpread / 25);

    out.push({ colX0: Math.min(...xs), colX1: Math.max(...xs), cx, y0, y1, rowCount, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function findLegend(page: PageVectors, opts: FindLegendOptions = {}): LegendGuess | null {
  const { width: W, height: H } = page;
  const title = opts.title ?? null;
  const [titleCx] = title ? bboxCenter(title) : [NaN];

  const cands = legendColumnCandidates(page, opts);
  const best = cands[0];
  const second = cands[1]?.score ?? 0;

  // no convincing column — but if a title was found, derive a rect straight from it
  if (!best || best.score < 4) {
    if (!title) return null;
    const th = title.y1 - title.y0 || 12;
    return {
      rect: {
        x0: Math.max(0, titleCx - 300),
        x1: Math.min(W, titleCx + 300),
        y0: Math.max(0, title.y0 - 6),
        y1: Math.min(H, title.y1 + th * 34),
      },
      separation: 3,
      rows: 0,
      via: "text",
    };
  }

  const colX0 = best.colX0;
  const colX1 = best.colX1;
  const y0 = best.y0 - 28;
  const y1 = best.y1 + 34;

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
  // if the text layer gave a title above this column, snap the top to it
  if (title && Math.abs((rect.x0 + rect.x1) / 2 - titleCx) < 260 && title.y0 < rect.y0 + 40) {
    rect.y0 = Math.max(0, Math.min(rect.y0, title.y0 - 4));
  }
  rect.x0 = Math.max(0, rect.x0);
  rect.x1 = Math.min(W, rect.x1);

  return {
    rect,
    separation: best.score / (second || 1),
    rows: best.rowCount,
    via: title ? "text" : "geometry",
  };
}
