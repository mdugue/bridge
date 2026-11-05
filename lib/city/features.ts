/**
 * The GeoJSON feature shapes the offline bakes write (pipeline/bake/*.py)
 * and the layers read — the one contract between data/<site>/dlm and the viewer.
 * features.test.ts checks every committed file against it, so a bake that
 * changes a property name fails there, not as an empty layer in the browser.
 * The tile sources the build reads (doors … terraces) and the monuments take
 * their properties from their schemas (lib/city/<name>-file.ts, ADR 0059).
 *
 * GeoJSON allows `"properties": null`, so properties are nullable and every
 * read goes through `?.`: one odd feature must never throw out of a layer's
 * documented non-fatal load. Coordinates are in the site's CRS (EPSG:25832/25833), never recentered.
 * No THREE, no DOM.
 */
import type { DoorProps } from "./doors-file";
import type { DormerProps } from "./dormers-file";
import type { KerbProps } from "./kerbs-file";
import type { LevelRun } from "./levels";
import type { MeasuredRoofProps } from "./measured-roofs-file";
import type { MonumentProps } from "./monuments-file";
import type { PassageProps } from "./passages-file";
import type { PlinthProps } from "./plinths-file";
import type { Point2 } from "./polyline";
import type { SmallBuildingProps } from "./small-buildings-file";
import type { StairProps } from "./stairs-file";
import type { StructureProps } from "./structures-file";
import type { TerraceProps } from "./terraces-file";
import type { FenceProps, GateProps, WallProps } from "./walls-file";

export type { MeasuredSurface } from "./measured-roofs-file";
export type { ReliefGrid } from "./monuments-file";
export type { PassagePart } from "./passages-file";
export type { ShopfrontFile, ShopfrontWall } from "./shopfronts-file";
export type { HeightField, StructureRoofPart } from "./structures-file";

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

/** DOM1-derived canopy points with the measured tree height
 *  (pipeline/bake/canopy.py); `l: "e"` an evergreen — a needle forest's, or
 *  with `ls: "dop"` a mixed forest's crown a leaf-off flight shows green —,
 *  absent a broadleaf; `pine: 1` an evergreen whose crown the surface
 *  model shows flat-topped, a pine's (pipeline/bake/crown_form.py; the
 *  rest are drawn as cones); `c: 1` a crown that reaches over a carriageway
 *  (it starts clear of the traffic); `row: 1` a tree row's tree at its
 *  crown peak (the bake's only: the packed points drop it). */
export interface CanopyFeature {
  geometry: PointGeometry;
  properties: {
    c?: 1;
    h: number;
    l?: "e";
    ls?: "dop";
    pine?: 1;
    row?: 1;
  } | null;
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
    /** 1: an orchard tree DOM1 measured (cultivated.py `src: "dom"`), its
     *  height and crown the surface model's (at runtime only) */
    m?: 1;
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
  properties: (NonNullable<CanopyFeature["properties"]> & { r: number }) | null;
}

/**
 * Hedges (pipeline/bake/lowveg.py): the OSM `barrier=hedge` lines and the
 * laser scan's own hedges that pass its filters, with their height and
 * width in metres. `src` says where the line and the height came from —
 * "osm+lsc" (OSM's line, the laser scan measured it), "osm+dom" (OSM's
 * line, measured in the surface model DOM1 where no scan is), "osm" (the
 * tag, or a default) or "lsc" (line and height both the scan's).
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

export type LowVegSource = "osm" | "osm+lsc" | "osm+dom" | "lsc";

/** How a lamp post's height was found (pipeline/bake/lamp_heights.py). */
export type LampHeightSource = "street" | "class";

/** OSM street lamps (pipeline/bake/lamps.py, ODbL). A post's `h` is its
 *  height (m), measured in DOM1 as its street's median (`hs: "street"`) or
 *  its kind of street's on the tile (`"class"`; pipeline/bake/
 *  lamp_heights.py), else 5 m. A lamp hung across the street carries its
 *  `wire` (the two ends, EPSG; the head at the point, `h` m over the
 *  ground) and `masts` where an end is a mast at the kerb, not a facade.
 *  A lamp on a bridge carries its deck's top there (`deck`, m), which its
 *  post stands on. A lamp OSM puts on a wall hangs on its facade, or with
 *  no building near on a mapped wall (`on: "wall"`): the point is its head,
 *  `h` m over the ground, `wall` its bracket's foot (EPSG), and it has no
 *  post. A tall post (or one OSM calls a bent mast, `bent`) holds its head
 *  on an arm over the carriageway: `arm`, the arm's compass bearing
 *  (degrees; pipeline/bake/lamp_heights.py `arm_of`). The source (`src`): "mly" for
 *  Mapillary's, lib/city/mapillary.ts. */
