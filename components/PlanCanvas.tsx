"use client";

/**
 * OpenSeadragon deep-zoom viewer for a plan, with a React overlay layer for the
 * placement buttons. The image comes from the DZI tiles served by the asset
 * route; buttons are plain absolutely-positioned DOM kept in sync with the OSD
 * viewport on every animation frame.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type OpenSeadragon from "openseadragon";
import { assetUrl } from "@/lib/client";
import type { PlacementRow, SymbolRow } from "@/lib/domain";
import { PlacementButton } from "./PlacementButton";

export interface PlanCanvasProps {
  planId: string;
  width: number;
  height: number;
  tileSize?: number;
  tileOverlap?: number;
  placements: PlacementRow[];
  symbols: SymbolRow[];
  mode: "author" | "view";
  /** author mode: the symbol to drop when the operator clicks empty canvas */
  activeSymbolId?: string | null;
  onAddAt?: (nx: number, ny: number) => void;
  onMovePlacement?: (id: string, nx: number, ny: number) => void;
  onSelectPlacement?: (id: string) => void;
  selectedPlacementId?: string | null;
}

export function PlanCanvas(props: PlanCanvasProps) {
  const {
    planId,
    width,
    height,
    tileSize = 512,
    tileOverlap = 1,
    placements,
    symbols,
    mode,
    activeSymbolId,
    onAddAt,
    onMovePlacement,
    onSelectPlacement,
    selectedPlacementId,
  } = props;

  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const osdRef = useRef<typeof OpenSeadragon | null>(null);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const symbolById = new Map(symbols.map((s) => [s.id, s]));

  useEffect(() => {
    let disposed = false;
    (async () => {
      const mod = await import("openseadragon");
      const OSD = (mod.default ?? mod) as unknown as typeof OpenSeadragon;
      if (disposed || !hostRef.current) return;
      osdRef.current = OSD;

      const maxLevel = Math.ceil(Math.log2(Math.max(width, height)));
      const viewer = OSD({
        element: hostRef.current,
        prefixUrl: "/openseadragon-images/",
        showNavigationControl: true,
        navigatorPosition: "BOTTOM_RIGHT",
        showNavigator: mode === "author",
        gestureSettingsMouse: { clickToZoom: false },
        maxZoomPixelRatio: 3,
        visibilityRatio: 1,
        constrainDuringPan: true,
        tileSources: {
          width,
          height,
          tileSize,
          tileOverlap,
          minLevel: 0,
          maxLevel,
          getTileUrl: (level: number, x: number, y: number) =>
            assetUrl(planId, `tiles/${level}/${x}_${y}.webp`),
        },
      });
      viewerRef.current = viewer;

      for (const ev of ["animation", "update-viewport", "resize", "open", "rotate"] as const) {
        viewer.addHandler(ev, rerender);
      }

      viewer.addHandler("canvas-click", (e) => {
        if (mode !== "author" || !activeSymbolIdRef.current || !onAddAtRef.current) return;
        const oe = e as unknown as { position: OpenSeadragon.Point; quick: boolean };
        if (!oe.quick) return;
        const img = viewer.viewport.viewerElementToImageCoordinates(oe.position);
        onAddAtRef.current(clamp01(img.x / width), clamp01(img.y / height));
      });
    })();

    return () => {
      disposed = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, width, height, tileSize, tileOverlap, mode]);

  // keep click handler deps fresh without re-creating the viewer
  const activeSymbolIdRef = useRef(activeSymbolId);
  const onAddAtRef = useRef(onAddAt);
  activeSymbolIdRef.current = activeSymbolId;
  onAddAtRef.current = onAddAt;

  const toScreen = (nx: number, ny: number) => {
    const v = viewerRef.current;
    const OSD = osdRef.current;
    if (!v || !OSD) return null;
    const p = v.viewport.imageToViewerElementCoordinates(new OSD.Point(nx * width, ny * height));
    return { left: p.x, top: p.y };
  };

  const screenToNorm = (clientX: number, clientY: number) => {
    const v = viewerRef.current;
    const OSD = osdRef.current;
    const host = hostRef.current;
    if (!v || !OSD || !host) return null;
    const r = host.getBoundingClientRect();
    const img = v.viewport.viewerElementToImageCoordinates(
      new OSD.Point(clientX - r.left, clientY - r.top),
    );
    return { nx: clamp01(img.x / width), ny: clamp01(img.y / height) };
  };

  return (
    <div className="plan-canvas">
      <div ref={hostRef} className="plan-canvas__osd" />
      <div className="plan-canvas__overlay">
        {placements.map((p) => {
          const pos = toScreen(p.x, p.y);
          if (!pos) return null;
          return (
            <PlacementButton
              key={p.id}
              placement={p}
              symbol={symbolById.get(p.symbolId)}
              screen={pos}
              draggable={mode === "author"}
              selected={p.id === selectedPlacementId}
              onSelect={() => onSelectPlacement?.(p.id)}
              onDragEnd={(clientX, clientY) => {
                const n = screenToNorm(clientX, clientY);
                if (n) onMovePlacement?.(p.id, n.nx, n.ny);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
