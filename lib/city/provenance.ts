/**
 * The provenance manifest the viewer reads: for each source the site draws
 * on, who publishes it under which licence, and — per tile — the edition
 * ("Stand") the committed data was made from. Derived at build time from
 * the site's `data/<site>/provenance.json` (the record of what was downloaded
 * when, with the queries and the URLs) by `scripts/prepare-data.ts`, and
 * published next to the tileset as `provenance.json`; the inquiry card
 * fetches it once, when first opened (ADR 0040). No THREE, no DOM.
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
  | "osm"
  | "trees";

export interface SourceInfo {
  /** the data's credit line, as its licence asks for it */
  credit: string;
  /** what the source is, in the HUD's language */
  label: string;
  /** the licence's short name */
  licence: string;
  /** site-wide edition where the source has one (the OSM extract's date) */
  stand?: string;
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
}

/** What the manifest needs to know of the site: whose data it is. */
export interface ProvenanceSite {
  provider: Pick<Provider, "credit" | "licence">;
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
  // "Stadtbäume: Landeshauptstadt Dresden, dl-de/by-2-0" → its holder and
  // licence; a site without a register names OSM's trees
  const register = site.treeCadastre?.credit.replace(/^[^:]*:\s*/, "");
  const osmStand = leadingDate(
    record.openstreetmap?.bbbike?.products?.osmBuildings?.dataAsOf
  );
  const treesStand = leadingDate(record.dresden?.Stadtbaumkataster?.retrieved);
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
    osm: {
      label: "OpenStreetMap",
      credit: "© OpenStreetMap-Mitwirkende",
      licence: "ODbL",
      ...(osmStand ? { stand: osmStand } : {}),
    },
    trees: register
      ? {
          label: "Stadtbaumkataster",
          credit: register,
          licence: register.split(", ").at(-1) ?? register,
          ...(treesStand ? { stand: treesStand } : {}),
        }
      : {
          label: "OpenStreetMap",
          credit: "© OpenStreetMap-Mitwirkende",
          licence: "ODbL",
        },
  };
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
  return { version: 1, sources, tiles: out };
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
