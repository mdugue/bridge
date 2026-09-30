import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { SAXONY } from "./providers";

/**
 * Grimma on the Mulde: two GeoSN tiles, the old town with Markt, Schloss
 * and Frauenkirche, and east of x = 342 km the far bank with the
 * Pöppelmannbrücke's landing.
 */
export const GRIMMA: Site = {
  id: "grimma",
  label: "Grimma · Altstadt",
  name: "Grimma",
  provider: SAXONY,
  spawn: "muldeufer",
  tiles: [
    { e: 340, n: 5678 },
    { e: 342, n: 5678 },
  ],
  fallbackLatLng: { lat: 51.24, lng: 12.73 },
  viewpoints: [
    {
      id: "muldeufer",
      label: "Muldeufer",
      description:
        "Auf der Muldewiese neben der Pöppelmannbrücke, über dem Fluss das Schloss.",
      mode: "walk",
      epsg: { x: 341_860, y: 5_678_800 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 244,
      pitchDeg: 3,
      fov: 62,
    },
    {
      id: "markt",
      label: "Markt",
      description:
        "Auf dem Markt vor dem Renaissance-Rathaus mit seinem Treppengiebel.",
      mode: "walk",
      epsg: { x: 341_455, y: 5_678_625 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 134,
      pitchDeg: 4,
      fov: 62,
    },
    {
      id: "mulde-aerial",
      label: "Über der Mulde",
      description: "Über der Mulde, Brücke und Schloss bewachen die Altstadt.",
      mode: "fly",
      epsg: { x: 342_150, y: 5_679_100 },
      aboveGround: 90,
      headingDeg: 230,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "altstadt-panorama",
      label: "Altstadt-Panorama",
      description:
        "Hoch über dem Stadtwald, Blick über den Fluss auf die ganze Altstadt bis zur Frauenkirche.",
      mode: "fly",
      epsg: { x: 342_300, y: 5_678_300 },
      aboveGround: 150,
      headingDeg: 262,
      pitchDeg: -8,
      fov: 60,
    },
  ],
};
