/**
 * OCR the (outlined, non-selectable) legend description text so auto-created
 * buttons get real names instead of "סימן N".
 *
 * Browser-only (tesseract.js). Hebrew CAD labels in a tiny font come back rough —
 * treat the result as a first draft the operator will correct inline. Language
 * data is fetched from the tesseract.js CDN on first run; self-host for offline.
 */

import { cropRegion, type RenderedPage } from "./render";
import type { LegendRow } from "./types";

export interface OcrOptions {
  /** tesseract language(s); "heb" or "heb+eng" for model numbers */
  lang?: string;
  /** upscale the text crop before OCR — small type needs it */
  upscale?: number;
  /** drop results below this mean confidence (0..100) */
  minConfidence?: number;
  onProgress?: (done: number, total: number) => void;
}

/** rowIndex -> best-guess label */
export async function ocrLegendLabels(
  rendered: RenderedPage,
  rows: LegendRow[],
  opts: OcrOptions = {},
): Promise<Map<number, string>> {
  const { lang = "heb+eng", upscale = 3, minConfidence = 45, onProgress } = opts;
  const withText = rows.filter((r) => r.textBBox);
  const out = new Map<number, string>();
  if (!withText.length) return out;

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang);
  try {
    // one text line per crop
    await worker.setParameters({ tessedit_pageseg_mode: "7" as never });
    let done = 0;
    for (const r of withText) {
      const canvas = cropRegion(rendered, r.textBBox!, { pad: 2, upscale });
      if (canvas) {
        const { data } = await worker.recognize(canvas);
        const text = normalise(data.text);
        if (text && data.confidence >= minConfidence) out.set(r.rowIndex, text);
      }
      onProgress?.(++done, withText.length);
    }
  } finally {
    await worker.terminate();
  }
  return out;
}

/** collapse whitespace, drop the "– N" separator noise, keep Hebrew + Latin + digits */
function normalise(raw: string): string {
  let s = raw
    .replace(/\s+/g, " ")
    .replace(/[^֐-׿A-Za-z0-9"'.\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // the legend row is "<desc>  –  <glyph>"; OCR often tacks on "- 0" / "0 -" / lone dashes
  s = s.replace(/^[\s\-–—.0-9]+/, "").replace(/[\s\-–—.0-9]+$/, "").trim();
  // reject if almost nothing survived or it's mostly Latin noise with no real word
  if (s.replace(/[^֐-׿A-Za-z]/g, "").length < 3) return "";
  return s;
}
