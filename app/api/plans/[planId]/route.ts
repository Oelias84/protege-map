import { badRequest, handler, noContent, notFound, ok, readJson } from "@/lib/api";
import { deletePlan, getPlanBundle, setPlanStatus } from "@/lib/db";
import { PLAN_STATUSES, type PlanStatus } from "@/lib/domain";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ planId: string }> };

/** GET /api/plans/:id — full bundle (plan + symbols + placements) */
export const GET = handler(async (_req, { params }: Ctx) => {
  const { planId } = await params;
  const bundle = await getPlanBundle(planId);
  return bundle ? ok(bundle) : notFound("plan not found");
});

/** PATCH /api/plans/:id — { status } */
export const PATCH = handler(async (req, { params }: Ctx) => {
  const { planId } = await params;
  const body = await readJson<{ status?: PlanStatus }>(req);
  if (!body.status || !(PLAN_STATUSES as readonly string[]).includes(body.status)) {
    return badRequest(`status must be one of ${PLAN_STATUSES.join(", ")}`);
  }
  const plan = await setPlanStatus(planId, body.status);
  return plan ? ok(plan) : notFound("plan not found");
});

/** DELETE /api/plans/:id */
export const DELETE = handler(async (_req, { params }: Ctx) => {
  const { planId } = await params;
  await deletePlan(planId);
  return noContent();
});
