"use client";

import { useEffect, useState } from "react";
import {
  PLACEMENT_STATUSES,
  emptyFields,
  type PlacementFields,
  type PlacementRow,
  type SymbolRow,
} from "@/lib/domain";

export interface FieldEditorProps {
  placement: PlacementRow;
  symbol?: SymbolRow;
  /** author mode can move a button to a different symbol type */
  symbols?: SymbolRow[];
  onSave: (patch: { fields?: Partial<PlacementFields>; symbolId?: string }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

/** Small form for a button's fixed fields: label / status / note. */
export function FieldEditor({
  placement,
  symbol,
  symbols,
  onSave,
  onDelete,
  onClose,
}: FieldEditorProps) {
  const [fields, setFields] = useState<PlacementFields>(
    placement.fields ?? emptyFields(symbol?.labelHe),
  );
  const [symbolId, setSymbolId] = useState(placement.symbolId);
  const dirty =
    JSON.stringify(fields) !== JSON.stringify(placement.fields) ||
    symbolId !== placement.symbolId;

  useEffect(() => {
    setFields(placement.fields ?? emptyFields(symbol?.labelHe));
    setSymbolId(placement.symbolId);
  }, [placement, symbol]);

  return (
    <div className="editor" dir="rtl" role="dialog" aria-label="עריכת סימן">
      <div className="editor__head">
        <strong>{symbol?.labelHe ?? "סימן"}</strong>
        <button type="button" className="editor__x" onClick={onClose} aria-label="סגור">
          ×
        </button>
      </div>

      <label className="editor__field">
        <span>תווית</span>
        <input
          value={fields.label}
          onChange={(e) => setFields({ ...fields, label: e.target.value })}
        />
      </label>

      <label className="editor__field">
        <span>סטטוס</span>
        <select
          value={fields.status}
          onChange={(e) =>
            setFields({ ...fields, status: e.target.value as PlacementFields["status"] })
          }
        >
          {PLACEMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_HE[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="editor__field">
        <span>הערה</span>
        <textarea
          rows={2}
          value={fields.note}
          onChange={(e) => setFields({ ...fields, note: e.target.value })}
        />
      </label>

      {symbols && symbols.length > 0 && (
        <label className="editor__field">
          <span>סוג</span>
          <select value={symbolId} onChange={(e) => setSymbolId(e.target.value)}>
            {symbols.map((s) => (
              <option key={s.id} value={s.id}>
                {s.labelHe}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="editor__actions">
        {onDelete && (
          <button type="button" className="editor__del" onClick={onDelete}>
            מחק
          </button>
        )}
        <span className="editor__spacer" />
        <button
          type="button"
          className="editor__save"
          disabled={!dirty}
          onClick={() =>
            onSave({
              fields,
              symbolId: symbolId !== placement.symbolId ? symbolId : undefined,
            })
          }
        >
          שמור
        </button>
      </div>
    </div>
  );
}

const STATUS_HE: Record<PlacementFields["status"], string> = {
  planned: "מתוכנן",
  installed: "מותקן",
  issue: "תקלה",
};
