"use client";

import { useState } from "react";
import Link from "next/link";
import {
  createPlacement,
  deletePlacement,
  setPlanStatus,
  updatePlacement,
  updateSymbol,
} from "@/lib/client";
import type { PlacementFields, PlacementRow, PlanBundle, SymbolRow } from "@/lib/domain";
import { PlanCanvas } from "./PlanCanvas";
import { LegendPanel } from "./LegendPanel";
import { FieldEditor } from "./FieldEditor";

export function AuthoringView({ bundle }: { bundle: PlanBundle }) {
  const { plan } = bundle;
  const [symbols, setSymbols] = useState<SymbolRow[]>(bundle.symbols);
  const [placements, setPlacements] = useState<PlacementRow[]>(bundle.placements);
  const [activeSymbolId, setActiveSymbolId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState(plan.status);
  const [busy, setBusy] = useState(false);

  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const patchLocal = (row: PlacementRow) =>
    setPlacements((ps) => ps.map((p) => (p.id === row.id ? row : p)));

  async function addAt(nx: number, ny: number) {
    if (!activeSymbolId) return;
    const sym = symbols.find((s) => s.id === activeSymbolId);
    const row = await createPlacement(plan.id, {
      symbolId: activeSymbolId,
      x: nx,
      y: ny,
      fields: { label: sym?.labelHe ?? "" },
    });
    setPlacements((ps) => [...ps, row]);
    setSelectedId(row.id);
  }

  async function move(id: string, nx: number, ny: number) {
    setPlacements((ps) => ps.map((p) => (p.id === id ? { ...p, x: nx, y: ny } : p)));
    const row = await updatePlacement(id, { x: nx, y: ny });
    patchLocal(row);
  }

  async function save(patch: { fields?: Partial<PlacementFields>; symbolId?: string }) {
    if (!selected) return;
    const row = await updatePlacement(selected.id, patch);
    patchLocal(row);
  }

  async function remove() {
    if (!selected) return;
    await deletePlacement(selected.id);
    setPlacements((ps) => ps.filter((p) => p.id !== selected.id));
    setSelectedId(null);
  }

  async function renameSymbol(symbolId: string, labelHe: string) {
    setSymbols((ss) => ss.map((s) => (s.id === symbolId ? { ...s, labelHe } : s)));
    const row = await updateSymbol(plan.id, symbolId, { labelHe });
    setSymbols((ss) => ss.map((s) => (s.id === row.id ? row : s)));
  }

  async function togglePublish() {
    setBusy(true);
    try {
      const next = status === "published" ? "draft" : "published";
      const updated = await setPlanStatus(plan.id, next);
      setStatus(updated.status);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace">
      <div className="workspace__main">
        <div className="workspace__bar">
          <h1>{plan.name}</h1>
          <span style={{ color: "var(--muted)" }}>
            {placements.length} buttons · {status}
          </span>
          <span className="workspace__spacer" />
          {activeSymbolId && (
            <span style={{ color: "var(--accent)" }}>
              click the plan to place ·{" "}
              <button className="btn" onClick={() => setActiveSymbolId(null)}>
                done
              </button>
            </span>
          )}
          <button className="btn" onClick={togglePublish} disabled={busy}>
            {status === "published" ? "Unpublish" : "Publish"}
          </button>
          <Link className="btn" href={`/view/${plan.id}`}>
            View
          </Link>
        </div>

        <div className="workspace__stage">
          <PlanCanvas
            planId={plan.id}
            width={plan.imageWidth}
            height={plan.imageHeight}
            placements={placements}
            symbols={symbols}
            mode="author"
            activeSymbolId={activeSymbolId}
            onAddAt={addAt}
            onMovePlacement={move}
            onSelectPlacement={setSelectedId}
            selectedPlacementId={selectedId}
          />

          {selected && (
            <FieldEditor
              placement={selected}
              symbol={symbols.find((s) => s.id === selected.symbolId)}
              symbols={symbols}
              onSave={save}
              onDelete={remove}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>

      <LegendPanel
        planId={plan.id}
        symbols={symbols}
        placements={placements}
        activeSymbolId={activeSymbolId}
        onPickSymbol={setActiveSymbolId}
        onRenameSymbol={renameSymbol}
      />
    </div>
  );
}
