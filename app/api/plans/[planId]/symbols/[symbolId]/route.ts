import { handler, notFound, ok, readJson } from "@/lib/api";
import { updateSymbol } from "@/lib/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ planId: string; symbolId: string }> };

/** PATCH /api/plans/:planId/symbols/:symbolId — rename / set expected count */
export const PATCH = handler(async (req, { params }: Ctx) => {
  const { symbolId } = await params;
  const body = await readJson<{ labelHe?: string; expectedCount?: number | null }>(req);
  const row = await updateSymbol(symbolId, {
    labelHe: typeof body.labelHe === "string" ? body.labelHe : undefined,
    expectedCount:
      body.expectedCount === null || typeof body.expectedCount === "number"
        ? body.expectedCount
        : undefined,
  });
  return row ? ok(row) : notFound("symbol not found");
});
