"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPdfjs } from "@/lib/pdf";
import { ingestPdf, type SymbolMeta } from "@/lib/pipeline/ingest";
import { uploadPlan } from "@/lib/client";
import type { BBox } from "@/lib/pipeline/types";

type Phase = "pick" | "legend" | "working";

const PREVIEW_SCALE = 0.5; // preview px per PDF point

export default function UploadPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [box, setBox] = useState<BBox | null>(null);
  const [meta, setMeta] = useState("");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const onPick = useCallback(async (f: File) => {
    setError("");
    setFile(f);
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: PREVIEW_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    setPreviewUrl(canvas.toDataURL("image/png"));
    setPhase("legend");
  }, []);

  const toDevice = (px: number, py: number): [number, number] => [
    px / PREVIEW_SCALE,
    py / PREVIEW_SCALE,
  ];

  function onDown(e: React.PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragRef.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    setBox(null);
  }
  function onMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const [x0, y0] = toDevice(Math.min(dragRef.current.x, x), Math.min(dragRef.current.y, y));
    const [x1, y1] = toDevice(Math.max(dragRef.current.x, x), Math.max(dragRef.current.y, y));
    setBox({ x0, y0, x1, y1 });
  }
  const onUp = () => {
    dragRef.current = null;
  };

  /** parse the optional label textarea; empty -> undefined (fully automatic) */
  function parseMeta(): SymbolMeta[] | undefined {
    const lines = meta
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return undefined;
    return lines.map((l, i) => {
      const [slug, label, count] = l.split("|").map((s) => s.trim());
      return {
        slug: slug || `symbol-${i + 1}`,
        labelHe: label || slug || `symbol-${i + 1}`,
        expectedCount: count ? Number(count) : null,
      };
    });
  }

  async function run() {
    if (!file || !box) return;
    setPhase("working");
    setError("");
    setProgress(0);
    try {
      const pdfjs = await loadPdfjs();
      const draft = await ingestPdf(file, pdfjs, {
        legendRect: box,
        symbolMeta: parseMeta(), // undefined => a symbol per legend row, auto
        excludeRects: [box],
      });
      const bundle = await uploadPlan(draft, {
        onProgress: (d, t) => setProgress(Math.round((d / t) * 100)),
      });
      router.push(`/authoring/${bundle.plan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("legend");
    }
  }

  return (
    <main className="page">
      <h1>Upload plan</h1>

      {phase === "pick" && (
        <label className="drop">
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
          />
          <div>Drop a vector building-plan PDF here, or click to choose</div>
          <div style={{ color: "var(--muted)", marginTop: 8 }}>
            Runs entirely in your browser. Desktop recommended.
          </div>
        </label>
      )}

      {phase === "legend" && previewUrl && (
        <>
          <p>
            Drag a box around the <strong>מקרא</strong> legend. Every row becomes a button
            automatically.
          </p>
          <div
            style={{
              position: "relative",
              display: "inline-block",
              cursor: "crosshair",
              userSelect: "none",
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="plan preview" style={{ display: "block", maxWidth: "100%" }} />
            {box && (
              <div
                style={{
                  position: "absolute",
                  left: box.x0 * PREVIEW_SCALE,
                  top: box.y0 * PREVIEW_SCALE,
                  width: (box.x1 - box.x0) * PREVIEW_SCALE,
                  height: (box.y1 - box.y0) * PREVIEW_SCALE,
                  border: "2px solid var(--accent)",
                  background: "rgba(37,99,235,0.12)",
                }}
              />
            )}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--muted)" }}>
              Add labels &amp; BOQ counts (optional)
            </summary>
            <p style={{ color: "var(--muted)", marginBottom: 4 }}>
              One legend row per line, top-to-bottom: <code>slug | Hebrew label | count</code>.
              Leave blank to auto-name every row.
            </p>
            <textarea
              value={meta}
              onChange={(e) => setMeta(e.target.value)}
              rows={8}
              style={{ width: "100%", font: "13px ui-monospace, monospace" }}
              placeholder={"smoke-detector | גלאי עשן | 54\nstrobe | נצנץ | 7"}
            />
          </details>

          {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setPhase("pick")}>
              Back
            </button>
            <button className="btn btn--primary" disabled={!box} onClick={run}>
              Ingest &amp; create buttons
            </button>
          </div>
        </>
      )}

      {phase === "working" && (
        <>
          <p>Reading the legend, rendering tiles, detecting symbols, uploading…</p>
          <div className="progress">
            <span style={{ width: `${progress}%` }} />
          </div>
        </>
      )}
    </main>
  );
}
