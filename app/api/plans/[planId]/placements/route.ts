import { asUnitInterval, badRequest, created, handler, ok, readJson } from "@/lib/api";
import { createPlacement, getPlacements } from "@/lib/db";
import type { PlacementFields } from "@/lib/domain";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ planId: string }> };

/** GET /api/plans/:id/placements */
export const GET = handler(async (_req, { params }: Ctx) => {
  const { planId } = await params;
  return ok(await getPlacements(planId));
});

interface CreateBody {
  symbolId: string;
  x: number;
  y: number;
  fields?: Partial<PlacementFields>;
}

/** POST /api/plans/:id/placements — add one button */
export const POST = handler(async (req, { params }: Ctx) => {
  const { planId } = await params;
  const body = await readJson<CreateBody>(req);
  const x = asUnitInterval(body.x);
  const y = asUnitInterval(body.y);
  if (!body.symbolId || x === undefined || y === undefined) {
    return badRequest("expected { symbolId, x:0..1, y:0..1, fields? }");
  }
  const row = await createPlacement(planId, {
    symbolId: body.symbolId,
    x,
    y,
    fields: body.fields,
    source: "manual",
  });
  return created(row);
});
