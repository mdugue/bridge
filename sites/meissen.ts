import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { SAXONY } from "./providers";

/**
 * Meißen: one GeoSN tile holds the Burgberg with Albrechtsburg and Dom,
 * the old town below it, the Altstadtbrücke and the right bank of the
 * Elbe. Walk views stay off the bridge (the DGM has no deck).
 */
export const MEISSEN: Site = {
  id: "meissen",
  label: "Meißen · Burgberg",
  name: "Meißen",
  provider: SAXONY,
  spawn: "elbufer",
  tiles: [{ e: 392, n: 5668 }],
  fallbackLatLng: { lat: 51.16, lng: 13.47 },
  viewpoints: [
    {
      id: "elbufer",
      label: "Elbufer",
      description:
        "Auf der Elbwiese am rechten Ufer, drüben thronen Albrechtsburg und Dom über dem Fluss.",
      mode: "walk",
      epsg: { x: 393_505, y: 5_669_320 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 292,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "elbe-aerial",
      label: "Über der Elbe",
      description:
        "Über dem Strom vor dem Burgberg, der Felsen trägt Schloss und Dom.",
      mode: "fly",
      epsg: { x: 393_750, y: 5_669_650 },
      aboveGround: 80,
      headingDeg: 254,
      pitchDeg: -8,
      fov: 62,
    },
    {
      id: "domplatz",
      label: "Domplatz",
      description:
        "Oben auf dem Domplatz, die gotischen Westtürme des Doms ragen vor dir auf.",
      mode: "walk",
      epsg: { x: 393_050, y: 5_669_410 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 81,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "markt",
      label: "Markt",
      description:
        "Auf dem kleinen Markt, die Frauenkirche mit dem Porzellanglockenspiel gleich nebenan.",
      mode: "walk",
      epsg: { x: 393_066, y: 5_669_085 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 221,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "burgberg",
      label: "Burgberg",
      description:
        "Hoch über der Altstadt, Blick über die Dächer hinauf zum Burgberg.",
      mode: "fly",
      epsg: { x: 393_350, y: 5_668_650 },
      aboveGround: 160,
      headingDeg: 344,
      pitchDeg: -12,
      fov: 60,
    },
  ],
};
