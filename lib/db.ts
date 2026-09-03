/**
 * Thin Postgres data layer. One pool per process; typed helpers return the
 * row shapes from lib/domain.ts. No ORM.
 *
 *   npm i pg
 *   DATABASE_URL=postgres://user:pass@host:5432/db
 */

import { Pool, type PoolClient } from "pg";
import {
  normaliseFields,
  type PlacementFields,
  type PlacementRow,
  type PlacementSource,
  type PlanBundle,
  type PlanRow,
  type PlanStatus,
  type SymbolRow,
} from "./domain";

let pool: Pool | undefined;
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

const q = <T>(text: string, params?: unknown[]) =>
  getPool().query<T extends object ? T : never>(text, params as any[]);

/* ------------------------------ mappers ------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
const toPlan = (r: any): PlanRow => ({
  id: r.id,
  name: r.name,
  sourcePdfPath: r.source_pdf_path,
  imagePath: r.image_path,
  imageWidth: r.image_width,
  imageHeight: r.image_height,
  renderDpi: r.render_dpi,
  legendRect: r.legend_rect ?? null,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const toSymbol = (r: any): SymbolRow => ({
  id: r.id,
  planId: r.plan_id,
  slug: r.slug,
  labelHe: r.label_he,
  glyphPath: r.glyph_path ?? null,
  rowIndex: r.row_index,
  expectedCount: r.expected_count ?? null,
});

const toPlacement = (r: any): PlacementRow => ({
  id: r.id,
  planId: r.plan_id,
  symbolId: r.symbol_id,
  x: r.x,
  y: r.y,
  fields: normaliseFields(r.fields),
  source: r.source,
  confidence: r.confidence ?? null,
  updatedBy: r.updated_by ?? null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------- plans ------------------------------ */

export async function listPlans(): Promise<PlanRow[]> {
  const { rows } = await q("select * from plan order by created_at desc");
  return rows.map(toPlan);
}

export async function getPlan(id: string): Promise<PlanRow | null> {
  const { rows } = await q("select * from plan where id = $1", [id]);
  return rows[0] ? toPlan(rows[0]) : null;
}

export interface NewPlan {
  /** optional client-generated UUID so asset paths are known before insert */
  id?: string;
  name: string;
  sourcePdfPath: string;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  renderDpi: number;
  legendRect?: { x0: number; y0: number; x1: number; y1: number } | null;
}

export interface NewSymbol {
  slug: string;
  labelHe: string;
  glyphPath?: string | null;
  rowIndex: number;
  expectedCount?: number | null;
}

export interface NewPlacement {
  symbolSlug: string;
  x: number;
  y: number;
  fields?: Partial<PlacementFields>;
  source?: PlacementSource;
  confidence?: number | null;
}

