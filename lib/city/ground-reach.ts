/**
 * How finely a view draws a tile's ground, and with it which of the
 * ground's rasters the tile needs. The ground's close-range detail — kerb
 * lines, paving patterns, lawn edges — fades out by the metres a pixel
 * spans (`fwidth`, app/_components/ground-detail.ts: gone at 0.5 m), so a
 * fine level beyond that reach reads the paving, the edge distances, the
 * sports grounds and the road markings from their 1024² twins
 * (lib/city/tile.ts `FAR_RASTER_PX`) and holds 14 MiB of them instead of
 * 56. What still shows out there — the paving's kind, the urban green,
 * a pitch's lines, the lane lines until 1.5 m a pixel — is in the twins.
 * Pure math: no three, no DOM.
 */

/** A view as the reach reads it: its eye and opening, or — a parallel
 *  camera (Modell) — the world height its frame shows; `heightPx` the
 *  frame's height in drawn pixels. */
export type ReachView =
  | {
      eye: readonly [number, number, number];
      fovDeg: number;
      heightPx: number;
      kind: "perspective";
    }
  | { heightPx: number; kind: "parallel"; worldHeight: number };

/** An axis-aligned box in the view's frame. */
export interface ReachBox {
  max: readonly [number, number, number];
  min: readonly [number, number, number];
}

/** The distance from `p` to `box` (0 inside it). */
function distanceTo(
  box: ReachBox,
  p: readonly [number, number, number]
): number {
  let sum = 0;
  for (let i = 0; i < 3; i += 1) {
    const d = Math.max(box.min[i] - p[i], 0, p[i] - box.max[i]);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The fewest metres a pixel of `view` spans anywhere on `box`: at its
 * point nearest the eye, seen square on. The ground is seen at a slant
 * and spans more, so this never reads a tile as farther than it is drawn.
 */
export function metresPerPixel(view: ReachView, box: ReachBox): number {
  const px = Math.max(view.heightPx, 1);
  if (view.kind === "parallel") {
    return view.worldHeight / px;
  }
  const opening = 2 * Math.tan((view.fovDeg * Math.PI) / 360);
  return (distanceTo(box, view.eye) * opening) / px;
}

/** A tile takes its full rasters under this many metres a pixel: half
 *  again the 0.5 m the detail has faded in by, so they are there before
 *  it shows. */
export const NEAR_BELOW_M = 0.75;
/** …and goes back to the twins above this (a walker pacing a tile's edge
 *  swaps nothing). */
export const FAR_ABOVE_M = 1.1;

/**
 * Whether a tile reads its twins, from the finest any view draws it at
 * and what it reads now (`far`; undefined: nothing yet).
 */
export function readsFar(metres: number, far: boolean | undefined): boolean {
  if (far === undefined) {
    return metres >= NEAR_BELOW_M;
  }
  return far ? metres >= NEAR_BELOW_M : metres > FAR_ABOVE_M;
}
