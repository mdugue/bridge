/**
 * The GeoJSON feature shapes the offline bakes write (scripts/extract-*.sh)
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
 * (pipeline/bake/trees.py, dl-de/by-2-0 "Landeshauptstadt Dresden"). Heights
 * and crown diameters in metres (imputed in the bake where the cadastre has
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
 * Hedges (pipeline/bake/lowveg.py): the OSM `barrier=hedge` lines with their
 * height and width in metres. `src` says where the height came from —
 * "osm+lsc" (the GeoSN laser scan measured it) or "osm" (the tag, or a
 * default).
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

/** The street furniture the bake keeps (pipeline/bake/furniture.py). */
export type FurnitureKind =
  | "bench"
  | "bike"
  | "bin"
  | "bollard"
  | "clock"
  | "column"
  | "hydrant"
  | "hydrantsign"
  | "picnic"
  | "postbox"
  | "shelter"
  | "signal"
  | "stop"
  | "wallclock"
  | "water"
  | PlaygroundKind;

/** A playground outline and the equipment OSM maps on it (`playground=*`). */
export type PlaygroundKind =
  | "climb"
  | "playground"
  | "playhouse"
  | "roundabout"
  | "sandpit"
  | "seesaw"
  | "slide"
  | "springy"
  | "swing";

/**
 * OSM street furniture (pipeline/bake/furniture.py, ODbL): benches, picnic
 * tables, litter bins, bicycle stands, bollards, post boxes and stop
 * shelters, each a Point, and playgrounds: the outline (a Polygon, `k:
 * playground`) and each mapped piece of equipment (a Point; a sandpit may be
 * its Polygon). `a` is the bearing the object faces (degrees clockwise from
 * north: OSM's `direction`, else towards the nearest way), absent on round
 * things; `l` a bench's mapped length (m), `n` a stand's hoops, `back:
 * false` a bench without a backrest; `h` a bollard's tagged height (m) and
 * `metal` its material. Since plan 030 also advertising columns (`column`,
 * `lit` when OSM says so), traffic signals (`signal`, at the kerb, facing
 * the traffic they control), fire hydrants (`hydrant`: a pillar;
 * `hydrantsign`: the sign plate of an underground one), clocks (`clock` on
 * a pole, `wallclock` on a facade — the point on the wall, `a` out of it),
 * drinking fountains (`water`) and the "H" sign of a bus stop without a
 * shelter (`stop`).
 */
export interface FurnitureFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: {
    a?: number;
    back?: boolean;
    h?: number;
    k: FurnitureKind;
    l?: number;
    lit?: boolean;
    metal?: boolean;
    n?: number;
  } | null;
}

/**
 * Fountains, statues, memorial stones and columns (pipeline/bake/monuments.py):
 * the Basis-DLM's monument points (GeoSN, the official names) conflated with
 * OSM's `amenity=fountain` (ODbL, the basin outlines). A fountain with an
 * outline is a Polygon — the rim, its hole (when there is one) the water;
 * everything else is a Point.
 */
export type MonumentKind = "column" | "fountain" | "statue" | "stone";

/** How a fountain's basin is dressed: a raised rim with jets, jets on flush
 *  paving (a splash pad), or a still pool without any. */
export type FountainStyle = "basin" | "pool" | "splash";

/**
 * A monument's measured bulk: DOM1 − DGM1 on the 1 m grid, the patch that
 * stands clear of trees and facades, padded by one empty cell. Heights in
 * decimetres, row-major from the north-west corner (`west`, `north`).
 */
export interface ReliefGrid {
  cols: number;
  dm: number[];
  north: number;
  rows: number;
  west: number;
}

export interface MonumentFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: {
    /** a fountain with a DLM monument in it (its sculpture is measured) */
    figure?: boolean;
    kind: MonumentKind;
    name?: string;
    /** the measured sculpture or monument (pipeline/bake/monuments.py) */
    relief?: ReliefGrid;
    source?: "dlm" | "dlm+osm" | "osm";
    style?: FountainStyle;
  } | null;
}

/** OSM retaining/city walls and cliffs (pipeline/bake/walls.py, ODbL): the
 *  barrier/man_made kind or "cliff" (only retaining kinds and cliffs reshape
 *  the terrain) and the height in metres. */
export interface WallFeature {
  geometry: LineGeometry;
  properties: { h: number; kind: string } | null;
}

/** The kerb lines (pipeline/bake/edges.py, from the Basis-DLM road class):
 *  the smoothed carriageway edge, the road on each line's left. */
export interface KerbFeature {
  geometry: LineGeometry;
  properties: Record<string, never> | null;
}

/** OSM `highway=steps` flights (pipeline/bake/stairs.py, ODbL): the axis runs
 *  bottom → top; width (m), step count and the two landing heights (m). */
export interface StairFeature {
  geometry: LineGeometry;
  properties: { n: number; w: number; z: [number, number] } | null;
}

/** Raised OSM areas a flight climbs onto that the DGM lacks (the Brühlsche
 *  Terrasse; pipeline/bake/stairs.py, ODbL): the level (m) the build lifts
 *  the ground inside them to. */
export interface TerraceFeature {
  geometry: MultiPolygonGeometry | PolygonGeometry | null;
  properties: { z: number } | null;
}

/** What a tram track runs in (pipeline/bake/tram.py): the road, a lawn
 *  (*Rasengleis*), or ballast. */
export type TramBed = "ballast" | "grass" | "street";

/** The parts of the tram layer: a track, a catenary mast, the wires that
 *  hold the contact wire (a span between two masts, an arm from one, a span
 *  between two facades' rosettes) and a stop sign. */
export type TramKind = "arm" | "mast" | "rosette" | "span" | "stop" | "track";

/**
 * OSM trams (pipeline/bake/tram.py, ODbL). A `track` is one track's
 * centreline, cut at the tile edge, with its `bed`, `bridge: 1` on a bridge,
 * the OSM `layer`, and `s`: the distances (m along the line) where a span or
 * arm holds its contact wire. A `mast` is a Point; `span`, `rosette` and
 * `arm` are two-point lines between their anchors (mast or facade; an arm
 * ends over its track) with `x`, the fractions along a span where it
 * crosses a track. A `stop` is a Point with the stop's `name` and the
 * bearing `a` its sign faces.
 */
export interface TramFeature {
  geometry: LineGeometry | PointGeometry;
  properties: {
    a?: number;
    bed?: TramBed;
    bridge?: number;
    k: TramKind;
    layer?: number;
    name?: string;
    s?: number[];
    x?: number[];
  } | null;
}

/** What the Elbe carries (pipeline/bake/riverside.py): a fixed landing
 *  stage, a floating one, a groyne, a ferry route. */
export type RiversideKind = "ferry" | "groyne" | "pier" | "pontoon";

/**
 * OSM on the river (pipeline/bake/riverside.py, ODbL). A `pier` is its
 * deck outline with `deck`, the deck's height (m: the bank at its landward
 * end + 0.4); a `pontoon` its outline cut to the water, with `len` (m) and
 * `bank`, where its gangway meets the bank (absent when a fixed pier
 * reaches it) — its height is the drawn water's, read at runtime. A
 * `groyne` and a `ferry` (with the route's `name`) are lines.
 */
export interface RiversideFeature {
  geometry: LineGeometry | PolygonGeometry;
  properties: {
    bank?: Point2;
    deck?: number;
    k: RiversideKind;
    len?: number;
    name?: string;
  } | null;
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