/** create a plan, its symbols, and any seed placements in one transaction */
export async function createPlan(
  input: NewPlan,
  symbols: NewSymbol[],
  placements: NewPlacement[] = [],
): Promise<PlanBundle> {
  const client = await getPool().connect();
  try {
    await client.query("begin");

    const planRes = await client.query(
      `insert into plan (id, name, source_pdf_path, image_path, image_width, image_height, render_dpi, legend_rect)
       values (coalesce($1, gen_random_uuid()), $2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        input.id ?? null,
        input.name,
        input.sourcePdfPath,
        input.imagePath,
        input.imageWidth,
        input.imageHeight,
        input.renderDpi,
        input.legendRect ? JSON.stringify(input.legendRect) : null,
      ],
    );
    const plan = toPlan(planRes.rows[0]);

    const symBySlug = new Map<string, SymbolRow>();
    for (const s of symbols) {
      const r = await client.query(
        `insert into symbol (plan_id, slug, label_he, glyph_path, row_index, expected_count)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [plan.id, s.slug, s.labelHe, s.glyphPath ?? null, s.rowIndex, s.expectedCount ?? null],
      );
      symBySlug.set(s.slug, toSymbol(r.rows[0]));
    }

    const insertedPlacements: PlacementRow[] = [];
    for (const p of placements) {
      const sym = symBySlug.get(p.symbolSlug);
      if (!sym) continue;
      const r = await client.query(
        `insert into placement (plan_id, symbol_id, x, y, fields, source, confidence)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          plan.id,
          sym.id,
          p.x,
          p.y,
          JSON.stringify(normaliseFields(p.fields, sym.labelHe)),
          p.source ?? "auto",
          p.confidence ?? null,
        ],
      );
      insertedPlacements.push(toPlacement(r.rows[0]));
    }

    await client.query("commit");
    return {
      plan,
      symbols: [...symBySlug.values()].sort((a, b) => a.rowIndex - b.rowIndex),
      placements: insertedPlacements,
    };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export async function setPlanStatus(id: string, status: PlanStatus): Promise<PlanRow | null> {
  const { rows } = await q("update plan set status = $2 where id = $1 returning *", [id, status]);
  return rows[0] ? toPlan(rows[0]) : null;
}

export async function deletePlan(id: string): Promise<void> {
  await q("delete from plan where id = $1", [id]);
}

/* ------------------------------ bundle ------------------------------ */

export async function getPlanBundle(id: string): Promise<PlanBundle | null> {
  const plan = await getPlan(id);
  if (!plan) return null;
  const [symbols, placements] = await Promise.all([getSymbols(id), getPlacements(id)]);
  return { plan, symbols, placements };
}

export async function getSymbols(planId: string): Promise<SymbolRow[]> {
  const { rows } = await q("select * from symbol where plan_id = $1 order by row_index", [planId]);
  return rows.map(toSymbol);
}

/* ---------------------------- placements --------------------------- */

export async function getPlacements(planId: string): Promise<PlacementRow[]> {
  const { rows } = await q("select * from placement where plan_id = $1 order by created_at", [
    planId,
  ]);
  return rows.map(toPlacement);
}

export async function createPlacement(
  planId: string,
  input: { symbolId: string; x: number; y: number; fields?: Partial<PlacementFields>; source?: PlacementSource },
): Promise<PlacementRow> {
  const { rows } = await q(
    `insert into placement (plan_id, symbol_id, x, y, fields, source)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [
      planId,
      input.symbolId,
      input.x,
      input.y,
      JSON.stringify(normaliseFields(input.fields)),
      input.source ?? "manual",
    ],
  );
  return toPlacement(rows[0]);
}

export interface PlacementPatch {
  x?: number;
  y?: number;
  symbolId?: string;
  fields?: Partial<PlacementFields>;
  updatedBy?: string;
}

export async function updatePlacement(
  id: string,
  patch: PlacementPatch,
): Promise<PlacementRow | null> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (frag: string, val: unknown) => {
    vals.push(val);
    sets.push(`${frag} = $${vals.length}`);
  };
  if (patch.x !== undefined) push("x", patch.x);
  if (patch.y !== undefined) push("y", patch.y);
  if (patch.symbolId !== undefined) push("symbol_id", patch.symbolId);
  if (patch.fields !== undefined) {
    // merge into existing jsonb so partial field updates work
    vals.push(JSON.stringify(patch.fields));
    sets.push(`fields = fields || $${vals.length}::jsonb`);
  }
  if (patch.updatedBy !== undefined) push("updated_by", patch.updatedBy);
  if (!sets.length) return getPlacementById(id);

  vals.push(id);
  const { rows } = await q(
    `update placement set ${sets.join(", ")} where id = $${vals.length} returning *`,
    vals,
  );
  return rows[0] ? toPlacement(rows[0]) : null;
}

export async function getPlacementById(id: string): Promise<PlacementRow | null> {
  const { rows } = await q("select * from placement where id = $1", [id]);
  return rows[0] ? toPlacement(rows[0]) : null;
}

export async function deletePlacement(id: string): Promise<void> {
  await q("delete from placement where id = $1", [id]);
}

export type { PoolClient };
