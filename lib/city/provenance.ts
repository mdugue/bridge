/**
 * The provenance manifest the viewer reads: for each source the site draws
 * on, who publishes it under which licence, and — per tile — the edition
 * ("Stand") the committed data was made from. Derived at build time from
 * the site's `data/<site>/provenance.json` (the record of what was downloaded
 * when, with the queries and the URLs) by `scripts/prepare-data.ts`, and
 * published next to the tileset as `provenance.json`; the inquiry card
 * fetches it once, when first opened (ADR 0042). No THREE, no DOM.
 */

import type { Provider, TreeCadastre } from "./site";

/** The logical name the build publishes the manifest under. */
export const PROVENANCE_FILE = "provenance.json";

export type SourceKey =
  | "lod2"
  | "lsc"
  | "dgm"
  | "dom"
  | "dop"
  | "dlm"
  | "osm"
  | "trees"
  | "wikidata";

/** The OSM products the cards quote, each read from its own extract. */
export type OsmProduct = "bridges" | "buildings" | "fountains" | "trees";

export interface SourceInfo {
  /** the data's credit line, as its licence asks for it */
  credit: string;
  /** what the source is, in the HUD's language */
  label: string;
  /** the licence's short name */
  licence: string;
  /** site-wide edition where the source has one (the OSM extract's date) */
  stand?: string;
  /** OSM: the edition of each product a card quotes, where it differs */
  stands?: Partial<Record<OsmProduct, string>>;
}

/** A LoD2 model's edition, split: the model year and its inputs' years. */
export interface Lod2Stand {
  /** input → year, e.g. { LSC: "2016", "Basis-DLM": "2022" } */
  inputs: Record<string, string>;
  model: string;
}

export interface SiteProvenance {
  sources: Record<SourceKey, SourceInfo>;
  /** tile id → source → edition of that tile's data */
  tiles: Record<string, Partial<Record<SourceKey, string>>>;
  version: 1;
}

/** The parts of `data/<site>/provenance.json` the manifest reads (a GeoSN
 *  site's record carries per-tile editions; others' only the provider). */
export interface ProvenanceRecord {
  dresden?: { Stadtbaumkataster?: { retrieved?: string } };
  geosn?: Record<string, { tiles?: Record<string, { stand?: string }> }>;
  openstreetmap?: {
    bbbike?: { products?: Record<string, { dataAsOf?: string }> };
  };
  wikidata?: { dataAsOf?: string };
}

/** The record's product behind each OSM product a card quotes. */
const OSM_PRODUCTS: [OsmProduct, string][] = [
  ["buildings", "osmBuildings"],
  ["bridges", "bridges"],
  ["fountains", "fountains"],
  ["trees", "trees"],
];

/** What the manifest needs to know of the site: whose data it is. */
export interface ProvenanceSite {
  provider: Pick<Provider, "credit" | "licence" | "products">;
  treeCadastre?: TreeCadastre;
}

/** The GeoSN product behind each per-tile source. */
const GEOSN_PRODUCTS: [SourceKey, string][] = [
  ["lod2", "LoD2"],
  ["lsc", "LSC"],
  ["dgm", "DGM1"],
  ["dom", "DOM1"],
  ["dop", "DOP_RGBI"],
];

/** The leading ISO date of a free-text field ("2026-09-26 (first …)"). */
export function leadingDate(text: string | undefined): string | undefined {
  return /^\d{4}-\d{2}-\d{2}/.exec(text ?? "")?.[0];
}

/** Each OSM product's edition the record states. */
function osmStands(
  products: Record<string, { dataAsOf?: string }> | undefined
): Partial<Record<OsmProduct, string>> {
  const stands: Partial<Record<OsmProduct, string>> = {};
  for (const [product, name] of OSM_PRODUCTS) {
    const stand = leadingDate(products?.[name]?.dataAsOf);
    if (stand) {
      stands[product] = stand;
    }
  }
  return stands;
}

/** The trees' source: the site's register by its holder and licence
 *  ("Stadtbäume: Landeshauptstadt Dresden, dl-de/by-2-0"), else OSM's. */
