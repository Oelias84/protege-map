"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { loadPdfjs } from "@/lib/pdf";
import { detectLegendRect, ingestPdf, type SymbolMeta } from "@/lib/pipeline/ingest";
import { uploadPlan } from "@/lib/client";
import type { BBox } from "@/lib/pipeline/types";

type Phase = "pick" | "legend" | "working";

const PREVIEW_SCALE = 0.5; // preview px per PDF point

export default function UploadPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  /** PDF page size in points — device space the pipeline works in */
  const [pageSize, setPageSize] = useState<{ w: number; h: number }>({ w: 1, h: 1 });
  /** legend box, stored as fractions of the page (0..1) so scaling never matters */
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [meta, setMeta] = useState("");
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [autoFound, setAutoFound] = useState<boolean | null>(null); // null=checking

  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const onPick = useCallback(async (f: File) => {
    setError("");
    setFile(f);
    setBox(null);
    setAutoFound(null);
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const w = page.getViewport({ scale: 1 }).width;
    const h = page.getViewport({ scale: 1 }).height;
    setPageSize({ w, h });
    const vp = page.getViewport({ scale: PREVIEW_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    setPreviewUrl(canvas.toDataURL("image/png"));
    setPhase("legend");

    // auto-locate the legend so the operator only has to confirm / nudge
    try {
      const guess = await detectLegendRect(f, pdfjs);
      if (guess) {
        setBox({
          x0: guess.rect.x0 / guess.pageWidth,
          y0: guess.rect.y0 / guess.pageHeight,
          x1: guess.rect.x1 / guess.pageWidth,
          y1: guess.rect.y1 / guess.pageHeight,
        });
        setAutoFound(true);
      } else {
        setAutoFound(false);
      }
    } catch {
      setAutoFound(false);
    }
  }, []);

  /** pointer position -> fraction of the displayed image (0..1), scale-agnostic */
  const frac = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return {
      fx: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      fy: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  function onDown(e: React.PointerEvent) {
    const { fx, fy } = frac(e);
    dragRef.current = { x: fx, y: fy };
    setBox(null);
  }
  function onMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const { fx, fy } = frac(e);
    setBox({
      x0: Math.min(dragRef.current.x, fx),
      y0: Math.min(dragRef.current.y, fy),
      x1: Math.max(dragRef.current.x, fx),
      y1: Math.max(dragRef.current.y, fy),
    });
  }
  const onUp = () => {
    dragRef.current = null;
  };

  /** legend box in device space (PDF points) */
  const deviceBox = (): BBox | null =>
    box && box.x1 - box.x0 > 0.01 && box.y1 - box.y0 > 0.01
      ? {
          x0: box.x0 * pageSize.w,
          y0: box.y0 * pageSize.h,
          x1: box.x1 * pageSize.w,
          y1: box.y1 * pageSize.h,
        }
      : null;

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
    const legendRect = deviceBox();
    if (!file || !legendRect) return;
    setPhase("working");
    setError("");
    setProgress(0);
    try {
      const pdfjs = await loadPdfjs();
      setStep("reading legend & rendering tiles…");
      const draft = await ingestPdf(file, pdfjs, {
        legendRect,
        symbolMeta: parseMeta(), // undefined => a symbol per legend row, auto
        excludeRects: [legendRect],
        onOcrProgress: (d, t) => {
          setStep(`reading legend labels (OCR) ${d}/${t}…`);
          setProgress(Math.round((d / t) * 100));
        },
      });
      if (!draft.symbols.length) {
        throw new Error(
          "No legend rows detected in that box. Draw it tighter around the מקרא table (the column of small symbols), then try again.",
        );
      }
      setStep("uploading assets…");
      setProgress(0);
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
      <h1>Upload a sheet</h1>

      {phase === "pick" && (
        <label className="drop">
          <input
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
          />
          <div>Drop a vector building-plan PDF here, or click to choose</div>
          <div style={{ color: "var(--graphite-60)" }}>
            Runs entirely in your browser. Desktop recommended.
          </div>
        </label>
      )}

      {phase === "legend" && previewUrl && (
        <>
          <p>
            {autoFound === null && "Looking for the מקרא legend…"}
            {autoFound === true && (
              <>
                Found the <strong>מקרא</strong> legend (blue box). Adjust it if it&apos;s off, then
                ingest. Every row becomes a button.
              </>
            )}
            {autoFound === false && (
              <>
                Couldn&apos;t locate the legend automatically — drag a box around the{" "}
                <strong>מקרא</strong> column yourself.
              </>
            )}
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
                  left: `${box.x0 * 100}%`,
                  top: `${box.y0 * 100}%`,
                  width: `${(box.x1 - box.x0) * 100}%`,
                  height: `${(box.y1 - box.y0) * 100}%`,
                  border: "2px solid var(--blueprint)",
                  background: "rgba(36,74,107,0.14)",
                  pointerEvents: "none",
                }}
              />
            )}
          </div>

          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", color: "var(--graphite-60)" }}>
              Add labels &amp; BOQ counts (optional)
            </summary>
            <p style={{ color: "var(--graphite-60)", marginBottom: 4 }}>
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
            <button className="btn btn--primary" disabled={!deviceBox()} onClick={run}>
              Ingest &amp; create buttons
            </button>
          </div>
        </>
      )}

      {phase === "working" && (
        <>
          <p>{step || "working…"}</p>
          <div className="progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p style={{ color: "var(--graphite-60)", fontSize: 12 }}>
            First run downloads the Hebrew OCR model (~15&nbsp;MB). Labels are a rough
            draft — fix them inline in the editor.
          </p>
        </>
      )}
    </main>
  );
}
