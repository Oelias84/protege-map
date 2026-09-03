import { created, handler, ok, readJson } from "@/lib/api";
import { createPlan, listPlans, type NewPlacement, type NewPlan, type NewSymbol } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/plans — list */
export const GET = handler(async () => ok(await listPlans()));

interface CreateBody {
  plan: NewPlan;
  symbols: NewSymbol[];
  placements?: NewPlacement[];
}

/**
 * POST /api/plans — persist a finished ingestion.
 * The browser pipeline produces { plan, symbols, placements }; this stores it.
 */
export const POST = handler(async (req) => {
  const body = await readJson<CreateBody>(req);
  if (!body?.plan || !Array.isArray(body.symbols)) {
    return ok({ error: "expected { plan, symbols, placements? }" }, { status: 400 });
  }
  const bundle = await createPlan(body.plan, body.symbols, body.placements ?? []);
  return created(bundle);
});
