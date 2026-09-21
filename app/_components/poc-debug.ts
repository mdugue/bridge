/**
 * Dev/test-only debug hook consumed by the Playwright smoke test
 * (e2e/city-walk.spec.ts) and manual QA. NEXT_PUBLIC_POC_DEBUG is inlined at
 * build time, so regular production builds ship `enabled === false` and never
 * touch `window` — the hook cannot leak into production.
 */

import type { LookTarget } from "@/lib/city/look-controls";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import type { CameraState, PlayerPose } from "./create-app";
import type { FocusMode } from "./post-stack";
import type { Viewpoint } from "./viewpoints";

interface Xyz {
  x: number;
  y: number;
  z: number;
}

/** The look setters (`setAtmosphere`, …) come from LookTarget — see lib/city/look-controls.ts. */
export interface PocDebugInfo extends Partial<LookTarget> {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState?: (state: CameraState) => void;
  buildingCount: number;
  /** Demolishes the building under the screen-center crosshair. */
  demolishAtCrosshair?: () => void;
  /**
   * True once the primary tile is on screen and the handle exists; `ready`
   * follows when every layer has streamed in (neighbours, vegetation, rails).
   */
  firstFrame: boolean;
  /** Teleports the camera (world/Y-up coordinates) and enters fly mode. */
  flyTo?: (position: Xyz, lookAt: Xyz) => void;
  /** Animated glide to a curated scenic Viewpoint (the HUD buttons). */
  flyToViewpoint?: (viewpoint: Viewpoint) => void;
  /** Rendered-frame counter; e2e waits on it instead of sleeping. */
  frames: number;
  /** Captures the full camera pose for a reproducible snapshot. */
  getCameraState?: () => CameraState;
  /** Live DoF focus state + last crosshair raycast hit (QA/diagnostics). */
  getFocusDebug?: () => {
    bokehScale: number;
    focusDistance: number;
    focusRange: number;
    hitDist: number | null;
    hitName: string | null;
  };
  /** Current player pose in EPSG coordinates. */
  getPose?: () => PlayerPose;
  /** Last-frame GPU counters (draw calls, triangles, programs). */
  getRenderInfo?: () => {
    calls: number;
    gpuBytes: number;
    programs: number;
    triangles: number;
  };
  /** estimated GPU footprint (MB), see CityWalkStats */
  gpuMegabytes: number;
  /** Inserts the prescribed building (marker box without a glTF). */
  insertBuilding?: () => void;
  /** Recenter offset: world x = epsgX - cx, world z = -(epsgY - cy). */
  offset?: { cx: number; cy: number };
  ready: boolean;
  /**
   * True while the camera is moving and the post stack is running reduced
   * (AO + DoF skipped) — see lib/city/regression.ts.
   */
  regressed?: boolean;
  /** Toggles the photographic depth of field. */
  setDepthOfField?: (enabled: boolean) => void;
  /** Sets the manual focus distance (m). */
  setFocusDistance?: (meters: number) => void;
  /** Sets the depth-of-field focus mode ("auto" | "manual"). */
  setFocusMode?: (mode: FocusMode) => void;
  /** Re-aims the sun for an ISO date string. */
  setSunIso?: (iso: string) => void;
  /** Toggles the rich multi-tuft crown near the camera (LOD). */
  setTreeMultiTuft?: (enabled: boolean) => void;
  shadowsEnabled: boolean;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo?: (epsgX: number, epsgY: number) => void;
  /**
   * Union DGM extent [minX, minY, maxX, maxY] in EPSG — the minimap's frame.
   * Exposed so e2e can assert the minimap's px→EPSG mapping against the
   * bounds actually loaded, instead of hard-coding a tile block that changes
   * with the scene profile (see scene-profile.ts).
   */
  terrainBounds?: TerrainBounds;
  terrainVertexCount: number;
}

declare global {
  interface Window {
    __poc?: PocDebugInfo;
  }
}

const enabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_POC_DEBUG === "1";

export function updatePocDebug(patch: Partial<PocDebugInfo>): void {
  if (!enabled) {
    return;
  }
  window.__poc = {
    firstFrame: false,
    ready: false,
    buildingCount: 0,
    frames: 0,
    terrainVertexCount: 0,
    shadowsEnabled: false,
    gpuMegabytes: 0,
    ...window.__poc,
    ...patch,
  };
}

/** Called once per rendered frame from the animation loop. */
export function tickPocFrame(): void {
  if (!enabled) {
    return;
  }
  const poc = window.__poc;
  if (poc) {
    poc.frames += 1;
  }
}
