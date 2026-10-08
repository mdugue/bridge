/**
 * The GeoJSON feature shapes the offline bakes write (pipeline/bake/*.py)
 * and the layers read — the one contract between data/<site>/dlm and the viewer.
 * features.test.ts checks every committed file against it, so a bake that
 * changes a property name fails there, not as an empty layer in the browser.
 *
 * GeoJSON allows `"properties": null`, so properties are nullable and every
 * read goes through `?.`: one odd feature must never throw out of a layer's
 * documented non-fatal load. Coordinates are in the site's CRS (EPSG:25832/25833), never recentered.
 * No THREE, no DOM.
 */
import type { LevelRun } from "./levels";
import type { Point2 } from "./polyline";

export interface LineGeometry {
  coordinates: Point2[];
  type: "LineString";
}

export interface PointGeometry {
  coordinates: Point2;
  type: "Point";
}

export interface MultiLineGeometry {
  coordinates: Point2[][];
  type: "MultiLineString";
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
 * Individually known trees — the Dresden street-tree cadastre
 * (pipeline/bake/trees.py, dl-de/by-2-0 "Landeshauptstadt Dresden") and the
 * OSM `natural=tree` nodes it does not cover (`s: "osm"`, ODbL). Heights
 * and crown diameters in metres (imputed in the bake where the source has
 * none); `a` is the archetype id (lib/city/tree-inventory.ts
 * TREE_ARCHETYPES), `l` the leaf type ("e" evergreen, "d" deciduous), `c` a
 * foliage colour (1 purple, 2 golden; absent = green), `g` = 1 marks a globe
 * cultivar, `f` = 1 a tree standing in DLM forest/copse (it vetoes no
 * canopy tree — lib/city/tree-inventory.ts), `gn` the genus (an index into
 * the file's `genera` member, lib/city/tree-season.ts TREE_GENERA; absent =
 * 0, other deciduous) and `t` the trunk diameter at breast height (cm;
 * absent = not measured).
 */
/**
 * What the inquiry card says about each tree of a tile's trees file
 * (`treefacts_<tile>.json`, pipeline/bake/trees.py; ADR 0042): columns
 * aligned with that file's features by index, -1 for unknown; the names
 * (German, botanical), the register's locations and record dates as
 * tables the columns index. `known`: bit 1 the height, 2 the crown, 4 the
 * trunk is measured (or tagged), not filled in from the tile's statistics.
 * Fetched with the first question about a tree on the tile, never to draw.
 */
export interface TreeFactsFile {
  age: number[];
  attribution: string;
  count: number;
  date: number[];
  dates: string[];
  known: number[];
  name: number[];
  names: [string, string][];
  nr: number[];
  place: number[];
  places: string[];
}

export interface TreeFeature {
  geometry: PointGeometry;
  properties: {
    a: number;
    c?: number;
    d: number;
    f?: number;
    g?: number;
    gn?: number;
    h: number;
    l: "d" | "e";
    /** "osm": an OSM tree, not the register's; "orchard": an orchard
     *  tree (lib/city/cultivated.ts, at runtime only — no file has it) */
    s?: "orchard" | "osm";
    t?: number;
    /** the planting year (pipeline/bake/trees.py planting_year) */
    y?: number;
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
 *  lamp-layer constant, so no property is read but the source (`src`:
 *  "mly" for Mapillary's, lib/city/mapillary.ts). */
export interface LampFeature {
  geometry: PointGeometry;
  properties: { src?: "mly" } | null;
}

/** Street lamps and litter bins OSM lacks, detected by Mapillary
 *  (pipeline/bake/mapillary.py, CC BY-SA 4.0). */
export interface MapillaryFeature {
  geometry: PointGeometry;
  properties: { k: "bin" | "lamp" } | null;
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
    /** "mly": Mapillary's, not OSM's (lib/city/mapillary.ts) */
    src?: "mly";
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

/**
 * A small structure the laser scan saw and LoD2 lacks
 * (pipeline/bake/small_buildings.py, GeoSN; a city-mesh bake input, not
 * served): its footprint rectangle (4 corners + the closing one), the
 * lowest ground under it `z`, its top `h` above `z`, and for a pent roof
 * `hc`, the height above `z` at each of the ring's first four corners.
 */
export interface SmallBuildingFeature {
  geometry: PolygonGeometry;
  properties: { h: number; hc?: number[]; z: number } | null;
}

/**
 * A door on a LoD2 wall (pipeline/bake/doors.py, ODbL; a city-mesh bake
 * input, not served): an OSM entrance snapped onto the nearest footprint
 * edge of the object `of`, with the wall's outward normal (`nx`, `ny`),
 * the door's width and height (m), the ground under its sill `z` and the
 * `entrance=*` value as `kind`.
 */
export interface DoorFeature {
  geometry: PointGeometry;
  properties: {
    h: number;
    kind: string;
    nx: number;
    ny: number;
    of: string;
    w: number;
    z: number;
  } | null;
}

/** A building's plinth on the street side of its LoD2 walls
 *  (pipeline/bake/plinths.py, LoD2 + DGM1): level pieces of the wall's
 *  open stretches, each walked with the street to its right (a→b), its
 *  top (`top`) and the lowest ground under it (`g`), one per line, and the
 *  LoD2 object it belongs to (`of`). */
export interface PlinthFeature {
  geometry: MultiLineGeometry;
  properties: { g: number[]; of: string; top: number[] } | null;
}

/** A dormer the surface model shows on a pitched LoD2 roof
 *  (pipeline/bake/dormers.py, DOM1 — the provider's licence): its centre,
 *  the roof's downslope direction (`ax`, `ay`), its width across and depth
 *  along the slope (`w`, `d`), the roof's height at the centre (`z`), its
 *  measured top (`top`), the roof's slope (degrees) and the LoD2 object it
 *  sits on (`of`). */
export interface DormerFeature {
  geometry: PointGeometry;
  properties: {
    ax: number;
    ay: number;
    d: number;
    of: string;
    slope: number;
    top: number;
    w: number;
    z: number;
  } | null;
}

/** What the surface model shows and LoD2 lacks, confirmed by OSM
 *  (pipeline/bake/structures.py, ODbL): a column (chimney, tower, mast,
 *  water tower, communications tower, lighthouse) as its axis point with
 *  foot radius `r` and top radius `rt`, or a whole building as its outline;
 *  `z` the lowest ground, `h` the measured height above it. */
export interface StructureFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: {
    h: number;
    kind: StructureKind;
    name?: string;
    /** a relief: the LoD2 object it sits on (and whose look it wears) */
    of?: string;
    /** a relief's height field: heights (m) above `z` on a north-up grid
     *  from its north-west corner (x, y), row by row; -1 outside it */
    grid?: HeightField;
    r?: number;
    rt?: number;
    z: number;
  } | null;
}

export interface HeightField {
  cols: number;
  /** per cell, where its walls end below `z` (≤ 0): the LoD2 roof under
   *  the cell; without it every wall ends at `z` */
  floor?: number[];
  res: number;
  rows: number;
  x: number;
  y: number;
  z: number[];
}

export const STRUCTURE_KINDS = [
  "chimney",
  "tower",
  "mast",
  "communications_tower",
  "water_tower",
  "lighthouse",
  "building",
  "relief",
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/** A measured roof face's surface (pipeline/bake/roofs.py `surface`): the
 *  heights in centimetres from its part's `z`, on a north-up grid of `res`
 *  metre cells from its north-west corner (`x`, `y`), row by row from the
 *  north; it reaches two cells past the part's outline. */
export interface MeasuredSurface {
  cols: number;
  dz: number[];
  res: number;
  rows: number;
  x: number;
  y: number;
}

/** A LoD2 roof that misses DOM1, rebuilt in the shape the scan shows
 *  (pipeline/bake/roofs.py, the provider's): one part of the object `id`
 *  (its LoD2 CityObject key), outline and courtyards in plan, its roof at
 *  `z` metres (absolute) — flat, or, for a face (a pitched roof, a vault, a
 *  dome), its measured `surface` (`z` then its median).
 *  scripts/measured-roofs.ts stands each part from the object's LoD2 base. */
export interface MeasuredRoofFeature {
  geometry: PolygonGeometry;
  properties: { id: string; surface?: MeasuredSurface; z: number } | null;
}

/** OSM retaining/city walls and cliffs (pipeline/bake/walls.py, ODbL): the
 *  barrier/man_made kind or "cliff" (only retaining kinds and cliffs reshape
 *  the terrain) and the height in metres. */
export interface WallFeature {
  geometry: LineGeometry;
  properties: { h: number; kind: string } | null;
}

/** OSM fences and railings, in the walls file after the walls (walls.py,
 *  ODbL): the panel (`railing`, `mesh`, `picket`, or `rail` for a handrail)
 *  and the height in metres. */
export interface FenceFeature {
  geometry: LineGeometry;
  properties: { h: number; kind: "fence"; type: string } | null;
}

/** OSM gates standing on a wall or fence line, last in the walls file
 *  (walls.py, ODbL): the gap's width (m), the line's kind, the barrier
 *  (`lift_gate`, `swing_gate`, `cycle_barrier`) where it is not a plain
 *  gate, and `seam` on a neighbouring tile's gate whose gap reaches over
 *  the seam (it cuts this tile's piece of the line too). */
export interface GateFeature {
  geometry: PointGeometry;
  properties: {
    kind: "gate";
    on: "fence" | "wall";
    seam?: true;
    type?: string;
    w: number;
  } | null;
}

/** Everything the walls file carries. */
export type WallFileFeature = FenceFeature | GateFeature | WallFeature;

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
 * the OSM `layer`, its gauge `g` (m) where OSM maps one, and `s`: the distances (m along the line) where a span or
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
    /** a track's gauge (m) */
    g?: number;
    k: TramKind;
    layer?: number;
    /** a track's runs off the ground (lib/city/levels.ts), added by the
     *  build step (scripts/line-levels.ts), never committed */
    lv?: LevelRun[];
    name?: string;
    s?: number[];
    x?: number[];
  } | null;
}

/**
 * A church's bell tower (pipeline/bake/soundmarks.py; OSM ODbL, heights
 * from the GeoSN LoD2): the tower's tip, its height above the ground (m),
 * the bell's size class (by the height) and the church's name.
 */
export interface SoundmarkFeature {
  geometry: PointGeometry;
  properties: {
    h: number;
    k: "bell";
    name?: string;
    size: "large" | "medium" | "small";
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

/** How a section was counted (pipeline/bake/traffic.py): by hand on one
 *  day scaled to the average day, an induction loop or an infrared
 *  detector (yearly means), or the office's estimate. */
export type TrafficMethod = "census" | "detector" | "estimate" | "loop" | "man";

/**
 * The site's counted motor traffic per road section, cut to the tile
 * (pipeline/bake/traffic.py; its source in traffic_sources.py).
 * `f` vehicles per day along the line as drawn, `b` against it (each
 * absent where that direction was not counted), `t` the total; `hf` / `hb`
 * the heavy share (0..1) of each direction; `y` the year counted, `m` how
 * ("census": a road census counting both directions together); `sp` 1 =
 * the total split evenly between the directions (not measured per
 * direction); `n` the street; `br` 1 = the street is a bridge (lifted onto
 * its deck).
 */
export interface TrafficFeature {
  geometry: LineGeometry;
  properties: {
    b?: number;
    br?: 1;
    f?: number;
    hb?: number;
    hf?: number;
    m?: TrafficMethod;
    n?: string;
    sp?: 1;
    t: number;
    y?: number;
  } | null;
}

/** Basis-DLM ver03_l railway centrelines (pipeline/bake/rail.py). `lv`
 *  is added by the build step (scripts/line-levels.ts), never committed:
 *  the line's runs off the ground (lib/city/levels.ts). */
export interface RailFeature {
  geometry: LineGeometry;
  properties: {
    electrified?: number;
    lv?: LevelRun[];
    tracks?: number;
  } | null;
}

/** Basis-DLM ver06_f bridge decks with the DGM/DOM1-derived deck heights. */
export interface BridgeFeature {
  geometry: PolygonGeometry;
  properties: {
    /** deck elevation (m) per outer-ring vertex */
    deck?: number[];
    kind?: "other" | "path" | "rail" | "road";
    name?: string | null;
    /** OSM bridge:structure vocabulary (e.g. "arch", "beam;arch",
     *  "suspension;cantilever"): Wikidata's class when it knows the bridge,
     *  else the nearest OSM outline's tag */
    structure?: string | null;
    /** the deck's centreline, first → last abutment (EPSG): the DLM
     *  bridge line where there is one, else the outline's long axis
     *  through its middle */
    axis?: [number, number][];
    /** deck height per BRIDGE_STEP (2 m) along the axis (m) */
    line?: number[];
    /** superstructure measured in DOM1 (pipeline/bake/bridge.py) */
    ribs?: { offset: number; rise: number[] }[];
    /** where the fairway mark sits along the axis (0..1) */
    fairway?: number;
    /** the fairway's navigation clearance (m, OSM seamark) */
    clearance?: number;
    /** structural depth of the deck at the fairway (m) */
    depth?: number;
    /** the Wikidata item the bridge was matched to */
    wikidata?: string;
    /** its main span (m, Wikidata P2787) */
    span?: number;
  } | null;
}

/**
 * Cultivated land (pipeline/bake/cultivated.py, ODbL): allotment colonies
 * and their mapped parcels, orchards with their trees (`h`, `d`; mapped or
 * on an 8 m grid), vineyards with their rows along the contour.
 */
export interface CultivatedFeature {
  geometry:
    | LineGeometry
    | MultiPolygonGeometry
    | PointGeometry
    | PolygonGeometry
    | null;
  properties: {
    d?: number;
    h?: number;
    k: "colony" | "orchard" | "parcel" | "row" | "tree" | "vineyard";
    src?: "grid" | "osm";
  } | null;
}

/** Dissolved ballast yards (Basis-DLM ver03_f) and OSM platforms (ODbL). */
export interface AreaFeature {
  geometry: LineGeometry | MultiPolygonGeometry | PolygonGeometry | null;
  properties: Record<string, unknown> | null;
}
