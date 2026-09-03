/**
 * Offline harness: run the ingestion pipeline against a PDF and print a report.
 *   npx tsx scripts/probe-plan.mts <plan.pdf>
 *
 * Prints the auto-segmented legend, the candidate placements, and a per-symbol
 * tally against a hand-entered BOQ so you can see how far off detection is.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import { extractVectors } from "../lib/pipeline/vectorExtract.ts";
import { segmentLegend } from "../lib/pipeline/legend.ts";
import { buildSignature } from "../lib/pipeline/signature.ts";
import { buildTemplates, detectPlacements, tallyBySymbol } from "../lib/pipeline/detect.ts";
import type { BBox, SymbolDef } from "../lib/pipeline/types.ts";

const PDF = process.argv[2] ?? "/Users/ofirelias/Downloads/A2600015-F01-ORAD.pdf";

/** legend transcription + BOQ quantities — replace per drawing set */
const ROWS: Array<[string, string, number]> = [
  ["gas-nozzle", "נחיר פיזור גז 4 חרירים", 2],
  ["novec-cylinder", "מיכל כיבוי דגם NOVEC", 4],
  ["smoke-detector", "גלאי עשן Cerbrus PRO EN OP720", 54],
  ["strobe", "נצנץ", 7],
  ["call-point", "לחיץ אזעקת אש", 5],
  ["indicator-lamp", "מנורת סימון DG1191/1192", 39],
  ["panel-detector", "גלאי בלוח חשמל Cerbrus PRO EN OP720", 8],
  ["ceiling-speaker", "רמקול לתקרה אקוסטית", 33],
  ["void-detector", "גלאי עשן בין תקרות Cerbrus PRO EN OP 720", 29],
  ["output-unit", "יח' OUTPUT", 12],
  ["input-unit", "יח' INPUT", 10],
  ["door-magnet", "אלקטרו מגנט לדלת", 2],
  ["projector-speaker", "רמקול דגם פרוז'קטור", 2],
  ["intercom", "אינטרקום לאזור מחסה", 1],
  ["wall-speaker", "רמקול על גבי הקיר כולל קופסא", 1],
  ["tamper-switch", "טמפר סויטש מפסק גבול למגוף", 1],
  ["flow-switch", "מפסק זרימה", 1],
  ["algorex-enclosure", "מארז לגלאי אלגורקס בתעלת מ.א", 2],
];

/** legend + non-plan regions, device space (origin top-left, y-down, PDF points) */
const LEGEND_RECT: BBox = { x0: 1585, y0: 1150, x1: 1912, y1: 1565 };
const EXCLUDE: BBox[] = [
  LEGEND_RECT,
  { x0: 1380, y0: 1140, x1: 1595, y1: 1440 }, // BOQ
  { x0: 1980, y0: 300, x1: 2320, y1: 745 }, // notes
  { x0: 1880, y0: 0, x1: 2384, y1: 760 }, // title block
  { x0: 1200, y0: 975, x1: 1375, y1: 1110 }, // preaction A
  { x0: 1476, y0: 975, x1: 1650, y1: 1110 }, // preaction B
  { x0: 0, y0: 0, x1: 2384, y1: 118 }, // margins
  { x0: 0, y0: 1566, x1: 2384, y1: 1684 },
  { x0: 0, y0: 0, x1: 118, y1: 1684 },
  { x0: 1985, y0: 0, x1: 2384, y1: 1684 },
];

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(PDF)),
  disableWorker: true,
}).promise;
const page = await doc.getPage(1);
const viewport = page.getViewport({ scale: 1 });

const pv = extractVectors(await page.getOperatorList(), pdfjs.OPS as any, viewport);
console.log(`page ${pv.width}x${pv.height}  vector paths ${pv.paths.length}`);

const rows = segmentLegend(pv, { legendRect: LEGEND_RECT, expectedRows: ROWS.length });
console.log(`\nlegend rows: ${rows.length} / ${ROWS.length} expected`);

const symbols: SymbolDef[] = rows.slice(0, ROWS.length).map((row, i) => ({
  id: ROWS[i][0],
  rowIndex: i,
  labelHe: ROWS[i][1],
  expectedCount: ROWS[i][2],
  signature: buildSignature(row.glyphPaths, row.glyphBBox),
}));

const templates = buildTemplates(rows, ROWS.map((r) => r[0]));
const cands = detectPlacements(pv, symbols, { excludeRects: EXCLUDE, templates });
console.log(`\ncandidate placements: ${cands.length}`);

const tally = tallyBySymbol(cands);
console.log("\n  symbol                 found  BOQ  delta");
let g = 0;
let e = 0;
for (const s of symbols) {
  const got = tally[s.id] ?? 0;
  const exp = s.expectedCount ?? 0;
  g += got;
  e += exp;
  console.log(
    `  ${s.id.padEnd(22)} ${String(got).padStart(4)} ${String(exp).padStart(5)} ${String(got - exp).padStart(6)}`,
  );
}
console.log(`  ${"TOTAL".padEnd(22)} ${String(g).padStart(4)} ${String(e).padStart(5)}`);

fs.writeFileSync(
  "candidates.json",
  JSON.stringify({ width: pv.width, height: pv.height, symbols: symbols.map((s) => s.id), cands }),
);
console.log("\nwrote candidates.json");
