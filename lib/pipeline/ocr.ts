/**
 * OCR the (outlined, non-selectable) legend description text so auto-created
 * buttons get real names instead of "סימן N".
 *
 * Browser-only (tesseract.js). Hebrew CAD labels in a tiny font come back rough —
 * treat the result as a first draft the operator will correct inline. Language
 * data is fetched from the tesseract.js CDN on first run; self-host for offline.
 */

import { cropRegion, type RenderedPage } from "./render";
import type { BBox, LegendRow } from "./types";

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

/* ---------------------------- word search ---------------------------- */

export interface WordHit {
  text: string;
  /** bbox in the OCR canvas's own pixel space */
  bbox: BBox;
  confidence: number;
}

const wordKey = (s: string) => s.trim().toLowerCase().replace(/[^֐-׿a-z]/g, "");

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/** OCR of hairline outlined titles is imperfect ("מקרא" → "מכרא"); allow near-hits */
function fuzzyMatch(token: string, needleKey: string): boolean {
  if (token.length < 3) return false;
  if (token === needleKey || token.includes(needleKey) || needleKey.includes(token)) return true;
  const budget = needleKey.length <= 4 ? 1 : 2;
  return levenshtein(token, needleKey) <= budget;
}

/**
 * Find where given words appear as *pixels* on a rendered canvas — for titles
 * like "מקרא" that CAD exports outline to curves (no text layer to search).
 * Tests each word and its reverse (some exports flip Hebrew glyph order).
 */
export async function ocrFindWords(
  canvas: HTMLCanvasElement,
  needles: string[],
  { lang = "heb+eng", psm = "11" }: { lang?: string; psm?: string } = {},
): Promise<WordHit[]> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(lang);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });

    const want = new Set<string>();
    for (const n of needles) {
      want.add(wordKey(n));
      want.add(wordKey([...n].reverse().join("")));
    }

    type W = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
    // group words into lines so we can rejoin ones split by wide letter-spacing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blocks = (data as any).blocks ?? [];
    const lines: W[][] = blocks.length
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blocks.flatMap((b: any) =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (b.paragraphs ?? []).flatMap((p: any) => (p.lines ?? []).map((l: any) => l.words ?? [])),
        )
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [((data as any).words as W[]) ?? []];

    const hits: WordHit[] = [];
    for (const line of lines) {
      for (let i = 0; i < line.length; i++) {
        for (let span = 1; span <= 3 && i + span <= line.length; span++) {
          const win = line.slice(i, i + span);
          const k = wordKey(win.map((w) => w.text).join(""));
          if (k.length < 3) continue;
          if (![...want].some((t) => fuzzyMatch(k, t))) continue;
          hits.push({
            text: win.map((w) => w.text).join(" "),
            confidence: win.reduce((s, w) => s + w.confidence, 0) / win.length,
            bbox: {
              x0: Math.min(...win.map((w) => w.bbox.x0)),
              y0: Math.min(...win.map((w) => w.bbox.y0)),
              x1: Math.max(...win.map((w) => w.bbox.x1)),
              y1: Math.max(...win.map((w) => w.bbox.y1)),
            },
          });
        }
      }
    }
    return hits.sort((a, b) => b.confidence - a.confidence);
  } finally {
    await worker.terminate();
  }
}

/** map a bbox from a crop's pixel space back to device space (PDF points) */
export function ocrBoxToDevice(
  hit: BBox,
  crop: { originDevice: { x: number; y: number }; scale: number },
): BBox {
  return {
    x0: crop.originDevice.x + hit.x0 / crop.scale,
    y0: crop.originDevice.y + hit.y0 / crop.scale,
    x1: crop.originDevice.x + hit.x1 / crop.scale,
    y1: crop.originDevice.y + hit.y1 / crop.scale,
  };
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
