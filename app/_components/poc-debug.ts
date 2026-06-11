/**
 * Dev/test-only debug hook consumed by the Playwright smoke test
 * (e2e/city-walk.spec.ts) and manual QA. NEXT_PUBLIC_POC_DEBUG is inlined at
 * build time, so regular production builds ship `enabled === false` and never
 * touch `window` — the hook cannot leak into production.
 */

import type { PlayerPose } from "./create-app";
import type { CityStyleId } from "./visual-style";

interface Xyz {
  x: number;
  y: number;
  z: number;
}

export interface PocDebugInfo {
  buildingCount: number;
  /** Demolishes the building under the screen-center crosshair. */
  demolishAtCrosshair?: () => void;
  /** Teleports the camera (world/Y-up coordinates) and enters fly mode. */
  flyTo?: (position: Xyz, lookAt: Xyz) => void;
  /** Current player pose in EPSG coordinates. */
  getPose?: () => PlayerPose;
  /** Inserts the prescribed building (marker box without a glTF). */
  insertBuilding?: () => void;
  /** Recenter offset: world x = epsgX - cx, world z = -(epsgY - cy). */
  offset?: { cx: number; cy: number };
  ready: boolean;
  /** Switches the city rendering style. */
  setStyle?: (style: CityStyleId) => void;
  /** Re-aims the sun for an ISO date string. */
  setSunIso?: (iso: string) => void;
  /** Toggles the tilt-shift miniature blur. */
  setTiltShift?: (enabled: boolean) => void;
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
