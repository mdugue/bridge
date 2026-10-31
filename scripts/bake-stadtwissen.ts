/**
 * The Stadtwissen (lib/city/stadtwissen.ts) from files the build already
 * reads: per tile, the directory of its named, addressed, listed and
 * landmark Buildings — the LoD2 Building (its parts folded in) with its
 * use, roof form and measured height, what OSM says of its outline — and
 * the named monuments, fountains and stones of the Basis-DLM and OSM — and
 * the site's index: the landmarks with the committed Wikidata excerpt, the
 * sources, the tiles' files. Run by prepare-data.ts, which publishes it.
 */
import { BUILDING_FUNCTION, ROOF_TYPE } from "../lib/city/adv-codes";
import type { OsmBuildingFacts } from "../lib/city/city-mesh";
import type { LandmarkFile } from "../lib/city/landmarks";
import type { SourceInfo } from "../lib/city/provenance";
import type {
  StadtwissenIndex,
  WikidataFile,
  WissenBuilding,
  WissenLandmark,
  WissenMonument,
  WissenSource,
  WissenTile,
} from "../lib/city/stadtwissen";

interface CityObject {
  attributes?: Record<string, unknown>;
  children?: string[];
  geographicalExtent?: number[];
  geometry?: { boundaries: unknown }[];
  parents?: string[];
  type: string;
}

/** The parts of a CityJSON file the directory reads. */
interface CityFile {
  CityObjects: Record<string, CityObject>;
  transform?: { scale: number[]; translate: number[] };
  vertices?: number[][];
}

/** Every vertex index in a geometry's nested boundaries. */
function boundaryIndices(b: unknown, out: number[]): void {
  if (typeof b === "number") {
    out.push(b);
  } else if (Array.isArray(b)) {
    for (const x of b) {
      boundaryIndices(x, out);
    }
  }
}

/** A Building's extent [minX, minY, minZ, maxX, maxY, maxZ] in the data's
 *  CRS: its own `geographicalExtent`, else the box of its and its parts'
 *  vertices (Hamburg's, München's and Unna's files carry no extent). */
function extentOf(obj: CityObject, city: CityFile): number[] | undefined {
  if (obj.geographicalExtent) {
    return obj.geographicalExtent;
  }
  const indices: number[] = [];
  for (const o of [
    obj,
    ...(obj.children ?? []).map((c) => city.CityObjects[c]),
  ]) {
    for (const g of o?.geometry ?? []) {
      boundaryIndices(g.boundaries, indices);
    }
  }
  const vertices = city.vertices ?? [];
  const scale = city.transform?.scale ?? [1, 1, 1];
  const shift = city.transform?.translate ?? [0, 0, 0];
  const ext = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const i of indices) {
    const v = vertices[i];
    if (!v) {
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const c = v[k] * scale[k] + shift[k];
      ext[k] = Math.min(ext[k], c);
      ext[k + 3] = Math.max(ext[k + 3], c);
    }
  }
  return Number.isFinite(ext[0]) ? ext : undefined;
}

/** What OSM's per-object file says (osm_buildings.py; values as strings). */
type OsmRow = Partial<Record<keyof OsmBuildingFacts, string | number>>;

const round1 = (n: number) => Math.round(n * 10) / 10;

function positive(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A Building's OSM facts: its own, then its parts' (the first that has one). */
function osmOf(
  id: string,
  obj: CityObject,
  osm: Readonly<Record<string, OsmRow | undefined>>
): OsmRow {
  const rows = [osm[id], ...(obj.children ?? []).map((c) => osm[c])].filter(
    (r): r is OsmRow => r !== undefined
  );
  const out: OsmRow = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      out[k as keyof OsmRow] ??= v;
    }
  }
  return out;
}

/** The tallest measured height of a Building or its parts. */
function heightOf(
  obj: CityObject,
  all: Readonly<Record<string, CityObject>>,
  ext: number[]
): number | undefined {
  const own = positive(obj.attributes?.measuredHeight);
  const parts = (obj.children ?? [])
    .map((c) => positive(all[c]?.attributes?.measuredHeight))
    .filter((h): h is number => h !== undefined);
  const top = Math.max(own ?? 0, ...parts);
  if (top > 0) {
    return round1(top);
  }
  return positive(round1(ext[5] - ext[2]));
}

function roofOf(
  obj: CityObject,
  all: Readonly<Record<string, CityObject>>
): string | undefined {
  const code =
    obj.attributes?.roofType ??
    (obj.children ?? [])
      .map((c) => all[c]?.attributes?.roofType)
      .find((r) => r !== undefined);
  return code === undefined ? undefined : ROOF_TYPE[attributeText(code)];
}

/** A CityJSON attribute as a code-list key ("" for anything not a code). */
const attributeText = (v: unknown): string =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";