export interface LampFeature {
  geometry: PointGeometry;
  properties: {
    arm?: number;
    bent?: boolean;
    deck?: number;
    h?: number;
    hs?: LampHeightSource;
    masts?: [boolean, boolean];
    on?: "wall";
    src?: "mly";
    /** the level (m) of the water its light falls on, past the
     *  buildings: the river mirrors it (pipeline/bake/lamp_water.py) */
    w?: number;
    /** how far (m) from the lamp that water reaches, in eight compass
     *  sectors from north: its mirror's end */
    wr?: number[];
    wall?: Point2;
    wire?: [Point2, Point2];
  } | null;
}

/** Street lamps and litter bins OSM lacks, detected by Mapillary
 *  (pipeline/bake/mapillary.py, CC BY-SA 4.0); a lamp hung across the
 *  street carries the OSM lamps' `wire`, `masts` and `h`, a tall post their
 *  `arm`. */
export interface MapillaryFeature {
  geometry: PointGeometry;
  properties: {
    arm?: number;
    h?: number;
    hs?: LampHeightSource;
    k: "bin" | "lamp";
    masts?: [boolean, boolean];
    /** as a `LampFeature`'s */
    w?: number;
    /** as a `LampFeature`'s */
    wr?: number[];
    wire?: [Point2, Point2];
  } | null;
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
  | "pedsignal"
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
 * shelter (`stop`). The QA's corrections added the pedestrian signals of a
 * signalled crossing (`pedsignal`, at each kerb, looking across), a car
 * signal's mast arm over a road of three lanes or more (`arm`) and its
 * far-side repeater (a second `signal`), a bin's colour (`c`) and the
 * equipment the surface model shows in a playground OSM maps empty
 * (`src: "dom"`).
 */
export interface FurnitureFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: {
    a?: number;
    /** a signal's head hangs on a mast arm over the lanes (≥ 3 lanes) */
    arm?: boolean;
    back?: boolean;
    /** a bin's colour, where not the model's grey: its own `colour` tag,
     *  else the city's tagged majority */
    c?: "blue" | "green" | "orange" | "red" | "yellow";
    /** on a bridge: the top of its road or path deck there (m), which the
     *  piece stands on instead of the ground */
    deck?: number;
    h?: number;
    k: FurnitureKind;
    l?: number;
    lit?: boolean;
    metal?: boolean;
    n?: number;
    /** "mly": Mapillary's, not OSM's (lib/city/mapillary.ts); "dom": a
     *  playground's piece measured in DOM1 − DGM1, not mapped */
    src?: "dom" | "mly";
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

/**
 * What a monument is, by OSM's `memorial=*` / `artwork_type=*` (ODbL): a
 * figure on its pedestal, a bust, a free sculpture, a stele, a stone, an
 * obelisk, a column — or, for a war memorial or a bare monument, what its
 * measured height says (pipeline/bake/monuments.py `default_form`; a
 * column where the surface shows a slim shaft). The DLM's code alone does
 * not tell a statue from a stone.
 */
export type MonumentForm =
  | "bust"
  | "column"
  | "obelisk"
  | "sculpture"
  | "statue"
  | "stele"
  | "stone";

/** How a fountain's basin is dressed: a raised rim with jets, jets on flush
 *  paving (a splash pad), or a still pool without any. */
export type FountainStyle = "basin" | "pool" | "splash";

/** A monument as the bake writes it (its schema: lib/city/monuments-file.ts,
 *  ADR 0059, which documents each property); `null` properties, as GeoJSON
 *  allows, are guarded by the loaders. */
export interface MonumentFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: MonumentProps | null;
}

/* The city mesh's and the terrain's tile sources: bake inputs, never served.
 * Each file's schema (lib/city/<name>-file.ts, ADR 0059) documents its
 * properties and is its one shape; here a feature as the bakes pass it
 * around, `null` properties guarded by their readers. */

/** A small structure the laser scan saw and LoD2 lacks: its footprint
 *  rectangle (4 corners + the closing one). */
export interface SmallBuildingFeature {
  geometry: PolygonGeometry;
  properties: SmallBuildingProps | null;
}

/** A door on a LoD2 wall. */
export interface DoorFeature {
  geometry: PointGeometry;
  properties: DoorProps | null;
}

/** A passage through LoD2 buildings. */
export interface PassageFeature {
  geometry: LineGeometry;
  properties: PassageProps | null;
}

/** A building's plinth on the street side of its LoD2 walls. */
export interface PlinthFeature {
  geometry: MultiLineGeometry;
  properties: PlinthProps | null;
}

/** A dormer or a chimney on a LoD2 roof. */
export interface DormerFeature {
  geometry: PointGeometry;
  properties: DormerProps | null;
}

/** What the surface model shows and LoD2 lacks, confirmed by OSM. */
export interface StructureFeature {
  geometry: PointGeometry | PolygonGeometry;
  properties: StructureProps | null;
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
  "roof",
] as const;
export type StructureKind = (typeof STRUCTURE_KINDS)[number];

/** A LoD2 roof that misses DOM1, rebuilt in the shape the scan shows. */
export interface MeasuredRoofFeature {
  geometry: PolygonGeometry;
  properties: MeasuredRoofProps | null;
}

/** OSM retaining and city walls and cliffs, and the measured quays. */
export interface WallFeature {
  geometry: LineGeometry;
  properties: WallProps | null;
}

/** OSM fences and railings, in the walls file after the walls. */
export interface FenceFeature {
  geometry: LineGeometry;
  properties: FenceProps | null;
}

/** OSM gates standing on a wall or fence line, last in the walls file. */
export interface GateFeature {
  geometry: PointGeometry;
  properties: GateProps | null;
}

/** Everything the walls file carries. */
export type WallFileFeature = FenceFeature | GateFeature | WallFeature;

/** The kerb lines. */
export interface KerbFeature {
  geometry: LineGeometry;
  properties: KerbProps | null;
}

/** OSM `highway=steps` flights. */
export interface StairFeature {
  geometry: LineGeometry;
  properties: StairProps | null;
}

/** Raised OSM areas a flight climbs onto that the DGM lacks. */
export interface TerraceFeature {
  geometry: MultiPolygonGeometry | PolygonGeometry | null;
  properties: TerraceProps | null;
}

/** What a tram track runs in (pipeline/bake/tram.py): the road, a lawn
 *  (*Rasengleis*), or ballast. */
export type TramBed = "ballast" | "grass" | "street";

/** The parts of the tram layer: a track, a catenary mast (mapped) or pole
 *  (placed where none is mapped: at the street's edge, or between a double
 *  track with a central strip), the wires that hold the contact wire (a
 *  span between two masts or poles, an arm from one, a span between two
 *  facades' rosettes) and a stop sign. */
export type TramKind =
  | "arm"
  | "mast"
  | "pole"
  | "rosette"
  | "span"
  | "stop"
  | "track";

/**
 * OSM trams (pipeline/bake/tram.py, ODbL). A `track` is one track's
 * centreline, cut at the tile edge, with its `bed`, `bridge: 1` on a bridge,
 * the OSM `layer`, its gauge `g` (m) where OSM maps one, and `s`: the distances (m along the line) where a span or
 * arm holds its contact wire. A `mast` and a `pole` are Points (`lamp: 1`
 * on a pole that is a mapped street lamp's post); `span`, `rosette` and
 * `arm` are two-point lines between their anchors (mast, pole or facade; an
 * arm ends over its track) with `x`, the fractions along a span where it
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
    /** a pole that is a mapped street lamp's post */
    lamp?: number;
    layer?: number;
    /** a track's runs off the ground (lib/city/levels.ts), added by the
     *  build step (scripts/line-levels.ts), never committed */
    lv?: LevelRun[];
    /** a track's profile (lib/city/line-profile.ts `encodeProfile`), added
     *  by the build step with `lv`, never committed */
    lz?: (number | null)[];
    name?: string;
    s?: number[];
    x?: number[];
  } | null;
}

