/**
 * Scan the plan body for symbol instances and label each against the legend.
 *
 * Pipeline: colour + size gate -> cluster coincident seeds into blobs -> pull in
 * strictly-contained neutral detail -> classify.
 *
 * Classification uses raster template matching (raster.ts) when `templates` are
 * supplied; otherwise it falls back to the coarse vector signature. Output is a
 * *candidate* list for the human authoring pass — the BOQ tally shows the gap.
 */

import { buildSignature, distanceToConfidence, signatureDistance } from "./signature";
import { ncc, rasterizeGlyph, rot90, type Template } from "./raster";
import {
  bboxCenter,
  bboxContainsPoint,
  bboxUnion,
  type BBox,
  type PageVectors,
  type PlacementCandidate,
  type SymbolDef,
  type VectorPath,
} from "./types";

export interface DetectOptions {
  /** regions to exclude from the scan (legend, BOQ, notes, title block, frame margins) */
  excludeRects: BBox[];
  /** rasterised legend glyphs; when present, used as the primary classifier */
  templates?: Template[];
  /** two seeds are the same instance when their centres are within this (device px) */
  mergeDist?: number;
  /** min confidence to keep a candidate */
  minConfidence?: number;
  /** clamp blob size (device px) — anything bigger is drawing, not a glyph */
  maxGlyph?: number;
  /** min seed size (device px) — smaller paths are tick marks / wiring fragments */
  minSeed?: number;
}

const isNeutral = (c: [number, number, number] | null) => {
  if (!c) return true;
  const [r, g, b] = c;
  return Math.abs(r - g) < 16 && Math.abs(g - b) < 16;
};

const quant = (c: [number, number, number] | null): string => {
  if (!c) return "none";
  const q = (v: number) => Math.round(v / 32) * 32;
  return `${q(c[0])},${q(c[1])},${q(c[2])}`;
};

/** map an NCC score into a 0..1 confidence */
const nccConfidence = (s: number) => Math.max(0, Math.min(1, (s - 0.32) / (0.85 - 0.32)));

