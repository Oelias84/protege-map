import { handler, notFound } from "@/lib/api";
import { contentTypeFor, readPlanAsset } from "@/lib/storage";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ planId: string; path: string[] }> };

/** GET /api/plans/:id/assets/<rendered.webp | tiles/0/0_0.png | glyphs/3.png> */
export const GET = handler(async (_req, { params }: Ctx) => {
  const { planId, path } = await params;
  const rel = path.join("/");
  try {
    const bytes = await readPlanAsset(planId, rel);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentTypeFor(rel),
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return notFound("asset not found");
  }
});
