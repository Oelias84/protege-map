/**
 * Local file storage for plan assets (original PDF, rendered raster / tiles,
 * glyph crops). Files live under STORAGE_DIR and are streamed back through
 * app/api/plans/[planId]/assets/[...path]/route.ts.
 *
 *   STORAGE_DIR=/var/lib/plan-builder   (defaults to <cwd>/storage)
 *
 * Swap this module for S3/GCS later without touching the API routes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join(process.cwd(), "storage");

const planDir = (planId: string) => path.join(ROOT, "plans", planId);

/** resolve a relative asset path, guarding against traversal outside the plan dir */
function resolveInPlan(planId: string, rel: string): string {
  const abs = path.resolve(planDir(planId), rel);
  const base = path.resolve(planDir(planId));
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error("path escapes plan directory");
  }
  return abs;
}

export async function savePlanAsset(
  planId: string,
  rel: string,
  data: Uint8Array | Buffer | string,
): Promise<string> {
  const abs = resolveInPlan(planId, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  // stored path is relative — the API route knows how to serve it
  return path.posix.join("plans", planId, rel.split(path.sep).join("/"));
}

export async function readPlanAsset(planId: string, rel: string): Promise<Buffer> {
  return readFile(resolveInPlan(planId, rel));
}

export const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".dzi": "application/xml",
};

export const contentTypeFor = (p: string) =>
  CONTENT_TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";
