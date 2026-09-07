/**
 * Browser ingestion orchestrator: PDF File -> everything needed to create a plan.
 *
 *   const draft = await ingestPdf(file, pdfjs, { legendRect, symbolMeta });
 *   await uploadPlan(draft);          // lib/client.ts
 *
 * pdf.js is the only heavy dependency. Gate the caller to desktop.
 */

import { binarize, buildDzi, cropGlyphs, cropRegionMeta, renderPage, tileKey, type Tile } from "./render";
import { extractVectors } from "./vectorExtract";
import { segmentLegend } from "./legend";
import { buildSignature } from "./signature";
import { buildTemplates, detectPlacements } from "./detect";
import { ocrBoxToDevice, ocrFindWords, ocrLegendLabels } from "./ocr";
import { findLegend, findLegendTitle, legendColumnCandidates } from "./findLegend";
import type { BBox, PageVectors, PlacementCandidate, SymbolDef } from "./types";

const LEGEND_TITLE_WORDS = ["מקרא", "מקרא הסימנים", "מקרא סימנים", "רשימת סמלים", "legend", "key"];

/**
 * Locate the legend, cheapest signal first:
 *   1. real text layer for "מקרא"
 *   2. geometry — a column of evenly-spaced symbols that clearly beats the rest
 *   3. OCR the title band above each top geometry candidate for "מקרא"
 *      (binarised + thickened — hairline outlined text is otherwise unreadable)
 *   4. best geometry guess, weak, or null
 * `onStep` reports the slow OCR step to the UI.
 */
async function locateLegend(
  pv: PageVectors,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfPage: any,
  onStep?: (msg: string) => void,
): Promise<ReturnType<typeof findLegend>> {
  // 1. real text layer
  const tc = await pdfPage.getTextContent().catch(() => null);
  const textTitle = tc ? findLegendTitle(tc.items as never[], pv.height) : null;
  if (textTitle) return findLegend(pv, { title: textTitle });

  // 2. geometry — accept a clear win outright
  const geom = findLegend(pv);
  if (geom && geom.separation >= 2.2) return geom;

  // 3. OCR the title band above each promising column (loose scan → confirm by word)
  const cands = legendColumnCandidates(pv, { mode: "loose" }).slice(0, 5);
  if (cands.length) {
    try {
      onStep?.('reading the sheet for "מקרא"…');
      const raster = await renderPage(pdfPage, 190);
      for (const c of cands) {
        // title sits just above the first symbol, spanning the row width
        const band: BBox = {
          x0: c.cx - 200,
          x1: c.cx + 200,
          y0: c.y0 - 44,
          y1: c.y0 + 10,
        };
        const crop = cropRegionMeta(raster, band, { pad: 2, upscale: 2.2 });
        if (!crop) continue;
        binarize(crop.canvas, { threshold: 236, thicken: 1 });
        const hits = await ocrFindWords(crop.canvas, LEGEND_TITLE_WORDS, { psm: "6" });
        if (hits.length) {
          const title = ocrBoxToDevice(hits[0].bbox, crop);
          return findLegend(pv, { title });
        }
      }
    } catch {
      /* OCR is best-effort */
    }
  }

  // 4. nothing confident — best geometry guess (may be weak) or null
  return geom;
}

/** operator-supplied metadata for each legend row, in row order */
export interface SymbolMeta {
  slug: string;
  labelHe: string;
  expectedCount?: number | null;
}

export interface IngestOptions {
  /** legend frame in device space. Omit to auto-locate it (findLegend). */
  legendRect?: BBox;
  /**
   * One entry per legend row, top-to-bottom. Optional — when omitted, a symbol
   * is auto-created for every detected legend row (generic slug, blank label,
   * the glyph crop as its identity) so the operator gets a ready button set.
   */
  symbolMeta?: SymbolMeta[];
  /** regions to skip when scanning for instances (defaults to just the legend) */
  excludeRects?: BBox[];
  targetDpi?: number;
  /** skip auto-detection; start the operator from a blank plan */
  skipDetect?: boolean;
  /** OCR the legend description text into button names (default true when no labels given) */
  ocr?: boolean;
  onOcrProgress?: (done: number, total: number) => void;
  /** coarse status for slow steps (legend OCR, etc.) */
  onStep?: (msg: string) => void;
}

