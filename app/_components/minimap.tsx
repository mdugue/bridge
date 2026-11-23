"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { LANDCOVER_CLASSES, landcoverSrgb } from "@/lib/city/landcover";
import { epsgToMapPx, mapHeightPx, mapPxToEpsg } from "@/lib/city/minimap";
import type { MapFootprints, MapPicture } from "@/lib/city/minimap";
import type { PlayerPose } from "@/lib/city/pose";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";

/** Default CSS pixel width; canvases are scaled by devicePixelRatio. */
const DEFAULT_SIZE = 192;

// Drawing colors — scene content like the 3D view, not themable chrome.
const PAPER = "#f7f5f0";
// a design's plan, in the picture's ink (scripts/bake-minimap.ts)
const INK = "rgba(50, 53, 62, 0.9)";
const PLAYER = "#2563eb";

/** The ground a building leaves: the built-up class's colour, which the
 *  picture has around most buildings. */
const [GR, GG, GB] = landcoverSrgb(
  LANDCOVER_CLASSES.find((c) => c.key === "builtup")?.id ?? 0
);
const GROUND = `rgb(${GR}, ${GG}, ${GB})`;

/** Traces `pack`'s rings of the objects `gone` says are gone. */
function traceGone(
  ctx: CanvasRenderingContext2D,
  { gone, pack }: MapFootprints["tiles"][number],
  bounds: TerrainBounds,
  size: number
): void {
  const { objectEnd, ringEnd, xy } = pack;
  ctx.beginPath();
  for (let object = 0; object < objectEnd.length; object += 1) {
    if (!gone.has(object)) {
      continue;
    }
    for (
      let r = object === 0 ? 0 : objectEnd[object - 1];
      r < objectEnd[object];
      r += 1
    ) {
      const first = r === 0 ? 0 : ringEnd[r - 1];
      for (let p = first; p < ringEnd[r]; p += 1) {
        // (the pack holds centimetres)
        const { px, py } = epsgToMapPx(
          xy[2 * p] / 100,
          xy[2 * p + 1] / 100,
          bounds,
          size
        );
        if (p === first) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.closePath();
    }
  }
}

/**
 * What changed since the build drew the picture: the buildings that are
 * gone painted over in the ground's colour (their outlines a little grown,
 * so no rim of ink stays), then a design's plan drawn as a building.
 */
function drawChanges(
  ctx: CanvasRenderingContext2D,
  footprints: MapFootprints,
  bounds: TerrainBounds,
  size: number
): void {
  ctx.fillStyle = GROUND;
  ctx.strokeStyle = GROUND;
  ctx.lineWidth = 1;
  for (const tile of footprints.tiles) {
    traceGone(ctx, tile, bounds, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  for (const { pts } of footprints.outlines) {
    if (pts.length < 3) {
      continue;
    }
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 1) {
      const { px, py } = epsgToMapPx(pts[i][0], pts[i][1], bounds, size);
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * Modell's picture on the map (plan 055): the ground the view shows, as a
 * frame — the plan view's sheet edge, an axonometry's rhombus.
 */
function drawPictureFrame(
  ctx: CanvasRenderingContext2D,
  corners: readonly (readonly [number, number])[],
  bounds: TerrainBounds,
  size: number
): void {
  if (corners.length < 3) {
    return;
  }
  ctx.beginPath();
  for (let i = 0; i < corners.length; i += 1) {
    const [x, y] = corners[i];
    const { px, py } = epsgToMapPx(x, y, bounds, size);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(37, 99, 235, 0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(37, 99, 235, 0.7)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Where `picture` lies on a map of `bounds`, `size` px wide (CSS px). */
function placed(picture: MapPicture, bounds: TerrainBounds, size: number) {
  const [x0, y0, x1, y1] = picture.bounds;
  const a = epsgToMapPx(x0, y1, bounds, size);
  const b = epsgToMapPx(x1, y0, bounds, size);
  return {
    height: b.py - a.py,
    left: a.px,
    top: a.py,
    url: picture.url,
    width: b.px - a.px,
  };
}

interface MinimapProps {
  bounds: TerrainBounds;
  /** the buildings gone since the picture was drawn, and a design's plan */
  footprints: MapFootprints;
  /** the build's picture of the site (scripts/bake-minimap.ts), or none */
  mapPicture: MapPicture | null;
  onTeleport: (epsgX: number, epsgY: number) => void;
  /** CSS pixel width; the height follows the site's aspect ratio */
  size?: number;
  /** subscribe to throttled pose updates; returns an unsubscribe fn */
  subscribePose: (cb: (pose: PlayerPose) => void) => () => void;
}

function setupCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number
): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas unsupported");
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Schematic figure-ground minimap: the build's picture of the site (land
 * cover, bridge decks, buildings) as an image, a canvas over it for what
 * changed since (a building taken down, a design), and the player dot +
 * heading wedge on a second one (redrawn at pose rate, ~10 Hz). Clicking
 * teleports.
 */
export const Minimap = ({
  bounds,
  footprints,
  mapPicture,
  onTeleport,
  size = DEFAULT_SIZE,
  subscribePose,
}: MinimapProps) => {
  // The map has the site's shape (a landscape for Dresden), edge to edge.
  const height = mapHeightPx(bounds, size);
  // The picture where its extent lies on the map: edge to edge for the
  // site, cropped by the frame where the map shows one tile of it.
  const picture = mapPicture && placed(mapPicture, bounds, size);
  const changesRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // What changed since the picture: redrawn when a building goes or comes
  // back and when a design loads, empty otherwise.
  useEffect(() => {
    const canvas = changesRef.current;
    if (canvas) {
      const ctx = setupCanvas(canvas, size, height);
      ctx.clearRect(0, 0, size, height);
      drawChanges(ctx, footprints, bounds, size);
    }
  }, [footprints, bounds, size, height]);

  // Dynamic layer: player dot + heading wedge.
  useEffect(() => {
    const canvas = overlayRef.current;
    const watch = (target: HTMLCanvasElement) => {
      const ctx = setupCanvas(target, size, height);
      return subscribePose((pose) => {
        ctx.clearRect(0, 0, size, height);
        if (pose.footprint) {
          drawPictureFrame(ctx, pose.footprint, bounds, size);
        }
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
    };
    return canvas ? watch(canvas) : undefined;
  }, [subscribePose, bounds, size, height]);

  return (
    <button
      aria-label="Minimap — click to teleport"
      className="relative block cursor-crosshair overflow-hidden rounded-md ring-1 ring-sidebar-border"
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
      style={{ backgroundColor: PAPER, width: size, height }}
      type="button"
    >
      {picture && (
        // a plain img: the build's own picture, content-hashed and at its
        // own size, is nothing for the image optimiser to do
        <Image
          alt=""
          className="absolute max-w-none"
          draggable={false}
          height={Math.round(picture.height)}
          src={picture.url}
          style={{
            height: picture.height,
            left: picture.left,
            top: picture.top,
            width: picture.width,
          }}
          unoptimized
          width={Math.round(picture.width)}
        />
      )}
      <canvas
        className="absolute inset-0"
        ref={changesRef}
        style={{ width: size, height }}
      />
      <canvas
        className="absolute inset-0"
        ref={overlayRef}
        style={{ width: size, height }}
      />
    </button>
  );
};
