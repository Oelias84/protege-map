"use client";

import { assetUrl } from "@/lib/client";
import type { PlacementRow, SymbolRow } from "@/lib/domain";

export interface LegendPanelProps {
  planId: string;
  symbols: SymbolRow[];
  placements: PlacementRow[];
  /** author mode only */
  activeSymbolId?: string | null;
  onPickSymbol?: (symbolId: string | null) => void;
}

/**
 * The מקרא list. In author mode a row is a toggle: pick it, then click the plan
 * to drop that symbol. The count column is found / expected (BOQ) so the
 * operator can see which types still need placing.
 */
export function LegendPanel({
  planId,
  symbols,
  placements,
  activeSymbolId,
  onPickSymbol,
}: LegendPanelProps) {
  const found = new Map<string, number>();
  for (const p of placements) found.set(p.symbolId, (found.get(p.symbolId) ?? 0) + 1);

  return (
    <aside className="legend" dir="rtl">
      <h2 className="legend__title">מקרא</h2>
      <ul className="legend__list">
        {symbols.map((s) => {
          const got = found.get(s.id) ?? 0;
          const exp = s.expectedCount ?? null;
          const off = exp !== null && got !== exp;
          const active = s.id === activeSymbolId;
          return (
            <li key={s.id}>
              <button
                type="button"
                className={`legend__row${active ? " legend__row--active" : ""}`}
                onClick={() => onPickSymbol?.(active ? null : s.id)}
                disabled={!onPickSymbol}
              >
                <span className="legend__glyph">
                  {s.glyphPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(planId, `glyphs/${s.rowIndex}.png`)} alt="" />
                  ) : (
                    <span className="legend__glyph--none" />
                  )}
                </span>
                <span className="legend__label">{s.labelHe}</span>
                <span className={`legend__count${off ? " legend__count--off" : ""}`}>
                  {got}
                  {exp !== null && <span className="legend__count-exp"> / {exp}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
