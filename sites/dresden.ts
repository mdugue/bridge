import { EYE_HEIGHT } from "@/lib/city/pose";
import { overlook, type Site } from "@/lib/city/site";

/** Landmarks the aerial vantages frame (EPSG:25833, from their WGS84 spots). */
const FRAUENKIRCHE = { x: 411_795, y: 5_656_346 };
const ALBERTPLATZ = { x: 412_170, y: 5_657_567 };
/** mid-terrace, above the Elbe between Schlossplatz and the Albertinum */
const BRUEHLSCHE_TERRASSE = { x: 411_800, y: 5_656_520 };
const ALAUNPARK = { x: 412_980, y: 5_658_390 };
/** between the Zwinger's courtyard and the Semperoper */
const ZWINGER = { x: 411_330, y: 5_656_560 };
/** Kunsthofpassage / Louisenstraße */
const AEUSSERE_NEUSTADT = { x: 412_720, y: 5_658_000 };
/** the Palais in the Großer Garten, the park's centre (its LoD2 extent) */
const PALAIS_GROSSER_GARTEN = { x: 413_262, y: 5_654_761 };
/** the Blaues Wunder's midspan (the LoD2 "Loschwitzer Brücke") */
const BLAUES_WUNDER = { x: 416_625, y: 5_656_449 };
/** the Waldschlößchenbrücke's midspan (the baked DLM bridge deck) */
const WALDSCHLOESSCHENBRUECKE = { x: 414_292, y: 5_657_618 };
/** the station's arched train shed (its LoD2 extent) */
const HAUPTBAHNHOF = { x: 411_066, y: 5_655_082 };

/**
 * Dresden either side of the Elbe, twelve of Saxony's 2 km tiles (GeoSN
 * open data, EPSG:25833): a 4×3 block from the Hauptbahnhof and the Großer
 * Garten in the south to the Neustadt in the north, and upriver past the
 * Waldschlößchenbrücke to Blasewitz, Loschwitz and the Blaues Wunder. The
 * spawn tile (the Elbe from the Carolabrücke to the Johannstadt) is the
 * second column of the middle row. The vantages are anchored to the baked
 * bridge centrelines and the DGM profile (the Elbe channel sits at ~104 m
 * between banks at ~114 m). The aerials over a landmark are framed with
 * `overlook`: the landmark sits under the crosshair.
 */
