/**
 * The GeoJSON feature shapes the offline bakes write (pipeline/bake/)
 * and the layers read — the one contract between data/dlm and the viewer.
 * features.test.ts checks every committed file against it, so a bake that
 * changes a property name fails there, not as an empty layer in the browser.
 *
 * GeoJSON allows `"properties": null`, so properties are nullable and every
 * read goes through `?.`: one odd feature must never throw out of a layer's
 * documented non-fatal load. Coordinates are EPSG:25833, never recentered.
 * No THREE, no DOM.
 */
import type { Point2 } from "./polyline";

export interface LineGeometry {
  coordinates: Point2[];
  type: "LineString";
}

export interface PointGeometry {
  coordinates: Point2;
  type: "Point";
}

export interface PolygonGeometry {
  coordinates: Point2[][];
  type: "Polygon";
}

export interface MultiPolygonGeometry {
  coordinates: Point2[][][];
  type: "MultiPolygon";
}

/** A `FeatureCollection` as the loaders read it (only `features` matters). */
export interface FeatureCollection<F> {
  features?: F[];
}

/** ATKIS veg04 hedges and tree rows (pipeline/bake/landcover.py). */
export interface VegRowFeature {
  geometry: LineGeometry;
  properties: { kind: "hedge" | "treerow" } | null;
}

/** DOM1-derived canopy points with the measured tree height (pipeline/bake/canopy.py). */
export interface CanopyFeature {
  geometry: PointGeometry;
  properties: { h: number } | null;
}

/**
 * Individually surveyed trees — the Dresden street-tree cadastre
 * (pipeline/bake/trees.py, dl-de/by-2-0 "Landeshauptstadt Dresden"). Heights and
 * crown diameters in metres (imputed in the bake where the cadastre has
 * none); `a` is the archetype id (lib/city/tree-inventory.ts
 * TREE_ARCHETYPES), `l` the leaf type ("e" evergreen, "d" deciduous), `c` a
 * foliage colour (1 purple, 2 golden; absent = green), `g` = 1 marks a globe
 * cultivar, `f` = 1 a tree standing in DLM forest/copse (it vetoes no
 * canopy tree — lib/city/tree-inventory.ts).
 */
export interface TreeFeature {
  geometry: PointGeometry;
  properties: {
    a: number;
    c?: number;
    d: number;
    f?: number;
    g?: number;
    h: number;
    l: "d" | "e";
  } | null;
}

/** Laser-scan crown peaks outside the canopy mask (pipeline/bake/lowveg.py),
 *  already thinned against the street-tree cadastre: a canopy point plus
 *  the crown radius, so it drops into the tree layer. */
export interface CanopyExtraFeature extends CanopyFeature {
  properties: { h: number; r: number } | null;
}

/**
 * Hedges (pipeline/bake/lowveg.py): the OSM `barrier=hedge` lines with their height
 * and width in metres. `src` says where the height came from — "osm+lsc"
 * (the GeoSN laser scan measured it) or "osm" (the tag, or a default).
 */
export interface LowVegFeature {
  geometry: LineGeometry;
  properties: {
    h: number;
    kind: "hedge";
    src: LowVegSource;
    w: number;
  } | null;
}

export type LowVegSource = "osm" | "osm+lsc";

/** OSM street lamps (pipeline/bake/lamps.py, ODbL); the post height is a
 *  lamp-layer constant, so no property is read. */
export interface LampFeature {
  geometry: PointGeometry;
  properties: Record<string, unknown> | null;
}

/** OSM retaining/city walls (pipeline/bake/walls.py, ODbL): the barrier/man_made
 *  kind (only retaining kinds reshape the terrain) and the height in metres. */
export interface WallFeature {
  geometry: LineGeometry;
  properties: { h: number; kind: string } | null;
}

/** Basis-DLM ver03_l railway centrelines (pipeline/bake/rail.py). */
export interface RailFeature {
  geometry: LineGeometry;
  properties: { electrified?: number; tracks?: number } | null;
}

/** Basis-DLM ver06_f bridge decks with the DGM/DOM1-derived deck heights. */
export interface BridgeFeature {
  geometry: PolygonGeometry;
  properties: {
    /** deck elevation (m) per outer-ring vertex */
    deck?: number[];
    kind?: "other" | "path" | "rail" | "road";
    name?: string | null;
    /** OSM bridge:structure (e.g. "arch", "beam", "beam;arch") for arch synthesis */
    structure?: string | null;
  } | null;
}

/** Dissolved ballast yards (Basis-DLM ver03_f) and OSM platforms (ODbL). */
export interface AreaFeature {
  geometry: LineGeometry | MultiPolygonGeometry | PolygonGeometry | null;
  properties: Record<string, unknown> | null;
}
