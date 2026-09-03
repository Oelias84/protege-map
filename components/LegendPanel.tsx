"use client";

import { useState } from "react";
import { assetUrl } from "@/lib/client";
import type { PlacementRow, SymbolRow } from "@/lib/domain";

export interface LegendPanelProps {
  planId: string;
  symbols: SymbolRow[];
  placements: PlacementRow[];
  /** author mode only */
  activeSymbolId?: string | null;
  onPickSymbol?: (symbolId: string | null) => void;
  onRenameSymbol?: (symbolId: string, labelHe: string) => void;
}

/**
 * The מקרא list — one row per legend symbol, auto-created at ingest. In author
 * mode a row is a toggle (pick it, then click the plan to drop that symbol) and
 * the label is editable in place. The count column is found / expected (BOQ).
 */
export function LegendPanel({
  planId,
  symbols,
  placements,
  activeSymbolId,
  onPickSymbol,
  onRenameSymbol,
}: LegendPanelProps) {
  const found = new Map<string, number>();
  for (const p of placements) found.set(p.symbolId, (found.get(p.symbolId) ?? 0) + 1);

  return (
    <aside id="legend" className="legend" dir="rtl" aria-label="מקרא — רשימת סימנים">
      <h2 className="legend__title">מקרא</h2>
      <ul className="legend__list">
        {symbols.map((s) => {
          const got = found.get(s.id) ?? 0;
          const exp = s.expectedCount ?? null;
          const off = exp !== null && got !== exp;
          const active = s.id === activeSymbolId;
          return (
            <li key={s.id} className={`legend__row${active ? " legend__row--active" : ""}`}>
              <button
                type="button"
                className="legend__pick"
                onClick={() => onPickSymbol?.(active ? null : s.id)}
                disabled={!onPickSymbol}
                aria-pressed={active}
                aria-label={`${active ? "בטל בחירת" : "בחר"} ${s.labelHe || `סימן ${s.rowIndex + 1}`} למיקום על התכנית`}
              >
                <span className="legend__glyph">
                  {s.glyphPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(planId, `glyphs/${s.rowIndex}.png`)} alt="" />
                  ) : (
                    <span className="legend__glyph--none" />
                  )}
                </span>
              </button>

              {onRenameSymbol ? (
                <LabelInput
                  value={s.labelHe}
                  placeholder={`סימן ${s.rowIndex + 1}`}
                  onCommit={(v) => v !== s.labelHe && onRenameSymbol(s.id, v)}
                />
              ) : (
                <span className="legend__label">{s.labelHe || `סימן ${s.rowIndex + 1}`}</span>
              )}

              <span className={`legend__count${off ? " legend__count--off" : ""}`}>
                {got}
                {exp !== null && <span className="legend__count-exp"> / {exp}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function LabelInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string;
  placeholder: string;
  onCommit: (v: string) => void;
}) {
  const [v, setV] = useState(value);
  return (
    <input
      className="legend__label-input"
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