/** What the Elbe carries (pipeline/bake/riverside.py): a fixed landing
 *  stage, a floating one, a groyne, a ferry route. */
export type RiversideKind = "ferry" | "groyne" | "pier" | "pontoon";

/**
 * OSM on the river (pipeline/bake/riverside.py, ODbL), each only where the
 * surface model shows it out of the water. A `pier` is its deck outline
 * with `deck`, the deck's height (m: DOM1 over its part on the water, else
 * the bank at its landward end + 0.4); a `pontoon` its outline cut to the
 * water, with `len` (m), `fb` its freeboard (m over the water, from DOM1),
 * `finger: 1` on a finger pier floating with its pontoon, and `bank`, where
 * its gangway meets the bank (absent when a fixed pier reaches it) — its
 * height is the drawn water's, read at runtime. A `groyne` (cut to where
 * the DGM shows it, `w` the water beside it, m) and a `ferry` (with the
 * route's `name`) are lines.
 */
export interface RiversideFeature {
  geometry: LineGeometry | PolygonGeometry;
  properties: {
    bank?: Point2;
    deck?: number;
    /** a pontoon's freeboard over the water (m) */
    fb?: number;
    /** a finger pier floating with its pontoon */
    finger?: number;
    k: RiversideKind;
    len?: number;
    name?: string;
    /** the water level beside a groyne (m) */
    w?: number;
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

/** Railway tracks (pipeline/bake/rail.py, rail_osm.py): OSM's every track
 *  one by one — with its way's `bridge` (0/1), `layer` (when not 0), `g`
 *  the gauge (m, when not standard), `paved` 1 where set in the paving,
 *  `m` the mapped catenary masts beside it ([station, offset to the left]
 *  m) — and the Basis-DLM ver03_l centrelines OSM has no track beside
 *  (`tracks` side by side, no `bridge`). `electrified`: 1 an overhead
 *  contact line, 2 a third rail, 0 none. `lv` and `lz` are added by the
 *  build step (scripts/line-levels.ts), never committed: the line's runs
 *  off the ground (lib/city/levels.ts) and its profile
 *  (lib/city/line-profile.ts). `steep` 1 marks a funicular's track (a
 *  Standseilbahn, a Schrägaufzug: lib/city/levels.ts `STEEP_GRADE`). A
 *  monorail is a feature of its own, no track: `mono` how its cars ride
 *  the beam, `bz` the beam's underside per vertex (m, lib/city/monorail.ts). */
export interface RailFeature {
  geometry: LineGeometry;
  properties: {
    bridge?: number;
    bz?: number[];
    electrified?: number;
    g?: number;
    layer?: number;
    lv?: LevelRun[];
    lz?: (number | null)[];
    m?: [number, number][];
    mono?: "hanging" | "top";
    paved?: number;
    steep?: number;
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
    /** its number of spans (Wikidata P1314) */
    spans?: number;
    /** a masonry bridge's piers where DOM1's deck bulges over them
     *  (stations, m along the axis) */
    piers?: number[];
    /** the stretches of the axis over water ([from, to] stations, m) */
    water?: [number, number][];
    /** the ways under the deck the DGM closes, and the bridge the DGM
     *  holds: passages the terrain opens (lib/city/passages.ts; EPSG
     *  points `c`, the level `y` at each, half the width `h`) */
    under?: { c: [number, number][]; h: number; y: number[] }[];
  } | null;
}

/**
 * Cultivated land (pipeline/bake/cultivated.py, ODbL): allotment colonies
 * and their mapped parcels, orchards with their trees (`h`, `d`: at DOM1's
 * crown peaks as tall as measured, `src: "dom"`; without DOM1 mapped or on
 * an 8 m grid; `g` the genus from the orchard's `trees=*`, `l: "e"` a
 * Christmas-tree plantation's), vineyards with the way their rows run
 * (`dir`, degrees from east; `gap`, m; `src` the orthophoto's rows, the
 * fall line, the contour or the long axis) and the rows.
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
    dir?: number;
    g?: string;
    gap?: number;
    h?: number;
    k: "colony" | "orchard" | "parcel" | "row" | "tree" | "vineyard";
    l?: "e";
    src?: "axis" | "contour" | "dom" | "dop" | "fall" | "grid" | "osm";
  } | null;
}

/** Dissolved ballast yards (Basis-DLM ver03_f) and OSM platforms (ODbL). */
export interface AreaFeature {
  geometry: LineGeometry | MultiPolygonGeometry | PolygonGeometry | null;
  properties: Record<string, unknown> | null;
}
