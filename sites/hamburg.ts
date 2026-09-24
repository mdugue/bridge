import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { HAMBURG_LGV } from "./providers";

/**
 * Hamburg's centre: Binnenalster and the south end of the Außenalster,
 * Rathaus, St. Michaelis, Speicherstadt, Elbphilharmonie and the
 * Landungsbrücken in a 2×2 block on our grid (LGV's downloads are 1 km).
 * Starts on the Jungfernstieg.
 */
export const HAMBURG: Site = {
  id: "hamburg",
  label: "Hamburg · Innenstadt",
  name: "Hamburg",
  provider: HAMBURG_LGV,
  spawn: "jungfernstieg",
  tiles: [
    { e: 564, n: 5934 },
    { e: 564, n: 5932 },
    { e: 566, n: 5932 },
    { e: 566, n: 5934 },
  ],
  fallbackLatLng: { lat: 53.55, lng: 9.99 },
  viewpoints: [
    {
      id: "jungfernstieg",
      label: "Jungfernstieg",
      description:
        "Am Jungfernstieg, über die Binnenalster schweift der Blick zur Lombardsbrücke.",
      mode: "walk",
      epsg: { x: 565_780, y: 5_934_314 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 37,
      pitchDeg: 1,
      fov: 62,
    },
    {
      id: "rathausmarkt",
      label: "Rathausmarkt",
      description:
        "Mitten auf dem Rathausmarkt, vor dir Fassade und Turm des Rathauses.",
      mode: "walk",
      epsg: { x: 565_790, y: 5_934_030 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 210,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "elbphilharmonie",
      label: "Elbphilharmonie",
      description:
        "Über der Norderelbe, die gläserne Welle der Elbphilharmonie auf dem alten Speicher.",
      mode: "fly",
      epsg: { x: 564_700, y: 5_932_500 },
      aboveGround: 100,
      headingDeg: 50,
      pitchDeg: -8,
      fov: 62,
    },
    {
      id: "speicherstadt",
      label: "Speicherstadt",
      description:
        "Tiefer Gleitflug über die Fleete der Speicherstadt, am Ende die Elbphilharmonie.",
      mode: "fly",
      epsg: { x: 566_200, y: 5_933_350 },
      aboveGround: 50,
      headingDeg: 247,
      pitchDeg: -6,
      fov: 62,
    },
    {
      id: "alster-panorama",
      label: "Alster-Panorama",
      description:
        "Hoch über der Außenalster, Blick über Binnenalster und Dächer bis zum Rathaus.",
      mode: "fly",
      epsg: { x: 566_300, y: 5_935_600 },
      aboveGround: 220,
      headingDeg: 199,
      pitchDeg: -10,
      fov: 60,
    },
  ],
};
