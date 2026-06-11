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

/** CSS pixels; canvases are scaled by devicePixelRatio for crispness. */
const SIZE = 192;

// Canvas drawing colors — scene content like the 3D view, not themable chrome.
const PAPER = "#f7f5f0";
const INK = "rgba(50, 53, 62, 0.85)";
const FRAME = "rgba(50, 53, 62, 0.25)";
const PLAYER = "#2563eb";

interface MinimapProps {
  bounds: TerrainBounds;
  footprints: FootprintRect[];
  onTeleport: (epsgX: number, epsgY: number) => void;
  /** subscribe to throttled pose updates; returns an unsubscribe fn */
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}

function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
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
  onTeleport,
  subscribePose,
}: MinimapProps) {
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Static layer: tile frame + footprints. Redrawn after demolish.
  useEffect(() => {
    const canvas = staticRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.strokeStyle = FRAME;
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
    ctx.fillStyle = INK;
    for (const rect of footprints) {
      const a = epsgToMapPx(rect.minX, rect.maxY, bounds, SIZE);
      const b = epsgToMapPx(rect.maxX, rect.minY, bounds, SIZE);
      ctx.fillRect(
        a.px,
        a.py,
        Math.max(b.px - a.px, 1.2),
        Math.max(b.py - a.py, 1.2)
      );
    }
  }, [footprints, bounds]);

  // Dynamic layer: player dot + heading wedge.
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) {
      return;
    }
    const ctx = setupCanvas(canvas);
    return subscribePose((pose) => {
      ctx.clearRect(0, 0, SIZE, SIZE);
      const { px, py } = epsgToMapPx(pose.epsgX, pose.epsgY, bounds, SIZE);
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
  }, [subscribePose, bounds]);

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
              SIZE
            );
            onTeleport(x, y);
          }}
          style={{ width: SIZE, height: SIZE }}
          type="button"
        >
          <canvas
            className="absolute inset-0"
            ref={staticRef}
            style={{ width: SIZE, height: SIZE }}
          />
          <canvas
            className="absolute inset-0"
            ref={overlayRef}
            style={{ width: SIZE, height: SIZE }}
          />
        </button>
      </CardContent>
    </Card>
  );
}
