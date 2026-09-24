import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { BAVARIA } from "./providers";

/**
 * Munich's old town, the Isar with the Deutsches Museum and the
 * Maximilianeum: a 2×2 block on our grid (LDBV's rasters are 1 km, its
 * LoD2 2 km). Oberbayern's extract is a quarter of Bavaria's.
 */
export const MUENCHEN: Site = {
  id: "muenchen",
  label: "München · Altstadt",
  name: "München",
  provider: BAVARIA,
  osm: "europe/germany/bayern/oberbayern",
  spawn: "marienplatz",
  tiles: [
    { e: 690, n: 5334 },
    { e: 692, n: 5334 },
    { e: 690, n: 5332 },
    { e: 692, n: 5332 },
  ],
  fallbackLatLng: { lat: 48.14, lng: 11.58 },
  viewpoints: [
    {
      id: "marienplatz",
      label: "Marienplatz",
      description:
        "Auf dem Marienplatz, vor dir die neugotische Front des Neuen Rathauses.",
      mode: "walk",
      epsg: { x: 691_665, y: 5_334_722 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 343,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "odeonsplatz",
      label: "Odeonsplatz",
      description:
        "Auf dem Odeonsplatz, die Feldherrnhalle schließt den Platz, daneben die gelbe Theatinerkirche.",
      mode: "walk",
      epsg: { x: 691_740, y: 5_335_360 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 190,
      pitchDeg: 3,
      fov: 62,
    },
    {
      id: "frauenkirche",
      label: "Frauenkirche",
      description:
        "Tiefer Anflug über die Fußgängerzone auf die beiden Kuppeltürme der Frauenkirche.",
      mode: "fly",
      epsg: { x: 691_150, y: 5_334_800 },
      aboveGround: 60,
      headingDeg: 71,
      pitchDeg: -6,
      fov: 62,
    },
    {
      id: "isar",
      label: "Isar",
      description:
        "Über der Isar, der Fluss teilt sich um die Museumsinsel mit dem Deutschen Museum.",
      mode: "fly",
      epsg: { x: 692_350, y: 5_333_100 },
      aboveGround: 90,
      headingDeg: 350,
      pitchDeg: -8,
      fov: 62,
    },
    {
      id: "altstadt-panorama",
      label: "Altstadt-Panorama",
      description:
        "Hoch über dem Maximilianeum, Blick über Isar und Maximilianstraße auf die Altstadt.",
      mode: "fly",
      epsg: { x: 693_250, y: 5_334_900 },
      aboveGround: 200,
      headingDeg: 270,
      pitchDeg: -8,
      fov: 60,
    },
  ],
};
