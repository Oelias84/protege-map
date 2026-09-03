/**
 * Browser ingestion orchestrator: PDF File -> everything needed to create a plan.
 *
 *   const draft = await ingestPdf(file, pdfjs, { legendRect, symbolMeta });
 *   await uploadPlan(draft);          // lib/client.ts
 *
 * pdf.js is the only heavy dependency. Gate the caller to desktop.
 */

import { buildDzi, cropGlyphs, renderPage, tileKey, type Tile } from "./render";
import { extractVectors } from "./vectorExtract";
import { segmentLegend } from "./legend";
import { buildSignature } from "./signature";
import { buildTemplates, detectPlacements } from "./detect";
import { ocrLegendLabels } from "./ocr";
import type { BBox, PlacementCandidate, SymbolDef } from "./types";

/** operator-supplied metadata for each legend row, in row order */
export interface SymbolMeta {
  slug: string;
  labelHe: string;
  expectedCount?: number | null;
}

export interface IngestOptions {
  legendRect: BBox;
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

export async function ingestPdf(file: File, pdfjs: Pdfjs, opts: IngestOptions): Promise<PlanDraft> {
  const { legendRect, symbolMeta, excludeRects = [legendRect], targetDpi = 220 } = opts;

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });

  const pv = extractVectors(await page.getOperatorList(), pdfjs.OPS, viewport);
  const rows = segmentLegend(pv, {
    legendRect,
    expectedRows: opts.symbolMeta?.length || undefined,
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
