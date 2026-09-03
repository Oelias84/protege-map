import { asUnitInterval, badRequest, handler, noContent, notFound, ok, readJson } from "@/lib/api";
import { deletePlacement, updatePlacement, type PlacementPatch } from "@/lib/db";
import type { PlacementFields } from "@/lib/domain";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ placementId: string }> };

interface PatchBody {
  x?: number;
  y?: number;
  symbolId?: string;
  fields?: Partial<PlacementFields>;
  updatedBy?: string;
}

/** PATCH /api/placements/:id — move, relabel, or reclassify one button */
export const PATCH = handler(async (req, { params }: Ctx) => {
  const { placementId } = await params;
  const body = await readJson<PatchBody>(req);

  const patch: PlacementPatch = {};
  if (body.x !== undefined) {
    const x = asUnitInterval(body.x);
    if (x === undefined) return badRequest("x must be 0..1");
    patch.x = x;
  }
  if (body.y !== undefined) {
    const y = asUnitInterval(body.y);
    if (y === undefined) return badRequest("y must be 0..1");
    patch.y = y;
  }
  if (body.symbolId !== undefined) patch.symbolId = body.symbolId;
  if (body.fields !== undefined) patch.fields = body.fields;
  if (body.updatedBy !== undefined) patch.updatedBy = body.updatedBy;

  const row = await updatePlacement(placementId, patch);
  return row ? ok(row) : notFound("placement not found");
});

/** DELETE /api/placements/:id */
export const DELETE = handler(async (_req, { params }: Ctx) => {
  const { placementId } = await params;
  await deletePlacement(placementId);
  return noContent();
});