export interface PlanDraft {
  id: string; // client-generated so asset paths are known before insert
  name: string;
  pdf: Blob;
  dziDescriptor: string;
  tiles: Tile[];
  width: number;
  height: number;
  renderDpi: number;
  scale: number;
  legendRect: BBox;
  symbols: Array<{
    slug: string;
    labelHe: string;
    rowIndex: number;
    expectedCount: number | null;
    glyph: Blob | null;
  }>;
  candidates: PlacementCandidate[];
}

type Pdfjs = typeof import("pdfjs-dist");

export async function ingestPdf(
  file: File,
  pdfjs: Pdfjs,
  opts: IngestOptions = {},
): Promise<PlanDraft> {
  const { symbolMeta, targetDpi = 220 } = opts;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });

  const pv = extractVectors(await page.getOperatorList(), pdfjs.OPS, viewport);

  const auto = opts.legendRect ? null : await locateLegend(pv, page, opts.onStep);
  const legendRect = opts.legendRect ?? auto?.rect;
  if (!legendRect) {
    throw new Error(
      "Could not locate the מקרא legend automatically — draw a box around it manually.",
    );
  }
  const excludeRects = opts.excludeRects ?? [legendRect];
  const rows = segmentLegend(pv, {
    legendRect,
    // operator's list wins; else the auto row-count estimate; else gap clustering
    expectedRows: opts.symbolMeta?.length || auto?.rows || undefined,
  });

  // one symbol per legend row — use the operator's metadata if given, else auto
  const meta: SymbolMeta[] = rows.map((_, i) => {
    const m = opts.symbolMeta?.[i];
    return {
      slug: m?.slug || `symbol-${i + 1}`,
      labelHe: m?.labelHe ?? "",
      expectedCount: m?.expectedCount ?? null,
    };
  });

  const symbolDefs: SymbolDef[] = rows.map((r, i) => ({
    id: meta[i].slug,
    rowIndex: i,
    labelHe: meta[i].labelHe,
    expectedCount: meta[i].expectedCount ?? undefined,
    signature: buildSignature(r.glyphPaths, r.glyphBBox),
  }));
  const templates = buildTemplates(rows, meta.map((m) => m.slug));

  const candidates = opts.skipDetect
    ? []
    : detectPlacements(pv, symbolDefs, { excludeRects, templates });

  const rendered = await renderPage(page, targetDpi);
  const dzi = await buildDzi(rendered);
  const glyphs = await cropGlyphs(
    rendered,
    rows.map((r) => ({ rowIndex: r.rowIndex, box: r.glyphBBox })),
  );
  const glyphByRow = new Map(glyphs.map((g) => [g.rowIndex, g.blob]));

  // fill blank labels from the legend text via OCR (rough — operator corrects inline)
  const wantOcr = opts.ocr ?? !opts.symbolMeta;
  if (wantOcr) {
    try {
      const labels = await ocrLegendLabels(rendered, rows, {
        onProgress: opts.onOcrProgress,
      });
      meta.forEach((m, i) => {
        if (!m.labelHe) m.labelHe = labels.get(i) ?? "";
      });
    } catch {
      /* OCR is best-effort; fall back to generic names */
    }
  }

  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.pdf$/i, ""),
    pdf: file,
    dziDescriptor: dzi.descriptor,
    tiles: dzi.tiles,
    width: dzi.width,
    height: dzi.height,
    renderDpi: targetDpi,
    scale: rendered.scale,
    legendRect,
    symbols: meta.map((m, i) => ({
      slug: m.slug,
      labelHe: m.labelHe,
      rowIndex: i,
      expectedCount: m.expectedCount ?? null,
      glyph: glyphByRow.get(i) ?? null,
    })),
    candidates,
  };
}

export { tileKey };

/**
 * Pre-pass for the upload UI: extract vectors and auto-locate the legend (text
 * layer → geometry → OCR the sheet for "מקרא") so the box can be pre-drawn or
 * ingest can start straight away. `onStep` reports the slow OCR fallback.
 */
export async function detectLegendRect(
  file: File,
  pdfjs: Pdfjs,
  onStep?: (msg: string) => void,
): Promise<{
  rect: BBox;
  pageWidth: number;
  pageHeight: number;
  separation: number;
  via: "text" | "geometry";
} | null> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const pv = extractVectors(await page.getOperatorList(), pdfjs.OPS, viewport);
  const guess = await locateLegend(pv, page, onStep);
  return guess
    ? {
        rect: guess.rect,
        pageWidth: pv.width,
        pageHeight: pv.height,
        separation: guess.separation,
        via: guess.via,
      }
    : null;
}
