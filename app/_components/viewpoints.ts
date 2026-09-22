import { EYE_HEIGHT } from "@/lib/city/pose";
import type { MovementMode } from "./fps-movement";

/**
 * A curated vantage the camera can glide to from the HUD. Authored in the same
 * EPSG:25833 frame as the rest of the data (so a coordinate can be eyeballed on
 * a map) plus a height *above the terrain* — camera-pose resolves the real
 * ground at runtime, so a viewpoint stays correct even if the DGM changes.
 *
 * `mode` is where the player lands: `fly` keeps the elevated/free pose, `walk`
 * drops them onto the ground at eye height once the flight settles.
 */
export interface Viewpoint {
  /** metres above the terrain at `epsg` (≈ eye height for walk views). */
  aboveGround: number;
  description: string;
  /** EPSG:25833 ground position the camera sits at / hovers above. */
  epsg: { x: number; y: number };
  fov: number;
  /** compass degrees, 0 = north, clockwise (east) — matches CameraState. */
  headingDeg: number;
  id: string;
  label: string;
  mode: MovementMode;
  /** + = looking up, − = looking down. */
  pitchDeg: number;
}

/**
 * Hand-picked Dresden vantages. Coordinates anchored to the baked bridge
 * centrelines + DGM elevation profile (the Elbe channel sits at ~104 m between
 * banks at ~114 m), and the three aerial poses were verified against the
 * existing snapshot plates (shots/feat_aerial_day, feat_street).
 */
export const SCENIC_VIEWS: Viewpoint[] = [
  {
    id: "carolabruecke",
    label: "Carolabrücke",
    description:
      "Über der Elbe an der Carolabrücke — der Fluss zieht zur Altstadt-Silhouette.",
    mode: "fly",
    epsg: { x: 412_550, y: 5_656_980 },
    aboveGround: 70,
    headingDeg: 245,
    pitchDeg: -10,
    fov: 62,
  },
  {
    id: "elbe-aerial",
    label: "Elbe-Panorama",
    description: "Hoch über der Flussbiegung, Blick über die ganze Stadt.",
    mode: "fly",
    epsg: { x: 412_914, y: 5_657_367 },
    aboveGround: 246,
    headingDeg: 332,
    pitchDeg: -25,
    fov: 60,
  },
  {
    id: "rooftops",
    label: "Über den Dächern",
    description: "Tiefer Gleitflug knapp über den Dächern der Altstadt.",
    mode: "fly",
    epsg: { x: 412_734, y: 5_657_637 },
    aboveGround: 31,
    headingDeg: 347,
    pitchDeg: -6,
    fov: 62,
  },
  {
    id: "canaletto",
    label: "Canaletto-Blick",
    description:
      "Zu Fuß auf der Elbwiese unterhalb der Carolabrücke, die Altstadt jenseits der Wiese.",
    mode: "walk",
    epsg: { x: 412_060, y: 5_656_745 },
    aboveGround: EYE_HEIGHT,
    headingDeg: 195,
    pitchDeg: 4,
    fov: 62,
  },
  {
    id: "elbe-promenade",
    label: "Elbufer",
    description:
      "Spaziergang am baumbestandenen Neustädter Ufer, der Fluss führt zur Altstadt.",
    mode: "walk",
    epsg: { x: 412_420, y: 5_656_915 },
    aboveGround: EYE_HEIGHT,
    headingDeg: 243,
    pitchDeg: 1,
    fov: 62,
  },
];