export const DRESDEN: Site = {
  id: "dresden",
  label: "Dresden · Altstadt",
  title: "City Walk — Dresden",
  epsg: 25_833,
  ingest: "sn",
  tileKm: 2,
  tileSuffix: "_sn",
  tiles: [
    { e: 412, n: 5656 },
    { e: 410, n: 5656 },
    { e: 410, n: 5658 },
    { e: 412, n: 5658 },
    // South: Hauptbahnhof, Großer Garten, Striesen
    { e: 410, n: 5654 },
    { e: 412, n: 5654 },
    { e: 414, n: 5654 },
    // East: Johannstadt, the Elbwiesen and the Waldschlößchenbrücke
    { e: 414, n: 5656 },
    { e: 414, n: 5658 },
    // The Blaues Wunder with Loschwitz, Blasewitz south of the bridge, and
    // the Loschwitz slope and the edge of the Dresdner Heide north of it
    { e: 416, n: 5656 },
    { e: 416, n: 5654 },
    { e: 416, n: 5658 },
  ],
  fallbackLatLng: { lat: 51.05, lng: 13.74 },
  attribution: [
    "Quelle: GeoSN, dl-de/by-2-0",
    "Lampen, Bänke, Brunnen, Mauern, Treppen, Plätze, Beläge, Bahnsteige und Brücken © OpenStreetMap-Mitwirkende (ODbL)",
  ],
  spawn: "altstadt",
  viewpoints: [
    // The start: low over the Elbe just west of the Carolabrücke, the whole
    // Altstadt skyline lined up across the river — Brühlsche Terrasse,
    // Frauenkirche, Hofkirche, Semperoper. The camera stands on the spawn
    // tile (the boot waits for that tile).
    {
      id: "altstadt",
      label: "Altstadt-Silhouette",
      description:
        "Der Startblick: tief über der Elbe, jenseits des Flusses die Altstadt von der Brühlschen Terrasse bis zur Semperoper.",
      mode: "fly",
      epsg: { x: 412_200, y: 5_656_800 },
      aboveGround: 40,
      headingDeg: 235,
      pitchDeg: -1.5,
      fov: 46,
    },
    overlook(FRAUENKIRCHE, {
      id: "frauenkirche",
      label: "Frauenkirche",
      description: "Von oben auf die Kuppel der Frauenkirche und den Neumarkt.",
      altitude: 190,
      headingDeg: 250,
      pitchDeg: -58,
    }),
    overlook(BRUEHLSCHE_TERRASSE, {
      id: "bruehlsche-terrasse",
      label: "Brühlsche Terrasse",
      description:
        "Über der Elbe auf den „Balkon Europas“, die Terrasse über dem Ufer.",
      altitude: 120,
      headingDeg: 190,
      pitchDeg: -28,
    }),
    overlook(ALBERTPLATZ, {
      id: "albertplatz",
      label: "Albertplatz",
      description:
        "Von oben auf den runden Platz; die Hauptstraße führt zur Altstadt.",
      altitude: 170,
      headingDeg: 205,
      pitchDeg: -45,
    }),
    overlook(ALAUNPARK, {
      id: "alaunpark",
      label: "Alaunpark",
      description: "Die große Wiese der Neustadt, von oben.",
      altitude: 190,
      headingDeg: 330,
      pitchDeg: -48,
    }),
    overlook(ZWINGER, {
      id: "zwinger",
      label: "Zwinger & Semperoper",
      description:
        "Über dem Theaterplatz: Semperoper, Zwinger und Hofkirche beisammen.",
      altitude: 150,
      headingDeg: 235,
      pitchDeg: -40,
    }),
    overlook(AEUSSERE_NEUSTADT, {
      id: "aeussere-neustadt",
      label: "Äußere Neustadt",
      description:
        "Tiefer Flug über die Gründerzeit-Blöcke rund um die Kunsthofpassage.",
      altitude: 80,
      headingDeg: 250,
      pitchDeg: -25,
    }),
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
    {
      id: "japanisches-palais",
      label: "Am Japanischen Palais",
      description:
        "Auf der Neustädter Elbwiese, wo Canaletto malte: Hofkirche und Frauenkirche jenseits des Flusses.",
      mode: "walk",
      epsg: { x: 411_455, y: 5_657_095 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 160,
      pitchDeg: 3,
      fov: 62,
    },
    {
      id: "neumarkt",
      label: "Neumarkt",
      description: "Auf dem Neumarkt, die Frauenkirche ragt vor dir auf.",
      mode: "walk",
      epsg: { x: 411_730, y: 5_656_240 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 32,
      pitchDeg: 10,
      fov: 66,
    },
    overlook(PALAIS_GROSSER_GARTEN, {
      id: "grosser-garten",
      label: "Großer Garten",
      description:
        "Über dem Palais im Großen Garten, dahinter der Palaisteich und die Baumkronen des Parks.",
      altitude: 250,
      headingDeg: 115,
      pitchDeg: -30,
    }),
    {
      id: "palais-grosser-garten",
      label: "Palais im Großen Garten",
      description:
        "Zu Fuß am Südende des Palaisteichs, jenseits des Wassers das barocke Palais in der Mitte des Parks.",
      mode: "walk",
      epsg: { x: 413_462, y: 5_654_605 },
      aboveGround: EYE_HEIGHT,
      headingDeg: 308,
      pitchDeg: 3,
      fov: 62,
    },
    overlook(BLAUES_WUNDER, {
      id: "blaues-wunder",
      label: "Blaues Wunder",
      description:
        "Über der Elbe flussabwärts der Brücke: das Blaue Wunder spannt sich von Blasewitz hinüber nach Loschwitz.",
      altitude: 60,
      headingDeg: 148,
      pitchDeg: -11,
      fov: 62,
    }),
    overlook(WALDSCHLOESSCHENBRUECKE, {
      id: "waldschloesschenbruecke",
      label: "Waldschlößchenbrücke",
      description:
        "Über den Elbwiesen oberhalb der Brücke, flussabwärts die Türme der Altstadt.",
      altitude: 60,
      headingDeg: 255,
      pitchDeg: -8,
      fov: 62,
    }),
    overlook(HAUPTBAHNHOF, {
      id: "hauptbahnhof",
      label: "Hauptbahnhof",
      description:
        "Von oben auf die Bahnsteighallen, die Prager Straße führt nach Norden zur Altstadt.",
      altitude: 180,
      headingDeg: 20,
      pitchDeg: -45,
    }),
  ],
};
