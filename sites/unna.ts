import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { NRW } from "./providers";

/**
 * Unna's old town on the Hellweg: two tiles on our grid (Geobasis NRW's
 * downloads are 1 km) — Markt, Evangelische Stadtkirche, Burg with the
 * Hellweg-Museum, the Lindenbrauerei.
 */
export const UNNA: Site = {
  id: "unna",
  label: "Unna · Altstadt",
  name: "Unna",
  provider: NRW,
  osm: "europe/germany/nordrhein-westfalen/arnsberg-regbez",
  start: "kirchplatz",
  tiles: [
    { e: 408, n: 5710 },
    { e: 408, n: 5708 },
  ],
  fallbackLatLng: { lat: 51.53, lng: 7.69 },
  viewpoints: [
    {
      id: "kirchplatz",
      label: "Kirchplatz",
      description:
        "Auf dem Kirchplatz, vor dir der Westturm der Evangelischen Stadtkirche.",
      mode: "walk",
      epsg: { x: 409_185, y: 5_710_127 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 92,
      pitchDeg: 5,
      fov: 62,
    },
    {
      id: "lindenbrauerei",
      label: "Lindenbrauerei",
      description:
        "Auf dem Platz der Kulturen vor der alten Lindenbrauerei mit ihrem Schlot.",
      mode: "walk",
      epsg: { x: 408_800, y: 5_710_193 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 192,
      pitchDeg: 4,
      fov: 62,
    },
    {
      id: "altstadt-aerial",
      label: "Altstadt",
      description:
        "Über den Wällen im Südwesten, Blick über die Dächer zur Stadtkirche.",
      mode: "fly",
      epsg: { x: 408_900, y: 5_709_800 },
      aboveGround: 80,
      headingDeg: 47,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "ueber-unna",
      label: "Über Unna",
      description:
        "Hoch über der Nordstadt, Blick über Rathaus und Burg auf die ganze Altstadt.",
      mode: "fly",
      epsg: { x: 409_350, y: 5_711_000 },
      aboveGround: 180,
      headingDeg: 186,
      pitchDeg: -12,
      fov: 60,
    },
    {
      id: "burg",
      label: "Burg",
      description:
        "Tiefer Anflug von Osten auf die Burg mit dem Hellweg-Museum.",
      mode: "fly",
      epsg: { x: 409_600, y: 5_710_400 },
      aboveGround: 40,
      headingDeg: 258,
      pitchDeg: -6,
      fov: 62,
    },
  ],
};