function treesSource(
  site: ProvenanceSite,
  record: ProvenanceRecord
): SourceInfo {
  const register = site.treeCadastre?.credit.replace(/^[^:]*:\s*/, "");
  if (!register) {
    return {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
    };
  }
  const stand = leadingDate(record.dresden?.Stadtbaumkataster?.retrieved);
  return {
    label: "Stadtbaumkataster",
    credit: register,
    licence: register.split(", ").at(-1) ?? register,
    ...(stand ? { stand } : {}),
  };
}

/** Each tile's editions, where the record carries them (GeoSN's rows). */
function tileEditions(
  record: ProvenanceRecord,
  tiles: readonly string[]
): SiteProvenance["tiles"] {
  const out: SiteProvenance["tiles"] = {};
  for (const tile of tiles) {
    const row: Partial<Record<SourceKey, string>> = {};
    for (const [key, product] of GEOSN_PRODUCTS) {
      const stand = record.geosn?.[product]?.tiles?.[tile]?.stand;
      if (stand) {
        row[key] = stand;
      }
    }
    out[tile] = row;
  }
  return out;
}

/**
 * The manifest for `tiles` from the provenance record. The OSM building
 * facts (shops, heritage, names, addresses, storeys) are the product the
 * inquiry card quotes, so the OSM edition is theirs. Credits and licences
 * are the site's provider's (and its tree register's).
 */
export function siteProvenance(
  record: ProvenanceRecord,
  tiles: readonly string[],
  site: ProvenanceSite
): SiteProvenance {
  const official = site.provider.credit;
  const licence = site.provider.licence;
  const products = record.openstreetmap?.bbbike?.products;
  const osmStand = leadingDate(products?.osmBuildings?.dataAsOf);
  const stands = osmStands(products);
  const wikidataStand = leadingDate(record.wikidata?.dataAsOf);
  const osm: SourceInfo = {
    label: "OpenStreetMap",
    credit: "© OpenStreetMap-Mitwirkende",
    licence: "ODbL",
    ...(osmStand ? { stand: osmStand } : {}),
    stands,
  };
  const sources: Record<SourceKey, SourceInfo> = {
    lod2: { label: "3D-Stadtmodell LoD2", credit: official, licence },
    lsc: { label: "Laserscan", credit: official, licence },
    dgm: {
      label: "Digitales Geländemodell DGM1",
      credit: official,
      licence,
    },
    dom: {
      label: "Digitales Oberflächenmodell DOM1",
      credit: official,
      licence,
    },
    dop: { label: "Digitales Orthophoto", credit: official, licence },
    // a provider without a Basis-DLM (Hamburg, Berlin) has OSM in its
    // place: the land cover, rails and bridge areas (ADR 0039)
    dlm: site.provider.products.dlm
      ? { label: "Basis-DLM", credit: official, licence }
      : osm,
    osm,
    wikidata: {
      // CC0 asks for no credit; the licence is the line's last word
      label: "Wikidata",
      credit: "CC0",
      licence: "CC0",
      ...(wikidataStand ? { stand: wikidataStand } : {}),
    },
    trees: treesSource(site, record),
  };
  return { version: 1, sources, tiles: tileEditions(record, tiles) };
}

/**
 * A LoD2 edition as GeoSN states it, "2024 (LSC: 2016, Basis-DLM: 2022,
 * DGM: 2016)": the model's production year and the currency of its inputs
 * (the laser scan the roofs were measured in, the footprints' Basis-DLM).
 */
export function parseLod2Stand(stand: string): Lod2Stand {
  const match = /^\s*([^()]+?)\s*(?:\((.*)\))?\s*$/.exec(stand);
  const inputs: Record<string, string> = {};
  for (const part of (match?.[2] ?? "").split(",")) {
    const [key, value] = part.split(":").map((s) => s.trim());
    if (key && value) {
      inputs[key] = value;
    }
  }
  return { model: match?.[1] ?? stand, inputs };
}

/** Whether a fetched manifest is one this viewer reads. */
export function isSiteProvenance(value: unknown): value is SiteProvenance {
  const v = value as Partial<SiteProvenance> | null;
  return (
    v?.version === 1 &&
    typeof v.sources === "object" &&
    v.sources !== null &&
    typeof v.tiles === "object" &&
    v.tiles !== null
  );
}