export function detectPlacements(
  page: PageVectors,
  symbols: SymbolDef[],
  opts: DetectOptions,
): PlacementCandidate[] {
  const {
    excludeRects,
    templates,
    mergeDist = 5,
    minConfidence = 0.16,
    maxGlyph = 30,
    minSeed = 3,
  } = opts;

  const symById = new Map(symbols.map((s) => [s.id, s]));
  const colorKeysOf = (s: SymbolDef) =>
    new Set(
      Object.keys(s.signature.colors).filter(
        (k) => k !== "none" && !isNeutral(k.split(",").map(Number) as any),
      ),
    );

  // colours that appear in some legend glyph — everything else (red loop wiring,
  // green highlights, …) is not a device marker
  const allowed = new Set<string>();
  for (const s of symbols) for (const k of colorKeysOf(s)) allowed.add(k);

  // 1. seeds: legend-coloured, glyph-sized, outside excluded regions
  const seeds = page.paths.filter((p) => {
    const w = p.bbox.x1 - p.bbox.x0;
    const h = p.bbox.y1 - p.bbox.y0;
    if (w < minSeed || h < minSeed || w > maxGlyph || h > maxGlyph) return false;
    const c = p.fill ?? p.stroke ?? null;
    if (isNeutral(c) || !allowed.has(quant(c))) return false;
    const [cx, cy] = bboxCenter(p.bbox);
    return !excludeRects.some((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1);
  });

  // 2. union-find on coincident centres (grid-bucketed neighbour search)
  const parent = seeds.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const centers = seeds.map((p) => bboxCenter(p.bbox));
  const cell = Math.max(1, mergeDist);
  const bucket = new Map<string, number[]>();
  centers.forEach(([x, y], i) => {
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    (bucket.get(key) ?? bucket.set(key, []).get(key)!).push(i);
  });
  centers.forEach(([x, y], i) => {
    const bx = Math.floor(x / cell);
    const by = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of bucket.get(`${bx + dx},${by + dy}`) ?? []) {
          if (j <= i) continue;
          if (Math.hypot(x - centers[j][0], y - centers[j][1]) <= mergeDist) {
            parent[find(i)] = find(j);
          }
        }
  });
  const blobs = new Map<number, VectorPath[]>();
  seeds.forEach((p, i) => {
    const r = find(i);
    (blobs.get(r) ?? blobs.set(r, []).get(r)!).push(p);
  });

  // neutral detail that may sit inside a glyph (rings, "P"/"N"/"M")
  const neutralSmall = page.paths.filter((p) => {
    if (!isNeutral(p.fill ?? p.stroke ?? null)) return false;
    const w = p.bbox.x1 - p.bbox.x0;
    const h = p.bbox.y1 - p.bbox.y0;
    return w > 0.3 && h > 0.3 && w < maxGlyph && h < maxGlyph;
  });

  // 3. classify each blob
  const out: PlacementCandidate[] = [];
  for (const group of blobs.values()) {
    const colBox = group.map((p) => p.bbox).reduce(bboxUnion);
    if (Math.max(colBox.x1 - colBox.x0, colBox.y1 - colBox.y0) > maxGlyph) continue;

    const contained = neutralSmall.filter((p) => {
      const [cx, cy] = bboxCenter(p.bbox);
      return bboxContainsPoint(colBox, cx, cy, 2);
    });
    const parts = [...group, ...contained.slice(0, 24)];
    const box = parts.map((p) => p.bbox).reduce(bboxUnion);
    if (Math.max(box.x1 - box.x0, box.y1 - box.y0) > maxGlyph * 1.4) continue;

    const blobColors = new Set(
      group.map((p) => quant(p.fill ?? p.stroke ?? null)).filter((k) => k !== "none"),
    );

    let symbolId: string;
    let confidence: number;

    if (templates && templates.length) {
      // rank every template by rotation-tolerant NCC, then take the best whose
      // symbol shares a colour with the blob (keeps magenta/blue variants apart)
      const cand = rasterizeGlyph(parts, box);
      const scored = templates
        .map((t) => {
          let s = -Infinity;
          for (const k of [0, 1, 2, 3]) {
            const r = k === 0 ? cand.data : rot90(cand.data, cand.size, k);
            s = Math.max(s, ncc(r, t.raster.data));
          }
          return { id: t.symbolId, s };
        })
        .sort((a, b) => b.s - a.s);

      let pick = scored[0];
      for (const cs of scored) {
        const sym = symById.get(cs.id);
        if (sym && [...colorKeysOf(sym)].some((k) => blobColors.has(k))) {
          pick = cs;
          break;
        }
      }
      symbolId = pick.id;
      confidence = Number(nccConfidence(pick.s).toFixed(3));
    } else {
      const sig = buildSignature(parts, box);
      let bestD = Infinity;
      symbolId = symbols[0]?.id ?? "";
      for (const s of symbols) {
        const d = signatureDistance(sig, s.signature);
        if (d < bestD) {
          bestD = d;
          symbolId = s.id;
        }
      }
      confidence = Number(distanceToConfidence(bestD).toFixed(3));
    }

    if (confidence < minConfidence) continue;
    const [cx, cy] = bboxCenter(box);
    out.push({ symbolId, x: cx / page.width, y: cy / page.height, confidence, bbox: box });
  }

  // 4. de-dupe: one candidate per location, keep the most confident
  out.sort((a, b) => b.confidence - a.confidence);
  const kept: PlacementCandidate[] = [];
  for (const c of out) {
    const dup = kept.some(
      (k) => Math.hypot((k.x - c.x) * page.width, (k.y - c.y) * page.height) < mergeDist * 1.5,
    );
    if (!dup) kept.push(c);
  }
  return kept;
}

/** build raster templates from segmented legend rows */
export function buildTemplates(
  rows: { glyphPaths: VectorPath[]; glyphBBox: BBox }[],
  ids: string[],
  size = 32,
): Template[] {
  return rows
    .slice(0, ids.length)
    .map((r, i) => ({ symbolId: ids[i], raster: rasterizeGlyph(r.glyphPaths, r.glyphBBox, size) }));
}

/** counts per symbol, for cross-checking against the BOQ */
export function tallyBySymbol(candidates: PlacementCandidate[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const c of candidates) t[c.symbolId] = (t[c.symbolId] ?? 0) + 1;
  return t;
}
