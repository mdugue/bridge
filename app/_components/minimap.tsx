"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  epsgToMapPx,
  type FootprintPoly,
  mapPxToEpsg,
} from "@/lib/city/minimap";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import type { PlayerPose } from "./create-app";

/** Default CSS pixel size; canvases are scaled by devicePixelRatio. */
const DEFAULT_SIZE = 192;

// Canvas drawing colors — scene content like the 3D view, not themable chrome.
const PAPER = "#f7f5f0";
const INK = "rgba(50, 53, 62, 0.85)";
const INK_FILL = "rgba(50, 53, 62, 0.35)";
const FRAME = "rgba(50, 53, 62, 0.25)";
const PLAYER = "#2563eb";

// Muted map tints per land-cover class id (see scripts/extract-dlm.sh), a touch
// lighter than the 3D palette so the ink footprints stay legible on top.
const MAP_PALETTE: [number, number, number][] = [
  [230, 224, 209], // 0 background  warm pale taupe
  [197, 211, 170], // 1 farmland    soft sage
  [150, 176, 138], // 2 forest      muted moss
  [175, 195, 158], // 3 copse       light moss
  [228, 219, 203], // 4 built-up    warm pale clay
  [197, 183, 178], // 5 railway     dusty mauve
  [224, 205, 168], // 6 path        pale warm sand
  [200, 200, 206], // 7 road        soft grey-lavender
  [164, 192, 209], // 8 water       dusty blue
];

/**
 * Recolors the class-id splatmap into a small map-tinted canvas. NEAREST
 * sampling (smoothing off) keeps class boundaries crisp under downscaling.
 */
function colorizeLandcover(
  img: HTMLImageElement,
  size: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return canvas;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const tint = MAP_PALETTE[data[i]] ?? MAP_PALETTE[0];
    data[i] = tint[0];
    data[i + 1] = tint[1];
    data[i + 2] = tint[2];
    data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Draws true building footprints as soft-filled, thin-outlined polygons so the
 * map reads as a figure-ground plan instead of a few oversized solid blocks.
 */
function drawFootprints(
  ctx: CanvasRenderingContext2D,
  footprints: FootprintPoly[],
  bounds: TerrainBounds,
  size: number
): void {
  ctx.fillStyle = INK_FILL;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.5;
  for (const poly of footprints) {
    if (poly.pts.length < 3) {
      continue;
    }
    ctx.beginPath();
    poly.pts.forEach(([x, y], i) => {
      const { px, py } = epsgToMapPx(x, y, bounds, size);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

interface MinimapProps {
  bounds: TerrainBounds;
  footprints: FootprintPoly[];
  /** per-tile land-cover class PNGs + their EPSG bounds, drawn as background */
  landcoverTiles?: { bounds: TerrainBounds; src: string }[];
  onTeleport: (epsgX: number, epsgY: number) => void;
  /** CSS pixel edge length (square); smaller on phones */
  size?: number;
  /** subscribe to throttled pose updates; returns an unsubscribe fn */
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  size: number
): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unsupported");
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Schematic figure-ground minimap: building footprints from the in-memory
 * CityJSON on a static canvas, the player dot + heading wedge on a dynamic
 * overlay canvas (redrawn at pose rate, ~10 Hz). Clicking teleports.
 */
export function Minimap({
  bounds,
  footprints,
  landcoverTiles,
  onTeleport,
  size = DEFAULT_SIZE,
  subscribePose,
}: MinimapProps) {
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Static layer: per-tile land-cover background + frame + footprints. Redrawn
  // after demolish and again as each tile's image decodes.
  useEffect(() => {
    const canvas = staticRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas, size);
    const tiles = landcoverTiles ?? [];
    const decoded = new Map<string, HTMLCanvasElement>();

    const repaint = () => {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, size, size);
      // Each tile drawn into its own sub-rect of the (union) bounds.
      for (const tile of tiles) {
        const cv = decoded.get(tile.src);
        if (!cv) {
          continue;
        }
        const a = epsgToMapPx(tile.bounds[0], tile.bounds[3], bounds, size);
        const b = epsgToMapPx(tile.bounds[2], tile.bounds[1], bounds, size);
        ctx.drawImage(cv, a.px, a.py, b.px - a.px, b.py - a.py);
      }
      ctx.strokeStyle = FRAME;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      drawFootprints(ctx, footprints, bounds, size);
    };

    repaint(); // paper + footprints immediately; tiles fill in as they decode
    let cancelled = false;
    for (const tile of tiles) {
      const img = new Image();
      img.onload = () => {
        if (!cancelled) {
          decoded.set(tile.src, colorizeLandcover(img, 256));
          repaint();
        }
      };
      img.src = tile.src;
    }
    return () => {
      cancelled = true;
    };
  }, [footprints, bounds, size, landcoverTiles]);

  // Dynamic layer: player dot + heading wedge.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas, size);
    return subscribePose((pose) => {
      ctx.clearRect(0, 0, size, size);
      const { px, py } = epsgToMapPx(pose.epsgX, pose.epsgY, bounds, size);
      ctx.save();
      ctx.translate(px, py);
      // Heading: 0 = north = canvas "up", clockwise positive.
      ctx.rotate(pose.heading);
      ctx.fillStyle = "rgba(37, 99, 235, 0.25)";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, 14, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = PLAYER;
      ctx.beginPath();
      ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }, [subscribePose, bounds, size]);

  return (
    <Card className="pointer-events-auto gap-2 py-3">
      <CardContent className="px-3">
        <button
          aria-label="Minimap — click to teleport"
          className="relative block cursor-crosshair"
          data-testid="minimap"
          onClick={(e) => {
            // Keyboard "clicks" carry no coordinates to teleport to.
            if (e.detail === 0) {
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            const { x, y } = mapPxToEpsg(
              e.clientX - rect.left,
              e.clientY - rect.top,
              bounds,
              size
            );
            onTeleport(x, y);
          }}
          style={{ width: size, height: size }}
          type="button"
        >
          <canvas
            className="absolute inset-0"
            ref={staticRef}
            style={{ width: size, height: size }}
          />
          <canvas
            className="absolute inset-0"
            ref={overlayRef}
            style={{ width: size, height: size }}
          />
        </button>
      </CardContent>
    </Card>
  );
}
