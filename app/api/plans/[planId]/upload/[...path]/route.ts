import { handler, ok } from "@/lib/api";
import { savePlanAsset } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ planId: string; path: string[] }> };

/**
 * PUT /api/plans/:id/upload/<rel>   (raw body = file bytes)
 * The browser ingestion flow pushes the DZI descriptor, tiles, glyph crops
 * and the original PDF here after the plan row exists.
 * Served back via GET /api/plans/:id/assets/<rel>.
 */
export const PUT = handler(async (req, { params }: Ctx) => {
  const { planId, path } = await params;
  const rel = path.join("/");
  const bytes = new Uint8Array(await req.arrayBuffer());
  const stored = await savePlanAsset(planId, rel, bytes);
  return ok({ path: stored, bytes: bytes.length });
});
