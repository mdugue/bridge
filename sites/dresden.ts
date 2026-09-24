import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";

/**
 * Dresden, Altstadt and Neustadt either side of the Elbe: a 2×2 block of
 * Saxony's 2 km tiles (GeoSN open data, EPSG:25833), spawning on the south-
 * east one. The vantages are anchored to the baked bridge centrelines and
 * the DGM profile (the Elbe channel sits at ~104 m between banks at
 * ~114 m).
 */
export const DRESDEN: Site = {
  id: "dresden",
  label: "Dresden · Altstadt",
  title: "City Walk — Dresden",
  epsg: 25_833,
  ingest: "sn",
  trees: "dresden",
  tileKm: 2,
  tileSuffix: "_sn",
  tiles: [
    { e: 412, n: 5656 },
    { e: 410, n: 5656 },
    { e: 410, n: 5658 },
    { e: 412, n: 5658 },
  ],
  fallbackLatLng: { lat: 51.05, lng: 13.74 },
  attribution: [
    "Quelle: GeoSN, dl-de/by-2-0",
    "Lampen, Mauern, Hecken, Bahnsteige und Brücken © OpenStreetMap-Mitwirkende (ODbL)",
    "Stadtbäume: Landeshauptstadt Dresden, dl-de/by-2-0",
  ],
  viewpoints: [
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
  ],
};
