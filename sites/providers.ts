import type { Provider } from "@/lib/city/site";

/**
 * The data providers the sites draw on — one per Land — and what each
 * publishes openly. The fetch adapter for each is
 * pipeline/bake/providers/<id>.py. `products.lsc` is true where that
 * adapter fetches the laser scan — Saxony so far; NRW, Bavaria, Hamburg and
 * Berlin publish theirs openly too, but their adapters do not read them yet.
 */

/** Saxony: GeoSN. Everything open, 2 km tiles on our own grid. */
export const SAXONY: Provider = {
  id: "sn",
  name: "GeoSN (Landesamt für Geobasisinformation Sachsen)",
  epsg: 25_833,
  licence: "dl-de/by-2-0",
  credit: "Quelle: GeoSN, dl-de/by-2-0",
  portal: "https://www.geodaten.sachsen.de/",
  osm: "europe/germany/sachsen",
  products: { dom: true, dop: "rgbi", dlm: true, lsc: true },
  tileSuffix: "_sn",
};

/** North Rhine-Westphalia: Geobasis NRW. Everything open (dl-de/zero, no
 *  credit required — given anyway), 1 km downloads, DOP as RGBI JPEG 2000,
 *  the Basis-DLM as one 4.7 GB Shape package. */
export const NRW: Provider = {
  id: "nw",
  name: "Geobasis NRW (Bezirksregierung Köln)",
  epsg: 25_832,
  licence: "dl-de/zero-2-0",
  credit: "Geobasis NRW, dl-de/zero-2-0",
  portal: "https://www.opengeodata.nrw.de/produkte/geobasis/",
  osm: "europe/germany/nordrhein-westfalen",
  products: { dom: true, dop: "rgbi", dlm: true, lsc: false },
  tileSuffix: "_nw",
};

/** Bavaria: LDBV. CC BY 4.0; 1 km rasters, 2 km LoD2. No DOM1 — the
 *  photogrammetric DOM20 is averaged to 1 m; the open DOP20 is RGB only
 *  (the infrared needs a WMS export), so no NDVI. */
export const BAVARIA: Provider = {
  id: "by",
  name: "Bayerische Vermessungsverwaltung (LDBV)",
  epsg: 25_832,
  licence: "CC-BY-4.0",
  credit:
    "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0",
  portal: "https://geodaten.bayern.de/opengeodata/",
  osm: "europe/germany/bayern",
  products: { dom: true, dop: "rgb", dlm: true, lsc: false },
  tileSuffix: "_by",
};

/** Hamburg: LGV. Each product is one city-wide ZIP of 1 km tiles, read
 *  through range requests. The Basis-DLM is NAS only, so land cover comes
 *  from OSM. */
export const HAMBURG_LGV: Provider = {
  id: "hh",
  name: "Landesbetrieb Geoinformation und Vermessung Hamburg (LGV)",
  epsg: 25_832,
  licence: "dl-de/by-2-0",
  credit:
    "Freie und Hansestadt Hamburg, Landesbetrieb Geoinformation und Vermessung (LGV), dl-de/by-2-0",
  portal:
    "https://www.hamburg.de/bsw/landesbetrieb-geoinformation-und-vermessung/",
  osm: "europe/germany/hamburg",
  products: { dom: true, dop: "rgbi", dlm: false, lsc: false },
  tileSuffix: "_hh",
};

/** Berlin: SenSBW's Geoportal. dl-de/zero; INSPIRE ATOM feeds: DGM1 and
 *  DOM1 as 2 km XYZ, LoD2 as 1 km CityGML, TrueDOP as JPEG 2000 per
 *  district. The Basis-DLM is a WFS only, so land cover comes from OSM. */
export const BERLIN_SENSBW: Provider = {
  id: "be",
  name: "Senatsverwaltung für Stadtentwicklung Berlin (Geoportal Berlin)",
  epsg: 25_833,
  licence: "dl-de/zero-2-0",
  credit: "Geoportal Berlin, dl-de/zero-2-0",
  portal: "https://gdi.berlin.de/",
  osm: "europe/germany/berlin",
  products: { dom: true, dop: "rgbi", dlm: false, lsc: false },
  tileSuffix: "_be",
};
