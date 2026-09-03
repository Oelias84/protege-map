/**
 * Browser-side API client. Server code should import from lib/db directly.
 */

import type {
  PlacementFields,
  PlacementRow,
  PlanBundle,
  PlanRow,
  PlanStatus,
} from "./domain";
import type { PlanDraft } from "./pipeline/ingest";
import { tileKey } from "./pipeline/render";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------ reads ------------------------------ */

export const listPlans = () => fetch("/api/plans").then(json<PlanRow[]>);
export const getBundle = (planId: string) =>
  fetch(`/api/plans/${planId}`).then(json<PlanBundle>);

/** URL for a stored asset (DZI descriptor, tile, glyph crop) */
export const assetUrl = (planId: string, rel: string) =>
  `/api/plans/${planId}/assets/${rel}`;

/* ---------------------------- placements --------------------------- */

export const createPlacement = (
  planId: string,
  body: { symbolId: string; x: number; y: number; fields?: Partial<PlacementFields> },
) =>
  fetch(`/api/plans/${planId}/placements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(json<PlacementRow>);

export const updatePlacement = (
  id: string,
  patch: { x?: number; y?: number; symbolId?: string; fields?: Partial<PlacementFields>; updatedBy?: string },
) =>
  fetch(`/api/placements/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }).then(json<PlacementRow>);

export const deletePlacement = (id: string) =>
  fetch(`/api/placements/${id}`, { method: "DELETE" }).then((r) => {
    if (!r.ok && r.status !== 204) throw new Error(`delete failed: ${r.status}`);
  });

export const setPlanStatus = (planId: string, status: PlanStatus) =>
  fetch(`/api/plans/${planId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  }).then(json<PlanRow>);

/* --------------------------- ingestion --------------------------- */

const putAsset = (planId: string, rel: string, body: Blob | string) =>
  fetch(`/api/plans/${planId}/upload/${rel}`, { method: "PUT", body }).then((r) => {
    if (!r.ok) throw new Error(`upload ${rel} failed: ${r.status}`);
  });

/**
 * Persist a finished in-browser ingestion: create the plan row + symbols +
 * auto-detected placements, then push all binary assets.
 */
export async function uploadPlan(
  draft: PlanDraft,
  { onProgress }: { onProgress?: (done: number, total: number) => void } = {},
): Promise<PlanBundle> {
  const base = `plans/${draft.id}`;
  const labelBySlug = new Map(draft.symbols.map((s) => [s.slug, s.labelHe]));

  const bundle = await fetch("/api/plans", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      plan: {
        id: draft.id,
        name: draft.name,
        sourcePdfPath: `${base}/source.pdf`,
        imagePath: `${base}/plan.dzi`,
        imageWidth: draft.width,
        imageHeight: draft.height,
        renderDpi: draft.renderDpi,
        legendRect: draft.legendRect,
      },
      symbols: draft.symbols.map((s) => ({
        slug: s.slug,
        labelHe: s.labelHe,
        glyphPath: s.glyph ? `${base}/glyphs/${s.rowIndex}.png` : null,
        rowIndex: s.rowIndex,
        expectedCount: s.expectedCount,
      })),
      placements: draft.candidates.map((c) => ({
        symbolSlug: c.symbolId,
        x: c.x,
        y: c.y,
        source: "auto" as const,
        confidence: c.confidence,
        fields: { label: labelBySlug.get(c.symbolId) ?? "" },
      })),
    }),
  }).then(json<PlanBundle>);

  const uploads: Array<[string, Blob | string]> = [
    [`${base}/source.pdf`, draft.pdf],
    [`${base}/plan.dzi`, draft.dziDescriptor],
    ...draft.symbols.flatMap((s): Array<[string, Blob]> =>
      s.glyph ? [[`${base}/glyphs/${s.rowIndex}.png`, s.glyph]] : [],
    ),
    ...draft.tiles.map(
      (t): [string, Blob] => [`${base}/${tileKey(t.level, t.col, t.row)}`, t.blob],
    ),
  ];

  let done = 0;
  const CONCURRENCY = 6;
  const queue = [...uploads];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) return;
        await putAsset(draft.id, next[0].replace(`plans/${draft.id}/`, ""), next[1]);
        onProgress?.(++done, uploads.length);
      }
    }),
  );

  return bundle;
}
