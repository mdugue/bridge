import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { SAXONY } from "./providers";

/**
 * Leipzig's old town inside the Ring and the Südvorstadt below it: a 2×2
 * block of GeoSN tiles, spawning on the centre (Markt, Nikolai- and
 * Thomaskirche, Augustusplatz). The Völkerschlachtdenkmal lies 270 m south
 * of the block. Landmarks from OSM footprints; headings point camera →
 * subject.
 */
export const LEIPZIG: Site = {
  id: "leipzig",
  label: "Leipzig · Innenstadt",
  name: "Leipzig",
  provider: SAXONY,
  start: "markt",
  tiles: [
    { e: 316, n: 5690 },
    { e: 318, n: 5690 },
    { e: 316, n: 5688 },
    { e: 318, n: 5688 },
  ],
  fallbackLatLng: { lat: 51.34, lng: 12.37 },
  viewpoints: [
    {
      id: "markt",
      label: "Markt",
      description:
        "Zu Fuß auf dem Markt, vor dir die lange Renaissancefront des Alten Rathauses.",
      mode: "walk",
      epsg: { x: 317_125, y: 5_690_960 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 100,
      pitchDeg: 4,
      fov: 62,
    },
    {
      id: "augustusplatz",
      label: "Augustusplatz",
      description:
        "Am Opernbrunnen über den weiten Platz, Gewandhaus und City-Hochhaus im Süden.",
      mode: "walk",
      epsg: { x: 317_600, y: 5_690_870 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 219,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "thomaskirche",
      label: "Thomaskirche",
      description:
        "Tiefer Anflug über den Ring auf Bachs Thomaskirche mit ihrem steilen Dach.",
      mode: "fly",
      epsg: { x: 316_750, y: 5_690_650 },
      aboveGround: 60,
      headingDeg: 53,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "hauptbahnhof",
      label: "Über dem Hauptbahnhof",
      description:
        "Über den Gleishallen des Hauptbahnhofs, der Blick fällt über die Innenstadt zur Nikolaikirche.",
      mode: "fly",
      epsg: { x: 317_700, y: 5_691_850 },
      aboveGround: 120,
      headingDeg: 197,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "innenstadt-panorama",
      label: "Innenstadt-Panorama",
      description:
        "Hoch über der Südvorstadt, Blick über Neues Rathaus und Ring auf die ganze Innenstadt.",
      mode: "fly",
      epsg: { x: 317_250, y: 5_689_700 },
      aboveGround: 220,
      headingDeg: 357,
      pitchDeg: -12,
      fov: 60,
    },
  ],
};