/** A Building of the directory, or undefined when nothing names it. */
function directoryEntry(
  id: string,
  obj: CityObject,
  city: CityFile,
  row: OsmRow,
  wd: string | undefined
): WissenBuilding | undefined {
  const all = city.CityObjects;
  const name = row.name ? String(row.name) : undefined;
  const addr = row.addr ? String(row.addr) : undefined;
  const heritage = Number(row.heritage) > 0;
  if (!(name || addr || heritage || wd)) {
    return undefined;
  }
  const ext = extentOf(obj, city);
  if (!ext) {
    return undefined;
  }
  const use = BUILDING_FUNCTION[attributeText(obj.attributes?.function)];
  const roof = roofOf(obj, all);
  const h = heightOf(obj, all, ext);
  const levels = positive(row.levels);
  return {
    id,
    ...(name ? { name } : {}),
    ...(addr ? { addr } : {}),
    x: round1((ext[0] + ext[3]) / 2),
    y: round1((ext[1] + ext[4]) / 2),
    z: round1(ext[2]),
    ...(h ? { h } : {}),
    ...(use ? { use } : {}),
    ...(roof ? { roof } : {}),
    ...(levels ? { levels: Math.round(levels) } : {}),
    ...(heritage ? { heritage: true as const } : {}),
    ...(Number(row.shop) > 0 ? { shop: true as const } : {}),
    ...(wd ? { wd } : {}),
  };
}

/** A tile's monuments file (pipeline/bake/monuments.py), as far as read. */
export interface MonumentCollection {
  features: {
    geometry: { coordinates: unknown; type: string };
    properties: {
      kind?: string;
      material?: string;
      name?: string;
      wikidata?: string;
    };
  }[];
}

/** A point of a Point or the first vertex's ring centre of a Polygon. */
function anchorOf(geometry: {
  coordinates: unknown;
  type: string;
}): [number, number] | undefined {
  if (geometry.type === "Point") {
    return geometry.coordinates as [number, number];
  }
  if (geometry.type === "Polygon") {
    const ring = (geometry.coordinates as [number, number][][])[0] ?? [];
    if (ring.length === 0) {
      return undefined;
    }
    const sx = ring.reduce((a, p) => a + p[0], 0);
    const sy = ring.reduce((a, p) => a + p[1], 0);
    return [sx / ring.length, sy / ring.length];
  }
  return undefined;
}

/** The tile's named monuments. */
export function monumentsOf(
  file: MonumentCollection | undefined
): WissenMonument[] {
  const out: WissenMonument[] = [];
  for (const f of file?.features ?? []) {
    const { name, kind, material, wikidata } = f.properties;
    const at = anchorOf(f.geometry);
    if (!(name && at)) {
      continue;
    }
    out.push({
      id: `m${Math.round(at[0])}_${Math.round(at[1])}`,
      name,
      kind: kind ?? "",
      x: round1(at[0]),
      y: round1(at[1]),
      ...(material ? { material } : {}),
      ...(wikidata ? { wd: wikidata } : {}),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * One tile's directory: every root Building OSM names or addresses, that
 * is listed, or that is part of a landmark — its parts folded into it.
 */
export function stadtwissenTile(input: {
  city: CityFile;
  landmarks?: LandmarkFile;
  monuments?: MonumentCollection;
  osm: Readonly<Record<string, OsmRow | undefined>>;
  tile: string;
}): WissenTile {
  const all = input.city.CityObjects;
  const landmarkOf = new Map<string, string>();
  for (const lm of input.landmarks?.landmarks ?? []) {
    for (const o of lm.objects) {
      const root = all[o]?.parents?.[0] ?? o;
      landmarkOf.set(root, landmarkOf.get(root) ?? lm.id);
    }
  }
  const buildings: WissenBuilding[] = [];
  for (const [id, obj] of Object.entries(all)) {
    if (obj.type !== "Building") {
      continue;
    }
    const entry = directoryEntry(
      id,
      obj,
      input.city,
      osmOf(id, obj, input.osm),
      landmarkOf.get(id)
    );
    if (entry) {
      buildings.push(entry);
    }
  }
  buildings.sort((a, b) => a.id.localeCompare(b.id));
  return {
    tile: input.tile,
    buildings,
    monuments: monumentsOf(input.monuments),
  };
}

/** The site's index: its landmarks with Wikidata's facts, its sources. */
export function stadtwissenIndex(input: {
  epsg: number;
  landmarks: readonly { file: LandmarkFile; tile: string }[];
  site: string;
  sources: Partial<Record<WissenSource, SourceInfo>>;
  tiles: StadtwissenIndex["tiles"];
  wikidata?: WikidataFile;
}): StadtwissenIndex {
  const seen = new Set<string>();
  const landmarks: WissenLandmark[] = [];
  for (const { file, tile } of input.landmarks) {
    for (const lm of file.landmarks) {
      if (seen.has(lm.id)) {
        continue;
      }
      seen.add(lm.id);
      const facts = input.wikidata?.entities[lm.id];
      landmarks.push({
        id: lm.id,
        name: lm.name,
        tile,
        x: lm.x,
        y: lm.y,
        ...(lm.z === undefined ? {} : { z: lm.z }),
        h: round1(Math.max(lm.h ?? 0, lm.height ?? 0)),
        links: lm.links,
        objects: lm.objects,
        ...(facts ? { facts } : {}),
      });
    }
  }
  landmarks.sort((a, b) => b.links - a.links || a.id.localeCompare(b.id));
  return {
    site: input.site,
    epsg: input.epsg,
    sources: input.sources,
    tiles: input.tiles,
    landmarks,
  };
}
