/**
 * Dev/test-only debug hook consumed by the Playwright smoke test
 * (e2e/city-walk.spec.ts) and manual QA. NEXT_PUBLIC_POC_DEBUG is inlined at
 * build time, so regular production builds ship `enabled === false` and never
 * touch `window` — the hook cannot leak into production.
 */

import type { CameraState, PlayerPose } from "./create-app";
import type { FocusMode } from "./post-stack";
import type { CityStyleId } from "./visual-style";

interface Xyz {
  x: number;
  y: number;
  z: number;
}

export interface PocDebugInfo {
  /** Restores a camera pose captured by getCameraState (snapshot replay). */
  applyCameraState?: (state: CameraState) => void;
  buildingCount: number;
  /** Demolishes the building under the screen-center crosshair. */
  demolishAtCrosshair?: () => void;
  /** Teleports the camera (world/Y-up coordinates) and enters fly mode. */
  flyTo?: (position: Xyz, lookAt: Xyz) => void;
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
  getRenderInfo?: () => { calls: number; triangles: number; programs: number };
  /** Inserts the prescribed building (marker box without a glTF). */
  insertBuilding?: () => void;
  /** Recenter offset: world x = epsgX - cx, world z = -(epsgY - cy). */
  offset?: { cx: number; cy: number };
  ready: boolean;
  /** Sets the fog amount (0..1). */
  setAtmosphere?: (amount: number) => void;
  /** Sets the building storey contour-line (Höhenlinien) strength (0..1). */
  setBuildingBands?: (strength: number) => void;
  /** Sets the dusk interior glow (Abendlicht) strength (0..1). */
  setBuildingDuskGlow?: (strength: number) => void;
  /** Sets the eave cornice-stroke (Traufkante) strength (0..1). */
  setBuildingEave?: (strength: number) => void;
  /** Sets the building ground-contact darkening (Boden-Verlauf) strength (0..1). */
  setBuildingGroundShade?: (strength: number) => void;
  /** Sets the building Fresnel rim (Streiflicht) strength (0..1). */
  setBuildingRim?: (strength: number) => void;
  /** Sets the roof colour mix (Dachfarbe) (0..1). */
  setBuildingRoofTint?: (strength: number) => void;
  /** Sets the per-building roughness jitter (Materialstreuung) strength (0..1). */
  setBuildingRoughness?: (strength: number) => void;
  /** Sets the per-building clay tint (Farbvariation) mix (0..1). */
  setBuildingTint?: (strength: number) => void;
  /** Sets the active style's transparency (0..1). */
  setBuildingTransparency?: (transparency: number) => void;
  /** Sets the soft contact-shadow (SSAO) strength (0..1). */
  setContactShadows?: (strength: number) => void;
  /** Sets the warm-near/cool-far grading intensity (0..1). */
  setDepthGrading?: (intensity: number) => void;
  /** Toggles the photographic depth of field. */
  setDepthOfField?: (enabled: boolean) => void;
  /** Sets the manual focus distance (m). */
  setFocusDistance?: (meters: number) => void;
  /** Sets the depth-of-field focus mode ("auto" | "manual"). */
  setFocusMode?: (mode: FocusMode) => void;
  /** Sets the valley height-fog (Talnebel) strength (0..1). */
  setHeightFog?: (strength: number) => void;
  /** Sets the paper-grain intensity (0..1). */
  setPaperGrain?: (intensity: number) => void;
  /** Switches the city rendering style. */
  setStyle?: (style: CityStyleId) => void;
  /** Re-aims the sun for an ISO date string. */
  setSunIso?: (iso: string) => void;
  /** Toggles the rich multi-tuft crown near the camera (LOD). */
  setTreeMultiTuft?: (enabled: boolean) => void;
  /** Sets the backlit canopy shimmer strength (0..1). */
  setTreeShimmer?: (strength: number) => void;
  /** Sets the backlit (shadow-gated) canopy translucency strength (0..1). */
  setTreeTranslucency?: (strength: number) => void;
  /** Sets the river-mist (Flussnebel) strength (0..1). */
  setWaterMist?: (strength: number) => void;
  shadowsEnabled: boolean;
  /** Drops the player at EPSG coordinates, standing on the terrain. */
  teleportTo?: (epsgX: number, epsgY: number) => void;
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
    ready: false,
    buildingCount: 0,
    terrainVertexCount: 0,
    shadowsEnabled: false,
    ...window.__poc,
    ...patch,
  };
}
