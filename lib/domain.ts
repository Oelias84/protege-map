/**
 * Shared domain constants + row shapes for the API and UI.
 * The pipeline (lib/pipeline) stays framework-free; this is the persisted model.
 */

export const PLACEMENT_STATUSES = ["planned", "installed", "issue"] as const;
export type PlacementStatus = (typeof PLACEMENT_STATUSES)[number];
export const DEFAULT_PLACEMENT_STATUS: PlacementStatus = "planned";

export const PLAN_STATUSES = ["draft", "published"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** how a placement got onto the plan */
export const PLACEMENT_SOURCES = ["auto", "manual"] as const;
export type PlacementSource = (typeof PLACEMENT_SOURCES)[number];

/** the fixed field set every button carries (v1) */
export interface PlacementFields {
  label: string;
  status: PlacementStatus;
  note: string;
}

export const emptyFields = (label = ""): PlacementFields => ({
  label,
  status: DEFAULT_PLACEMENT_STATUS,
  note: "",
});

/* ------------------------------- rows ------------------------------- */

export interface PlanRow {
  id: string;
  name: string;
  sourcePdfPath: string;
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  renderDpi: number;
  /** legend frame in device space, as drawn by the operator */
  legendRect: { x0: number; y0: number; x1: number; y1: number } | null;
  status: PlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SymbolRow {
  id: string;
  planId: string;
  slug: string;
  labelHe: string;
  glyphPath: string | null;
  rowIndex: number;
  expectedCount: number | null;
}

export interface PlacementRow {
  id: string;
  planId: string;
  symbolId: string;
  x: number; // normalised 0..1
  y: number; // normalised 0..1
  fields: PlacementFields;
  source: PlacementSource;
  confidence: number | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlanBundle {
  plan: PlanRow;
  symbols: SymbolRow[];
  placements: PlacementRow[];
}

/* ------------------------------ helpers ------------------------------ */

export const isPlacementStatus = (v: unknown): v is PlacementStatus =>
  typeof v === "string" && (PLACEMENT_STATUSES as readonly string[]).includes(v);

/** coerce arbitrary JSON into a valid PlacementFields (used on write) */
export function normaliseFields(input: unknown, fallbackLabel = ""): PlacementFields {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    label: typeof o.label === "string" ? o.label : fallbackLabel,
    status: isPlacementStatus(o.status) ? o.status : DEFAULT_PLACEMENT_STATUS,
    note: typeof o.note === "string" ? o.note : "",
  };
}
