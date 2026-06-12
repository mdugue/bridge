"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  epsgToMapPx,
  type FootprintRect,
  mapPxToEpsg,
} from "@/lib/city/minimap";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import type { PlayerPose } from "./create-app";

/** Default CSS pixel size; canvases are scaled by devicePixelRatio. */
const DEFAULT_SIZE = 192;

// Canvas drawing colors — scene content like the 3D view, not themable chrome.
const PAPER = "#f7f5f0";
const INK = "rgba(50, 53, 62, 0.85)";
const FRAME = "rgba(50, 53, 62, 0.25)";
const PLAYER = "#2563eb";

// Muted map tints per land-cover class id (see scripts/extract-dlm.sh), a touch
// lighter than the 3D palette so the ink footprints stay legible on top.
const MAP_PALETTE: [number, number, number][] = [
  [239, 237, 231], // 0 background
  [205, 217, 168], // 1 farmland
  [143, 178, 136], // 2 forest
  [169, 195, 156], // 3 copse
  [231, 224, 212], // 4 built-up
  [185, 169, 169], // 5 railway
  [227, 207, 160], // 6 path
  [199, 201, 207], // 7 road
  [158, 195, 224], // 8 water
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

interface MinimapProps {
  bounds: TerrainBounds;
  footprints: FootprintRect[];
  /** optional land-cover splatmap (PNG) drawn as the map background */
  landcoverSrc?: string;
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
  landcoverSrc,
  onTeleport,
  size = DEFAULT_SIZE,
  subscribePose,
}: MinimapProps) {
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Static layer: land-cover base + tile frame + footprints. Redrawn after
  // demolish, and again once the land-cover image has loaded.
  useEffect(() => {
    const canvas = staticRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas, size);

    const paint = (base?: CanvasImageSource) => {
      if (base) {
        ctx.drawImage(base, 0, 0, size, size);
      } else {
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, size, size);
      }
      ctx.strokeStyle = FRAME;
      ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
      ctx.fillStyle = INK;
      for (const rect of footprints) {
        const a = epsgToMapPx(rect.minX, rect.maxY, bounds, size);
        const b = epsgToMapPx(rect.maxX, rect.minY, bounds, size);
        ctx.fillRect(
          a.px,
          a.py,
          Math.max(b.px - a.px, 1.2),
          Math.max(b.py - a.py, 1.2)
        );
      }
    };

    paint(); // paper base immediately; swap in the land-cover once decoded
    if (!landcoverSrc) {
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) {
        paint(colorizeLandcover(img, size));
      }
    };
    img.src = landcoverSrc;
    return () => {
      cancelled = true;
    };
  }, [footprints, bounds, size, landcoverSrc]);

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
