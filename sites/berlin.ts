import { EYE_HEIGHT } from "@/lib/city/pose";
import type { Site } from "@/lib/city/site";
import { BERLIN_SENSBW } from "./providers";

/**
 * Berlin-Mitte from the Tiergarten to the Alexanderplatz: a 3×2 block on
 * our grid — Brandenburger Tor, Reichstag, Unter den Linden, Museumsinsel,
 * Dom and Humboldt Forum, and in the east column Fernsehturm and
 * Alexanderplatz. Spawns at the Tor.
 */
export const BERLIN: Site = {
  id: "berlin",
  label: "Berlin · Mitte",
  name: "Berlin",
  provider: BERLIN_SENSBW,
  start: "pariser-platz",
  tiles: [
    { e: 390, n: 5818 },
    { e: 388, n: 5818 },
    { e: 392, n: 5818 },
    { e: 388, n: 5820 },
    { e: 390, n: 5820 },
    { e: 392, n: 5820 },
  ],
  fallbackLatLng: { lat: 52.52, lng: 13.4 },
  viewpoints: [
    {
      id: "pariser-platz",
      label: "Pariser Platz",
      description:
        "Auf dem Pariser Platz, vor dir die Säulen des Brandenburger Tors.",
      mode: "walk",
      epsg: { x: 390_030, y: 5_819_705 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 267,
      pitchDeg: 3,
      fov: 62,
    },
    {
      id: "lustgarten",
      label: "Lustgarten",
      description:
        "Im Lustgarten auf der Museumsinsel, die grüne Kuppel des Doms über dem Rasen.",
      mode: "walk",
      epsg: { x: 391_360, y: 5_819_900 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 63,
      pitchDeg: 4,
      fov: 62,
    },
    {
      id: "alexanderplatz",
      label: "Alexanderplatz",
      description:
        "An der Weltzeituhr auf dem Alexanderplatz, über dir der Fernsehturm.",
      mode: "walk",
      epsg: { x: 392_365, y: 5_820_270 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 248,
      pitchDeg: 12,
      fov: 62,
    },
    {
      id: "reichstag",
      label: "Reichstag",
      description:
        "Über dem Spreebogen, die gläserne Kuppel des Reichstags voraus.",
      mode: "fly",
      epsg: { x: 390_100, y: 5_820_250 },
      aboveGround: 80,
      headingDeg: 225,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "museumsinsel",
      label: "Museumsinsel",
      description:
        "Über der Spree, die Museumsinsel zieht zum Dom und zum Humboldt Forum.",
      mode: "fly",
      epsg: { x: 390_800, y: 5_820_500 },
      aboveGround: 120,
      headingDeg: 126,
      pitchDeg: -10,
      fov: 62,
    },
    {
      id: "tiergarten-panorama",
      label: "Tiergarten",
      description:
        "Hoch über dem Tiergarten, Blick die Achse entlang zum Brandenburger Tor und nach Mitte.",
      mode: "fly",
      epsg: { x: 388_600, y: 5_819_600 },
      aboveGround: 200,
      headingDeg: 86,
      pitchDeg: -8,
      fov: 60,
    },
  ],
};
