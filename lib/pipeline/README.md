# Plan ingestion pipeline (browser-capable)

Turns a vector building-plan PDF into a **plan spec**: a rendered raster plus a
list of symbol buttons with normalised coordinates. Runs in the browser with
`pdf.js`; the same modules run in Node for the offline harness.

## Modules

| File | Responsibility | Status |
|---|---|---|
| `types.ts` | shared types + bbox geometry helpers | stable |
| `vectorExtract.ts` | walk `page.getOperatorList()` → `VectorPath[]` in device space, with resolved fill/stroke colour. Ignores raster XObjects. | **works** — 333,706 paths from the sample in ~190 ms |
| `legend.ts` | given the legend rectangle, segment it into rows and isolate each symbol glyph (row clustering on the glyph column, then text attached by y-band) | **works** — 18/18 rows on the sample |
| `signature.ts` | scale-invariant glyph descriptor (colour histogram + 8×8 ink grid + path count + stroke length) and a distance function | coarse pre-filter only |
| `raster.ts` | rasterise paths to a normalised bitmap; rotation-tolerant NCC template match | works; needs a scale sweep |
| `detect.ts` | seeds → blobs → raster template classification → `PlacementCandidate[]` + BOQ tally | **partial** — see status below |
| `../scripts/probe-plan.mts` | offline report harness | — |

## Detection status (Stage 1.5)

On the sample sheet: **113 / 211** device markers placed, labels roughly right for
~10 of 17 symbol types. The gap is entirely in the legend templates: `segmentLegend`
still mis-crops ~6 rows whose glyph is tiny (`call-point` dot) or whose outlined
description bleeds into the glyph column (`void-detector`, `output-unit`,
`input-unit`), so those templates are malformed and nothing matches them.

Two fixes, in order of impact:
1. **Render legend glyphs via canvas**, not the path rasteriser — crop each row's
   glyph box out of a high-DPI `page.render()` and use that bitmap as the template.
   Sidesteps all path-clustering fragility. ~40 lines.
2. **Scale sweep** in `classifyRaster` (try 0.8–1.25×) — plan instances are drawn a
   little larger/smaller than the legend.

This does **not** block Stages 2–3: the authoring UI is the accuracy backstop —
operator confirms / relabels / adds-missed, with the BOQ tally as the checklist.

## Run the harness

```bash
npm i pdfjs-dist@4 && npm i -D tsx
npx tsx scripts/probe-plan.mts /path/to/plan.pdf
```

Writes `candidates.json` and prints a per-symbol tally vs. the hand-entered BOQ.

## Using it in Next.js (browser)

```ts
import * as pdfjs from "pdfjs-dist";
pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/<version>/pdf.worker.min.mjs"; // or bundle it

const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
const page = await pdf.getPage(1);
const viewport = page.getViewport({ scale: 1 });
const pv = extractVectors(await page.getOperatorList(), pdfjs.OPS, viewport);

const rows = segmentLegend(pv, { legendRect });          // legendRect: operator draws it once
const symbols = rows.map((r, i) => ({ id, rowIndex: i, labelHe, signature: buildSignature(r.glyphPaths, r.glyphBBox) }));
const candidates = detectPlacements(pv, symbols, { excludeRects });
// -> hand off to the authoring UI for confirm / relabel / nudge / add / delete
```

Gate authoring to desktop: the operator-list walk needs a few hundred MB and
1–3 s on a large CAD sheet.

## Known gaps / next

1. **Classification** is the weak link. The vector signature can't reliably tell a
   "P-in-circle" from a "dot" from a "square-with-X" at 5–20 px. Recommended fix:
   render each legend glyph to a 32×32 alpha bitmap, render the plan once at ~4×,
   and score candidates by normalised cross-correlation against the 18 templates.
   ~100 lines, expected to lift classification to ~85 %+.
2. `legend.ts` mis-sizes ~4 rows whose defining feature is text inside the glyph
   (`OUT` / `IN` ellipses) — those signatures are poor, so nothing matches them.
3. `render.ts` (PDF → DZI tile pyramid via chunked canvas) is not written yet.
4. Legend rectangle and `excludeRects` are per-sheet; the authoring UI should let
   the operator draw them once.
