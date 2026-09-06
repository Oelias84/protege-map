"use client";

import { memo, useRef, useState } from "react";
import { assetUrl } from "@/lib/client";
import type { PlacementRow, PlacementStatus, SymbolRow } from "@/lib/domain";

const STATUS_COLOR: Record<PlacementStatus, string> = {
  planned: "var(--blueprint)",
  installed: "var(--stamp)",
  issue: "var(--redline)",
};

export interface PlacementButtonProps {
  planId: string;
  placement: PlacementRow;
  symbol?: SymbolRow;
  screen: { left: number; top: number };
  draggable: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (clientX: number, clientY: number) => void;
}

/**
 * A single map button. Tap = select (opens the field editor in the parent).
 * In author mode it can be dragged; the drag is local until pointerup, then the
 * final client coords go up to PlanCanvas to convert back to normalised space.
 */
function PlacementButtonImpl({
  planId,
  placement,
  symbol,
  screen,
  draggable,
  selected,
  onSelect,
  onDragEnd,
}: PlacementButtonProps) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const label = placement.fields.label || symbol?.labelHe || "";
  const color = STATUS_COLOR[placement.fields.status] ?? STATUS_COLOR.planned;
  const glyphSrc = symbol?.glyphPath ? assetUrl(planId, `glyphs/${symbol.rowIndex}.png`) : null;
  const left = screen.left + (drag?.dx ?? 0);
  const top = screen.top + (drag?.dy ?? 0);

  return (
    <button
      type="button"
      className={`pin${glyphSrc ? " pin--glyph" : ""}${selected ? " pin--selected" : ""}`}
      style={{ left, top, ["--pin-color" as string]: color }}
      title={label}
      aria-label={label || symbol?.labelHe || "device marker"}
      aria-pressed={selected}
      dir="rtl"
      onPointerDown={(e) => {
        if (!draggable) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        moved.current = false;
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        const dy = e.clientY - start.current.y;
        if (Math.hypot(dx, dy) > 3) moved.current = true;
        setDrag({ dx, dy });
      }}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        setDrag(null);
        if (s && moved.current) onDragEnd(e.clientX, e.clientY);
        else onSelect();
      }}
      onClick={(e) => e.preventDefault()}
    >
      {glyphSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="pin__glyph" src={glyphSrc} alt="" draggable={false} />
      ) : (
        <span className="pin__dot" />
      )}
      {label && (
        <span className="pin__label" aria-hidden>
          {label}
        </span>
      )}
    </button>
  );
}

export const PlacementButton = memo(PlacementButtonImpl);
