"use client";

import { useState } from "react";
import { updatePlacement } from "@/lib/client";
import type { PlacementFields, PlacementRow, PlanBundle } from "@/lib/domain";
import { PlanCanvas } from "./PlanCanvas";
import { LegendPanel } from "./LegendPanel";
import { FieldEditor } from "./FieldEditor";

/**
 * End-user view: pan/zoom the plan, tap a button to see / edit its data, drag to
 * relocate it. No placing or deleting.
 */
export function ViewerView({ bundle }: { bundle: PlanBundle }) {
  const { plan, symbols } = bundle;
  const [placements, setPlacements] = useState<PlacementRow[]>(bundle.placements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = placements.find((p) => p.id === selectedId) ?? null;

  const apply = (row: PlacementRow) =>
    setPlacements((ps) => ps.map((p) => (p.id === row.id ? row : p)));

  async function move(id: string, nx: number, ny: number) {
    setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, x: nx, y: ny } : p)));
    apply(await updatePlacement(id, { x: nx, y: ny }));
  }

  async function save(patch: { fields?: Partial<PlacementFields> }) {
    if (!selected) return;
    apply(await updatePlacement(selected.id, patch));
  }

  return (
    <div className="workspace">
      <div className="workspace__main">
        <div className="workspace__bar">
          <h1>{plan.name}</h1>
          <span className="workspace__spacer" />
          <span style={{ color: "var(--muted)" }}>{placements.length} points</span>
        </div>

        <PlanCanvas
          planId={plan.id}
          width={plan.imageWidth}
          height={plan.imageHeight}
          placements={placements}
          symbols={symbols}
          mode="view"
          onMovePlacement={move}
          onSelectPlacement={setSelectedId}
          selectedPlacementId={selectedId}
        />

        {selected && (
          <FieldEditor
            placement={selected}
            symbol={symbols.find((s) => s.id === selected.symbolId)}
            onSave={save}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      <LegendPanel planId={plan.id} symbols={symbols} placements={placements} />
    </div>
  );
}
