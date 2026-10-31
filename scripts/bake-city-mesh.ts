/**
 * Parses one tile's CityJSON into the building mesh the viewer streams:
 * runs cityjson-threejs-loader once, then folds in everything the clay
 * style needs per building (tints, roof colour incl. the DOP LUT,
 * storey/eave heights, dusk glow, roughness jitter), the OSM flags (shop,
 * heritage; a part carries its Building's too), the demolish tree and the
 * minimap footprints, then appends the small structures the laser scan saw
 * and LoD2 lacks (`appendScanStructures`). An object whose LoD2 roof misses
 * DOM1 wears its measured parts instead (`withMeasuredRoofs`,
 * scripts/measured-roofs.ts). `cityMesh` turns the result into the glTF
 * writer's input (scripts/tile-glb.ts) with its per-object property table.
 * Called by scripts/prepare-data.ts; no DOM.
 */
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import {
  BufferGeometry,
  type Matrix4,
  type Mesh,
  ShapeUtils,
  Vector2,
} from "three";
import {
  brickWalls,
  buildingGlows,
  isStructure,
  palatialFacade,
  partFacade,
  buildingTint,
  type FacadeMaterial,
  inheritedAttributes,
  countsStoreys,
  ownFacadeReason,
  type RoofColourSource,
  type RoofColours,
  type TintRgb,
  roofColor,
  roofColourSource,
  roofTint,
  roughJitter,
  mappedStoreyHeight,
  storeyHeight,
  wallColourSource,
} from "../lib/city/building-tint";
import {
  type CityObjectRow,
  hasObjectFlag,
  inheritedFlags,
  inheritedLook,
  markFlatRoofs,
  markGrounded,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_OWN_FACADE,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_DOOR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_PLINTH,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_LOD2,
  OBJECT_SOURCE_PASSAGE,
  OBJECT_SOURCE_SCAN,
  OBJECT_SOURCE_SHOPFRONT,
  objectTable,
  type OsmBuildingFacts,
  type OsmBuildingLut,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import {
  cutOut,
  type PassageAxis,
  passageHeight,
  passageLining,
  passageRegions,
  type Plane,
  touches,
} from "../lib/city/building-passages";
import { creaseNormals } from "../lib/city/crease-normals";
import { SINK } from "../lib/city/ground-join";
import { type DrawnFacts, encodeDrawn } from "../lib/city/drawn-facts";
import { epsgCodeFromReferenceSystem } from "../lib/city/crs";
import { ensembleGroup, ensembleRoots } from "../lib/city/ensembles";
import {
  DOOR_SINK,
  DOOR_SURROUND,
  doorMesh,
  eaveAlong,
  wallShift,
  wallShiftAlong,
  wallShiftKnots,
} from "../lib/city/doors";
import { dormerMesh } from "../lib/city/dormers";
import {
  type BandKind,
  bandMeshes,
  CORNICE,
  EAVE_CORNICE,
  type HostShift,
  joinStretches,
  lineStretches,
  plinthStretches,
  type Shaded,
  type Stretch,
  straightRuns,
} from "../lib/city/plinths";
import type {
  DoorFeature,
  DormerFeature,
  MeasuredRoofFeature,
  PassageFeature,
  PassagePart,
  ShopfrontWall,
  PlinthFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { buildingFootprintPolys } from "../lib/city/minimap";
import {
  doorSpans,
  footAt,
  paneTop,
  CANOPY,
  SHOPFRONT,
  shopfrontMesh,
  wallBays,
  wallShiftAt,
} from "../lib/city/shopfronts";
import {
  factColumns,
  inheritedOsm,
  lod2Facts,
  gapFacts,
  NO_FACT,
  scanFacts,
  treeFacts,
} from "../lib/city/object-facts";
import { recenterOffset } from "../lib/city/recenter";
import {
  SMALL_BUILDING_SINK,
  structureCorners,
  structureMesh,
} from "../lib/city/small-buildings";
import {
  STRUCTURE_SINK,
  structureFoot,
  structureFootprint,
  structureShape,
} from "../lib/city/structures";
import {
  clipAbove,
  isOpenRoof,
  MIN_CLEAR_M,
  OPEN_ROOF_FUNCTIONS,
  postsMesh,
  roofDepth,
  roofPosts,
} from "../lib/city/open-roofs";
import type { CityJsonDocument } from "../lib/city/types";
import {
  DOOR_SLOT,
  doorClassWidth,
  type FacadeDoor,
  type FacadeShop,
  facadeAttribute,
  NO_DOOR,
  flatTownHouse,
  GROUND_REACH_M,
  TALL_STOREY_M,
  wallRises,
  type WindowHost,
  type WindowWall,
  windowSpecs,
} from "../lib/city/windows";
import {
  measuredRoofMesh,
  measuredRoofsById,
  type PrismMesh,
} from "./measured-roofs";
import type { Column, MeshInput, PropertyTable } from "./tile-glb";

/** WallSurface and RoofSurface in the loader's fixed `defaultSemanticsColors` order. */
const WALL_SURFACE_TYPE = 1;
const ROOF_SURFACE_TYPE = 2;
/** A wall at most this tall (m) standing on its building's roof is the
 *  roof's: a step between two roof levels, a parapet, a dormer's cheek. */
const ROOF_STEP_M = 1.5;

/** Trims JSON noise: colours to 3 decimals, metres to centimetres. */
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const cm = (x: number) => Math.round(x * 100) / 100;
const rgb = (c: [number, number, number]): [number, number, number] => [
  r3(c[0]),
  r3(c[1]),
  r3(c[2]),
];

/** What the bake lays on the LoD2 walls, each feature on its host. */
export interface OnWalls {
  doors?: readonly DoorFeature[];
  dormers?: readonly DormerFeature[];
  /** the fine ground's height (EPSG), which the ground-floor windows clear */
  groundAt?: (x: number, y: number) => number | null;
  /** OSM's passages through the buildings, cut open and lined
   *  (`withPassages`) */
  passages?: readonly PassageFeature[];
  plinths?: readonly PlinthFeature[];
  shopfronts?: readonly ShopfrontWall[];
  windows?: readonly WindowWall[];
}

/** The mesh as non-indexed triangles, flat per-face vertices. */
export interface CityVertices {
  /** per vertex where it lies on its wall, for the windows (4 × snorm16,
   *  lib/city/windows.ts `facadeAttribute`); absent: no windows */
  facade?: Int16Array<ArrayBuffer>;
  /** 1 on RoofSurface vertices, 0 elsewhere */
  isRoof: Float32Array<ArrayBuffer>;
  /** per vertex, a normal to shade with in place of the triangle's flat
   *  one (a measured face's, smoothed over it); NaN or absent: flat */
  normals?: Float32Array<ArrayBuffer>;
  /** index into the object table */
  objectIds: Float32Array<ArrayBuffer>;
  /** recentered data-frame (Z-up) positions, 3 per vertex */
  positions: Float32Array<ArrayBuffer>;
  /** per vertex its roof face's own colour (linear RGB, 3 a vertex; NaN:
   *  the object's), read from the orthophoto face by face
   *  (`withFaceRoofColours`), and the rebuilt roofs' parts
   *  (`withMeasuredRoofs`). Only the vertices at the stream's start carry
   *  one: whatever is appended after them has none. */
  roofRgb?: Float32Array<ArrayBuffer>;
  /** per LoD2 vertex the loader's surface it lies on: its geometry's index
   *  in the object and the surface's in the geometry (2 a vertex) */
  surfaces?: Float32Array<ArrayBuffer>;
}

/** Concatenates the loader's chunk meshes into one vertex stream. */
function collectVertices(loaderScene: {
  traverse: (cb: (o: unknown) => void) => void;
}): CityVertices {
  const chunks: {
    objectid: ArrayLike<number>;
    position: ArrayLike<number>;
    surfacetype: ArrayLike<number> | undefined;
    geometryid: ArrayLike<number> | undefined;
    boundaryid: ArrayLike<number> | undefined;
  }[] = [];
  loaderScene.traverse((o) => {
    const geom = (o as Mesh).geometry as BufferGeometry | undefined;
    if (!(geom?.attributes.position && geom.attributes.objectid)) {
      return;
    }
    chunks.push({
      position: geom.attributes.position.array,
      objectid: geom.attributes.objectid.array,
      surfacetype: geom.attributes.surfacetype?.array,
      geometryid: geom.attributes.geometryid?.array,
      boundaryid: geom.attributes.boundaryid?.array,
    });
  });
  const n = chunks.reduce((s, c) => s + c.objectid.length, 0);
  const walls = new Uint8Array(n);
  const out = {
    positions: new Float32Array(n * 3),
    objectIds: new Float32Array(n),
    isRoof: new Float32Array(n),
    surfaces: new Float32Array(n * 2).fill(-1),
  };
  let at = 0;
  for (const c of chunks) {
    const count = c.objectid.length;
    for (let i = 0; i < count; i++) {
      out.positions[(at + i) * 3] = c.position[i * 3];
      out.positions[(at + i) * 3 + 1] = c.position[i * 3 + 1];
      out.positions[(at + i) * 3 + 2] = c.position[i * 3 + 2];
      out.objectIds[at + i] = c.objectid[i];
      const surface = c.surfacetype ? c.surfacetype[i] : -1;
      out.isRoof[at + i] = surface === ROOF_SURFACE_TYPE ? 1 : 0;
      walls[at + i] = surface === WALL_SURFACE_TYPE ? 1 : 0;
      out.surfaces[(at + i) * 2] = c.geometryid?.[i] ?? -1;
      out.surfaces[(at + i) * 2 + 1] = c.boundaryid?.[i] ?? -1;
    }
    at += count;
  }
  out.isRoof = withRoofSteps(out, walls);
  return out;
}

/**
 * The roof flags with every short wall that stands on its building's roof
 * flagged too: a step between roof levels, a parapet or a dormer's cheek
 * is clad like the roof, and drawn as a wall, sunlit plaster with an
 * eave stroke, it read from above as a white dash across the roof (the
 * Altstadt's flat roofs). A wall is one surface (`surfaces`: geometry and
 * boundary ids) at most ROOF_STEP_M tall whose foot is no lower than the
 * building's lowest roof vertex; a set-back storey is taller and keeps
 * its windows. A gable is not: a triangle (one top corner) standing on a
 * level foot at the eave, where a dataset keeps the gable apart from the
 * wall under it (on a shallow roof 1.5 m or less: Meißen's tile 362 of
 * them at least 5 m wide, Dresden's spawn tile 173).
 */
export function withRoofSteps(
  v: Pick<CityVertices, "positions" | "objectIds" | "isRoof" | "surfaces">,
  walls: Uint8Array
): Float32Array<ArrayBuffer> {
  const isRoof = Float32Array.from(v.isRoof);
  const ids = v.surfaces;
  if (!ids) {
    return isRoof;
  }
  const p = v.positions;
  // one number per surface (object, geometry, boundary; −1 is none, so
  // each id + 1): objects below 2¹⁹, geometries 2¹⁰, boundaries 2²⁴
  const key = (i: number) =>
    (v.objectIds[i] * 1024 + ids[2 * i] + 1) * 16_777_216 + ids[2 * i + 1] + 1;
  const eave = new Map<number, number>();
  const shape = new Map<number, WallShape>();
  for (let i = 0; i < isRoof.length; i++) {
    const z = p[3 * i + 2];
    if (isRoof[i] === 1) {
      eave.set(v.objectIds[i], Math.min(eave.get(v.objectIds[i]) ?? z, z));
    } else if (walls[i] === 1) {
      const s = shape.get(key(i));
      if (s) {
        s.lo = Math.min(s.lo, z);
        s.hi = Math.max(s.hi, z);
      } else {
        shape.set(key(i), { lo: z, hi: z, top: null, foot: null });
      }
    }
  }
  for (let i = 0; i < isRoof.length; i++) {
    const s = walls[i] === 1 ? shape.get(key(i)) : undefined;
    if (s) {
      const z = p[3 * i + 2];
      if (z > s.hi - CORNER_M) {
        s.top = corners(s.top, p[3 * i], p[3 * i + 1]);
      }
      if (z < s.lo + CORNER_M) {
        s.foot = corners(s.foot, p[3 * i], p[3 * i + 1]);
      }
    }
  }
  for (let i = 0; i < isRoof.length; i++) {
    const s = walls[i] === 1 ? shape.get(key(i)) : undefined;
    const low = eave.get(v.objectIds[i]);
    if (
      s &&
      low !== undefined &&
      s.hi - s.lo <= ROOF_STEP_M &&
      s.lo >= low - 0.1 &&
      !isGable(s, low)
    ) {
      isRoof[i] = 1;
    }
  }
  return isRoof;
}

/** How close two corners (m) are one corner, and two heights one level. */
const CORNER_M = 0.05;

/** A wall surface's height span and its distinct corners at the top and
 *  at the foot (the first one's x, y and whether another stands apart). */
interface WallShape {
  lo: number;
  hi: number;
  top: Corners | null;
  foot: Corners | null;
}
type Corners = { x: number; y: number; more: boolean };

function corners(c: Corners | null, x: number, y: number): Corners {
  if (!c) {
    return { x, y, more: false };
  }
  if (!c.more && Math.hypot(x - c.x, y - c.y) > CORNER_M) {
    c.more = true;
  }
  return c;
}

/** One top corner over a level foot of two at the building's eave. */
function isGable(s: WallShape, eave: number): boolean {
  return (
    s.top !== null &&
    !s.top.more &&
    s.foot !== null &&
    s.foot.more &&
    Math.abs(s.lo - eave) < CORNER_M
  );
}

/**
 * The stream with each LoD2 roof vertex's own face colour (`roofRgb`)
 * where the roof colour bake read the face apart from its building
 * (`RoofColours.faces`, keyed by the loader's geometry and surface ids).
 */
export function withFaceRoofColours(
  v: CityVertices,
  keys: readonly string[],
  faces: RoofColours["faces"]
): CityVertices {
  if (!(faces && v.surfaces)) {
    return v;
  }
  const byObject = new Map<number, Map<string, readonly number[]>>();
  keys.forEach((id, index) => {
    const list = faces[id];
    if (list?.length) {
      byObject.set(
        index,
        new Map(list.map((f) => [`${f[0]}:${f[1]}`, f.slice(2, 5)]))
      );
    }
  });
  const count = v.objectIds.length;
  const roofRgb = new Float32Array(3 * count).fill(Number.NaN);
  for (let i = 0; i < count; i++) {
    const own = byObject.get(v.objectIds[i]);
    const c =
      v.isRoof[i] === 1
        ? own?.get(`${v.surfaces[2 * i]}:${v.surfaces[2 * i + 1]}`)
        : undefined;
    if (c?.length === 3) {
      roofRgb.set(c, 3 * i);
    }
  }
  return { ...v, roofRgb };
}

/** Climbs `parents` to the root of an object's building tree (cycle-guarded). */
function rootOf(doc: CityJsonDocument, keys: string[], index: number): number {
  let id = keys[index];
  const visited = new Set<string>();
  while (!visited.has(id)) {
    visited.add(id);
    const parent = doc.CityObjects[id]?.parents?.[0];
    if (!(parent && doc.CityObjects[parent])) {
      break;
    }
    id = parent;
  }
  const root = keys.indexOf(id);
  return root === -1 ? index : root;
}

export interface BakedCityMesh {
  epsg: number;
  /** the recenter matrix, to be shared with the block's other tiles */
  matrix: Matrix4;
  objects: CityObjectRow[];
  /** recenter offset: mesh x = epsgX − cx, mesh y = epsgY − cy (Z-up) */
  offset: { cx: number; cy: number };
  vertices: CityVertices;
}

/**
 * The laser scan's small structures (pipeline/bake/small_buildings.py)
 * appended to a parsed tile: one object each at `objects.length + j`, its
 * own root (demolish takes it alone), a Building (the HUD counts it), the
 * hashed wall tint, its roof's orthophoto colour where the roof colour bake
 * read one in sun (`colours`, roofcolor's `scan`), else a calm slate (the
 * flat-roof palette), and `source` 1. Its triangles carry its own id, so
 * the weld never merges across objects. The tint hashes its first corner
 * (rounded to the decimetre), not its index, so a changed LoD2 object count
 * leaves every shed its colour; no storey band (the stroke would fall 0.2 m
 * under the eave, the sink's depth, on nearly every shed).
 */
export function appendScanStructures(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  features: readonly SmallBuildingFeature[],
  /** the roof colour bake's rows for the file (`RoofColours.scan`) */
  colours?: readonly (readonly number[])[]
): void {
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const [i, f] of features.entries()) {
    const box = structureMesh(f, baked.offset);
    const corners = structureCorners(f);
    const z = f.properties?.z;
    if (box.positions.length === 0 || !corners || z === undefined) {
      continue;
    }
    const index = baked.objects.length;
    const id = scanStructureId(tile, f);
    const eave = Math.min(...corners.map((c) => c.h));
    const footprint = corners.map((c): [number, number] => [cm(c.x), cm(c.y)]);
    positions.push(...box.positions);
    isRoof.push(...box.isRoof);
    objectIds.push(...box.isRoof.map(() => index));
    const read = appendedRoofColour(colours, i, z);
    baked.objects.push({
      building: true,
      root: index,
      baseZ: cm(z - SMALL_BUILDING_SINK),
      eaveH: cm(eave + SMALL_BUILDING_SINK),
      flags: 0,
      // one band above the eave: none on the box
      storeyH: cm(eave + SMALL_BUILDING_SINK + 1),
      glow: 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id)),
      roof: rgb(read ?? roofTint(id, { roofType: "1000" })),
      source: OBJECT_SOURCE_SCAN,
      footprints: [footprint],
      facts: scanFacts({ id, footprint, height: f.properties?.h }),
      drawn: { roof: read ? "dop" : "palette" },
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
    ...flatNormalsAfter(v, positions.length),

    ...lod2RoofColours(v),
  };
}

/**
 * The structures the surface model shows beyond LoD2 (pipeline/bake/
 * structures.py) appended like the scan's: one object each, its own root,
 * `source` 2. A column is no Building (the HUD does not count a chimney as
 * a house); a missing building is. Chimneys, towers and lighthouses take
 * the brick palette, masts and the rest the site's walls; a column's head
 * reads as roof, so the roof tint is the wall's own (no terracotta cap on a
 * chimney). A building whose roof the surface model shapes stands its
 * parts as a measured roof's (`shapedGap`), its eave at the roof's lowest
 * edge and a pitched roof's tiles where it has a face.
 */
export function appendGapStructures(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  features: readonly StructureFeature[],
  facades: FacadeMaterial = "render",
  /** the LoD2 object ids by row, for a relief slab's host */
  objectIndex: ReadonlyMap<string, number> = new Map(),
  /** the roof colour bake's rows for the file (`RoofColours.gaps`) */
  colours?: readonly (readonly number[])[]
): void {
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  const normals: number[] = [];
  for (const [i, f] of features.entries()) {
    const p = f.properties;
    const shaped = shapedGap(f, baked.offset);
    const mesh = shaped ?? structureShape(f, baked.offset, triangulateXY);
    if (!p || mesh.positions.length === 0) {
      continue;
    }
    const index = baked.objects.length;
    const hostIndex = p.of === undefined ? undefined : objectIndex.get(p.of);
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (p.kind === "relief" && !host) {
      continue;
    }
    positions.push(...mesh.positions);
    isRoof.push(...mesh.isRoof);
    objectIds.push(...mesh.isRoof.map(() => index));
    normals.push(...(shaped?.normals ?? mesh.positions.map(() => Number.NaN)));
    if (host) {
      // a relief slab is part of its landmark: its look, its building tree
      // (demolish takes it along), no footprint of its own, no storey bands
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(p.z),
        eaveH: cm(p.h),
        storeyH: cm(p.h + 1),
        source: OBJECT_SOURCE_GAP,
        footprints: [],
      });
      continue;
    }
    const read = appendedRoofColour(colours, i, p.z);
    baked.objects.push(
      gapRow(gapStructureId(tile, f), f, index, facades, shaped, read)
    );
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
    // a shaped roof's faces shade smooth, the rest flat
    ...(normals.some((n) => !Number.isNaN(n))
      ? { normals: shadedNormalsAfter(v, normals) }
      : flatNormalsAfter(v, positions.length)),

    ...lod2RoofColours(v),
  };
}

/** A gap structure's own object row (no relief: that is its host's), at
 *  row `index`; `read` its roof's orthophoto colour, if the roof colour
 *  bake read one. */
function gapRow(
  id: string,
  f: StructureFeature,
  index: number,
  facades: FacadeMaterial,
  shaped: ReturnType<typeof shapedGap>,
  read: TintRgb | undefined
): CityObjectRow {
  const p: NonNullable<StructureFeature["properties"]> = f.properties ?? {
    h: 0,
    kind: "building",
    z: 0,
  };
  const isBuilding = p.kind === "building";
  // a roof on posts: a flat roof's palette, and no facade to dress
  const onPosts = p.kind === "roof";
  const brick = ["chimney", "tower", "lighthouse"].includes(p.kind);
  const tint = rgb(buildingTint(id, {}, brick ? "brick" : facades));
  const footprint = structureFootprint(f).map(([x, y]): [number, number] => [
    cm(x),
    cm(y),
  ]);
  const eave = shaped?.eave ?? p.h;
  return {
    building: isBuilding,
    root: index,
    // a raised part from its floor (a bridge between two buildings)
    baseZ: cm(p.z + structureFoot(p)),
    eaveH: cm(eave - structureFoot(p)),
    flags: onPosts ? OBJECT_FLAG_FLAT_ROOF : 0,
    storeyH: cm(isBuilding ? storeyHeight(eave) : p.h + STRUCTURE_SINK + 1),
    glow: 0,
    rough: r3(roughJitter(id)),
    tint,
    roof:
      isBuilding || onPosts
        ? rgb(
            read ??
              roofTint(id, { roofType: shaped?.pitched ? "3100" : "1000" })
          )
        : tint,
    source: OBJECT_SOURCE_GAP,
    footprints: [footprint],
    ...(isBuilding || onPosts
      ? {
          facts: gapFacts({
            id,
            footprint,
            height: p.h,
            name: p.name,
            // the card names it by ALKIS's word for one
            function: onPosts ? OPEN_ROOF_FUNCTIONS[0] : undefined,
          }),
          drawn: {
            // the height is OSM's where the surface model predates it
            ...(p.src === "osm" ? { height: "osm" as const } : {}),
            roof: read ? ("dop" as const) : ("palette" as const),
          },
        }
      : {}),
  };
}

/** An appended roof's orthophoto colour (pipeline/bake/roof_colour.py
 *  `appended_colours`): the row of feature `i` in its file, where its `z`
 *  is still the feature's (a row read before the feature changed is not
 *  its colour); undefined where none was read. */
export function appendedRoofColour(
  rows: readonly (readonly number[])[] | undefined,
  i: number,
  z: number | undefined
): TintRgb | undefined {
  const row = rows?.find((r) => r[0] === i);
  return row && z !== undefined && Math.abs(row[1] - z) < 0.005
    ? [row[2], row[3], row[4]]
    : undefined;
}

/**
 * A missing building whose roof the surface model shapes (pipeline/bake/
 * structures.py `shaped_roof`): its parts stood as a measured roof's
 * (scripts/measured-roofs.ts) from below its lowest ground, with `eave`
 * (m over that ground) at its lowest roof vertex and `pitched` where a
 * part is a face; null where it has no parts (the flat box stands) or is
 * raised off the ground.
 */
export function shapedGap(
  f: StructureFeature,
  offset: { cx: number; cy: number }
): (PrismMesh & { eave: number; pitched: boolean }) | null {
  const p = f.properties;
  if (p?.kind !== "building" || !p.parts?.length || (p.base ?? 0) > 0) {
    return null;
  }
  const parts: MeasuredRoofFeature[] = p.parts.map((part) => ({
    geometry: { type: "Polygon", coordinates: part.coordinates },
    properties: { id: "", surface: part.surface, z: part.z },
  }));
  const mesh = measuredRoofMesh(parts, p.z + structureFoot(p), offset);
  let lowest = Number.POSITIVE_INFINITY;
  mesh.isRoof.forEach((roof, i) => {
    if (roof === 1) {
      lowest = Math.min(lowest, mesh.positions[i * 3 + 2]);
    }
  });
  if (!Number.isFinite(lowest)) {
    return null;
  }
  return {
    ...mesh,
    eave: lowest - p.z,
    pitched: p.parts.some((part) => part.surface !== undefined),
  };
}

/** A gap structure's hash key: its kind and anchor to the decimetre. */
export function gapStructureId(tile: string, f: StructureFeature): string {
  const [x, y] =
    f.geometry.type === "Point"
      ? f.geometry.coordinates
      : (f.geometry.coordinates[0]?.[0] ?? [0, 0]);
  return `gap:${tile}:${f.properties?.kind}:${x.toFixed(1)}:${y.toFixed(1)}`;
}

/** THREE's polygon triangulation behind lib/city/structures.ts's
 *  `Triangulate` (flat coordinates, hole starts → flat index triples). */
export const triangulateXY = (data: number[], holes: number[]): number[] => {
  const pts: Vector2[] = [];
  for (let i = 0; i + 1 < data.length; i += 2) {
    pts.push(new Vector2(data[i], data[i + 1]));
  }
  const cuts = [...holes, pts.length];
  const contour = pts.slice(0, cuts[0]);
  const rings = holes.map((start, i) => pts.slice(start, cuts[i + 1]));
  // triangulateShape indexes contour ++ holes, as Triangulate does
  return ShapeUtils.triangulateShape(contour, rings).flat();
};

/** A scan structure's hash key: the tile and its ring's first corner to the
 *  decimetre — stable when the tile's LoD2 object count changes. */
export function scanStructureId(tile: string, f: SmallBuildingFeature): string {
  const [x, y] = f.geometry.coordinates[0]?.[0] ?? [0, 0];
  return `scan:${tile}:${x.toFixed(1)}:${y.toFixed(1)}`;
}

/** The stream's normals run on, flat (NaN), over `count` appended
 *  coordinates; nothing when the stream carries none. */
function flatNormalsAfter(
  v: CityVertices,
  count: number
): Pick<CityVertices, "normals"> {
  if (!v.normals) {
    return {};
  }
  const normals = new Float32Array(v.normals.length + count).fill(Number.NaN);
  normals.set(v.normals);
  return { normals };
}

/** The LoD2 roof faces' own colours, carried on past what is appended
 *  (they cover the stream's start only). */
function lod2RoofColours(v: CityVertices): Pick<CityVertices, "roofRgb"> {
  return v.roofRgb ? { roofRgb: v.roofRgb } : {};
}

/** The stream's normals run on with `appended` (NaN: flat), the stream's
 *  own flat where it carries none. */
function shadedNormalsAfter(
  v: CityVertices,
  appended: readonly number[]
): Float32Array<ArrayBuffer> {
  const own =
    v.normals ?? new Float32Array(v.positions.length).fill(Number.NaN);
  return concat(own, appended);
}

function concat(
  a: Float32Array<ArrayBuffer>,
  b: readonly number[]
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * The vertex stream with every object that has measured parts rebuilt:
 * its LoD2 triangles dropped, its prisms appended under the same object id
 * (so its table row, picking and demolish stay), standing on the lowest
 * vertex of its LoD2 shell, a part's roof in its own colour where the roof
 * colour bake read it apart (`RoofColours.parts`, kept only where the
 * part's level matches the one read). A part id the tile does not hold is
 * ignored.
 */
export function withMeasuredRoofs(
  v: CityVertices,
  keys: readonly string[],
  offset: { cx: number; cy: number },
  features: readonly MeasuredRoofFeature[],
  colours?: RoofColours
): CityVertices {
  const byId = measuredRoofsById(features);
  const replaced = new Map<number, MeasuredRoofFeature[]>();
  keys.forEach((id, index) => {
    const parts = byId.get(id);
    if (parts) {
      replaced.set(index, parts);
    }
  });
  if (replaced.size === 0) {
    return v;
  }
  const base = new Map<number, number>();
  const keep: number[] = [];
  for (let i = 0; i < v.objectIds.length; i++) {
    const idx = v.objectIds[i];
    if (replaced.has(idx)) {
      const z = v.positions[i * 3 + 2];
      base.set(idx, Math.min(base.get(idx) ?? z, z));
    } else {
      keep.push(i);
    }
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  const normals: number[] = [];
  const roofRgb: number[] = [];
  for (const i of keep) {
    positions.push(
      v.positions[i * 3],
      v.positions[i * 3 + 1],
      v.positions[i * 3 + 2]
    );
    objectIds.push(v.objectIds[i]);
    isRoof.push(v.isRoof[i]);
    normals.push(Number.NaN, Number.NaN, Number.NaN);
    roofRgb.push(
      v.roofRgb?.[i * 3] ?? Number.NaN,
      v.roofRgb?.[i * 3 + 1] ?? Number.NaN,
      v.roofRgb?.[i * 3 + 2] ?? Number.NaN
    );
  }
  for (const [index, parts] of replaced) {
    const z = base.get(index);
    if (z === undefined) {
      continue;
    }
    const mesh = measuredRoofMesh(parts, z, offset);
    positions.push(...mesh.positions);
    isRoof.push(...mesh.isRoof);
    objectIds.push(...mesh.isRoof.map(() => index));
    normals.push(...mesh.normals);
    // a colour read for another roofs file's part (its level differs) is
    // not this part's
    const own = new Map(
      (colours?.parts?.[keys[index]] ?? [])
        .filter(
          (p) => Math.abs(p[1] - (parts[p[0]]?.properties?.z ?? NaN)) < 0.01
        )
        .map((p) => [p[0], p.slice(2, 5)])
    );
    mesh.parts.forEach((part, k) => {
      const c = mesh.isRoof[k] === 1 ? own.get(part) : undefined;
      roofRgb.push(...(c?.length === 3 ? c : FLAT_RGB));
    });
  }
  return {
    positions: Float32Array.from(positions),
    objectIds: Float32Array.from(objectIds),
    isRoof: Float32Array.from(isRoof),
    normals: Float32Array.from(normals),
    roofRgb: Float32Array.from(roofRgb),
  };
}

/** A roof on posts has no facade to dress: no storey lines, no plinth or
 *  cornices on its posts (the flat roof's gate), no windows (WINDOWLESS). */
function markOpenRoofs(
  objects: CityObjectRow[],
  open: ReadonlySet<number>
): void {
  for (const i of open) {
    const o = objects[i];
    o.storeyH = cm(o.eaveH + 1);
    if (!hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF)) {
      o.flags += OBJECT_FLAG_FLAT_ROOF;
    }
  }
}

/** No roof colour of its own: the object's. */
const FLAT_RGB = [Number.NaN, Number.NaN, Number.NaN];

/** The objects LoD2 draws as a block that are a roof on posts: their own
 *  ALKIS function, or their Building's, an Überdachung or a Carport
 *  (lib/city/open-roofs.ts `isOpenRoof`). */
export function openRoofObjects(
  doc: CityJsonDocument,
  keys: string[]
): Set<number> {
  const out = new Set<number>();
  keys.forEach((id, index) => {
    const root = doc.CityObjects[keys[rootOf(doc, keys, index)]];
    const attrs = inheritedAttributes(
      doc.CityObjects[id].attributes ?? {},
      root.attributes
    );
    if (isOpenRoof(attrs.function)) {
      out.add(index);
    }
  });
  return out;
}

/** A triangle's upward unit normal z (flat x, y, z triples). */
function normalZ(t: readonly number[]): number {
  const ux = t[3] - t[0];
  const uy = t[4] - t[1];
  const uz = t[5] - t[2];
  const wx = t[6] - t[0];
  const wy = t[7] - t[1];
  const wz = t[8] - t[2];
  const nx = uy * wz - uz * wy;
  const ny = uz * wx - ux * wz;
  const nz = ux * wy - uy * wx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 ? nz / len : 0;
}

/** Each object's lowest vertex and lowest roof vertex. */
function objectLevels(
  v: CityVertices,
  of: ReadonlySet<number>
): Map<number, { base: number; roof: number }> {
  const out = new Map<number, { base: number; roof: number }>();
  for (let i = 0; i < v.objectIds.length; i++) {
    const o = v.objectIds[i];
    if (!of.has(o)) {
      continue;
    }
    const z = v.positions[i * 3 + 2];
    const l = out.get(o) ?? { base: z, roof: Number.POSITIVE_INFINITY };
    l.base = Math.min(l.base, z);
    if (v.isRoof[i] === 1) {
      l.roof = Math.min(l.roof, z);
    }
    out.set(o, l);
  }
  return out;
}

/**
 * The vertex stream with every roof on posts LoD2 draws as a block
 * (`openRoofObjects`) opened, as an OSM roof is drawn (lib/city/
 * open-roofs.ts): its roof kept, its walls cut a slab's depth (`roofDepth`
 * of its footprint) under its lowest roof vertex, its floor dropped and its
 * footprint laid there facing down instead, and posts from its base up to
 * it (`roofPosts`) — a platform under one shows, a fuel station's pumps
 * stand under it. Its row stays (picking, demolish, its facts), and so
 * does its base: the posts reach it. One whose roof stands under
 * `MIN_CLEAR_M` over its base stays a block, and so does one without an
 * outline (cut, it would stand open, its underside laid nowhere).
 * `footprints`: each object's outlines (EPSG), recentered by `offset`.
 */
export function withOpenRoofs(
  v: CityVertices,
  open: ReadonlySet<number>,
  footprints: readonly (readonly [number, number][])[][],
  offset: { cx: number; cy: number }
): CityVertices {
  const levels = objectLevels(v, open);
  const cut = new Map<number, number>();
  for (const [o, l] of levels) {
    const rings = footprints[o] ?? [];
    if (rings.length === 0) {
      continue; // no outline to lay its underside on: it stays a block
    }
    const area = rings.reduce((a, r) => a + Math.abs(ringArea(r)), 0);
    const under = l.roof - roofDepth(area);
    if (Number.isFinite(under) && under - l.base >= MIN_CLEAR_M) {
      cut.set(o, under);
    }
  }
  if (cut.size === 0) {
    return v;
  }
  const out = streamBuilder(v);
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const o = v.objectIds[t];
    const under = cut.get(o);
    if (under === undefined || v.isRoof[t] === 1) {
      out.copy(t, 3);
      continue;
    }
    const tri = Array.from(v.positions.subarray(t * 3, t * 3 + 9));
    // the floor goes: the footprint is laid at the slab's underside
    if (normalZ(tri) < -0.9) {
      continue;
    }
    out.add(clipAbove(tri, under), o, 0, t);
  }
  for (const [o, under] of cut) {
    const base = levels.get(o)?.base ?? under;
    for (const ring of footprints[o] ?? []) {
      const local = ring.map(([x, y]): [number, number] => [
        x - offset.cx,
        y - offset.cy,
      ]);
      out.add(undersideOf(local, under), o, 0);
      out.add(postsMesh(roofPosts([local]), base, under).positions, o, 0);
    }
  }
  return out.done();
}

/** A ring's signed area (counter-clockwise positive). */
function ringArea(ring: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** A footprint's triangles at height `z`, facing down. */
function undersideOf(ring: readonly [number, number][], z: number): number[] {
  const open =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  const out: number[] = [];
  const tris = triangulateXY(open.flat(), []);
  for (let k = 0; k + 2 < tris.length; k += 3) {
    const [a, b, c] = [open[tris[k]], open[tris[k + 1]], open[tris[k + 2]]];
    const ccw = ringArea([a, b, c]) > 0;
    // clockwise seen from above faces down
    const [p, q] = ccw ? [c, b] : [b, c];
    out.push(a[0], a[1], z, p[0], p[1], z, q[0], q[1], z);
  }
  return out;
}

/** Builds a vertex stream from an old one's vertices and new triangles. */
function streamBuilder(v: CityVertices) {
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  const normals: number[] = [];
  const roofRgb: number[] = [];
  const surfaces: number[] = [];
  const at = (a: ArrayLike<number> | undefined, i: number, n: number) =>
    Array.from({ length: n }, (_, k) => a?.[i * n + k] ?? Number.NaN);
  return {
    /** `count` vertices of the old stream from `i` on, as they were */
    copy(i: number, count: number): void {
      for (let k = i; k < i + count; k++) {
        positions.push(...at(v.positions, k, 3));
        objectIds.push(v.objectIds[k]);
        isRoof.push(v.isRoof[k]);
        normals.push(...at(v.normals, k, 3));
        roofRgb.push(...at(v.roofRgb, k, 3));
        surfaces.push(...(v.surfaces ? at(v.surfaces, k, 2) : [-1, -1]));
      }
    },
    /** new triangles of object `o`, flat (on the surface of old vertex
     *  `like`, where given) */
    add(xyz: readonly number[], o: number, roof: number, like?: number): void {
      const surface =
        like !== undefined && v.surfaces ? at(v.surfaces, like, 2) : [-1, -1];
      for (let k = 0; k + 2 < xyz.length; k += 3) {
        positions.push(xyz[k], xyz[k + 1], xyz[k + 2]);
        objectIds.push(o);
        isRoof.push(roof);
        normals.push(Number.NaN, Number.NaN, Number.NaN);
        roofRgb.push(...FLAT_RGB);
        surfaces.push(...surface);
      }
    },
    done(): CityVertices {
      return {
        positions: Float32Array.from(positions),
        objectIds: Float32Array.from(objectIds),
        isRoof: Float32Array.from(isRoof),
        ...(v.normals ? { normals: Float32Array.from(normals) } : {}),
        ...(v.roofRgb ? { roofRgb: Float32Array.from(roofRgb) } : {}),
        ...(v.surfaces ? { surfaces: Float32Array.from(surfaces) } : {}),
      };
    },
  };
}

/** A tile's CRS, from its CityJSON's metadata; anything but ETRS89/UTM
 *  fails. */
function epsgOf(tile: string, doc: CityJsonDocument): number {
  const epsg = epsgCodeFromReferenceSystem(doc.metadata?.referenceSystem);
  if (epsg === null) {
    throw new Error(
      `Unsupported CityJSON CRS "${doc.metadata?.referenceSystem}" in ${tile} — ` +
        "expected ETRS89/UTM (EPSG:25832 or 25833)."
    );
  }
  return epsg;
}

/** The frame a tile's buildings are recentered in. */
export interface CityFrame {
  epsg: number;
  /** the recenter matrix (`bakeCityMesh`'s `sharedMatrix`) */
  matrix: Matrix4;
  offset: { cx: number; cy: number };
}

/**
 * The frame `bakeCityMesh` recenters a tile in when it is given none — the
 * loader's translation to the centre of the vertices' bounding box — without
 * parsing a building: the loader reads the document's vertices alone. The
 * spawn tile's frame is all the other tiles need of it.
 */
export function cityFrame(tile: string, source: CityJsonDocument): CityFrame {
  const epsg = epsgOf(tile, source);
  const loader = new CityJSONLoader(new CityJSONParser());
  loader.load({ ...source, CityObjects: {} });
  return { epsg, matrix: loader.matrix, offset: recenterOffset(loader.matrix) };
}

/**
 * Parses and annotates one tile. `sharedMatrix` is the spawn tile's
 * recenter matrix (null for the primary itself), exactly as the browser
 * used to pass it, so every tile lands in the same recentered frame.
 * `osmLut` holds what OSM knows per object (shops, heritage), when baked;
 * a part carries its own flags and its root Building's. `facades` is the
 * tile's wall material (the tint palette; osm_buildings.py `context`), an
 * object's own neighbourhood overriding it.
 * `measured` are the roofs rebuilt from DOM1, when baked; `onWalls` OSM's
 * doors, the surface model's dormers and the shopfronts (street photos,
 * the surface model's canopies), each on its LoD2 host, and OSM's
 * passages through the buildings, opened last.
 */
export function bakeCityMesh(
  tile: string,
  source: CityJsonDocument,
  roofColours: RoofColours | undefined,
  sharedMatrix: Matrix4 | null,
  osmLut?: OsmBuildingLut,
  scan?: readonly SmallBuildingFeature[],
  facades: FacadeMaterial = "render",
  gaps?: readonly StructureFeature[],
  measured?: readonly MeasuredRoofFeature[],
  onWalls: OnWalls = {}
): BakedCityMesh {
  // Bridges are the rail layer's (ALKIS 53001 slabs would double the decks).
  const doc = withoutTrafficStructures(source);
  const epsg = epsgOf(tile, doc);
  const keys = Object.keys(doc.CityObjects);
  // Footprints first: the loader rewrites the document it parses (a
  // Solid's semantic `values` come back flattened), after which a Solid's
  // GroundSurface can no longer be found — every BuildingPart and most
  // Buildings lost their minimap footprint that way.
  const footprintsOf = keys.map((id) =>
    buildingFootprintPolys({
      ...doc,
      CityObjects: { [id]: doc.CityObjects[id] },
    }).map((p) => p.pts.map(([x, y]): [number, number] => [cm(x), cm(y)]))
  );
  const loader = new CityJSONLoader(new CityJSONParser());
  if (sharedMatrix) {
    loader.matrix = sharedMatrix;
  }
  loader.load(doc);
  const matrix = loader.matrix;
  const offset = recenterOffset(matrix);
  // the roofs on posts LoD2 draws as blocks, opened (ALKIS Überdachung)
  const open = openRoofObjects(doc, keys);
  const v = withOpenRoofs(
    withMeasuredRoofs(
      withFaceRoofColours(
        collectVertices(loader.scene),
        keys,
        roofColours?.faces
      ),
      keys,
      offset,
      measured ?? [],
      roofColours
    ),
    open,
    footprintsOf,
    offset
  );

  // Per-object vertex scans: base (lowest Z), top and lowest ROOF vertex.
  const minZ = new Map<number, number>();
  const maxZ = new Map<number, number>();
  const roofMinZ = new Map<number, number>();
  for (let i = 0; i < v.objectIds.length; i++) {
    const idx = v.objectIds[i];
    const z = v.positions[i * 3 + 2];
    minZ.set(idx, Math.min(minZ.get(idx) ?? z, z));
    maxZ.set(idx, Math.max(maxZ.get(idx) ?? z, z));
    if (v.isRoof[i] === 1) {
      roofMinZ.set(idx, Math.min(roofMinZ.get(idx) ?? z, z));
    }
  }

  // the objects drawn as their measured parts (ADR 0036): their facts
  // say so, not what the LoD2 roof said
  const rebuilt = measuredRoofsById(measured ?? []);
  // what the windows read beyond the row: the function, OSM's storeys,
  // a facade of its own (a landmark's flag alone keeps its windows)
  const hosts: WindowExtra[] = [];
  const roofLut = roofColours?.roofs;
  const objects: CityObjectRow[] = keys.map((id, index) => {
    const o = doc.CityObjects[id];
    const root = rootOf(doc, keys, index);
    const own = o.attributes ?? {};
    // A BuildingPart takes its use (`function`) from its Building: tint,
    // roof and glow read the resolved bag; heights stay the part's own.
    const attrs = inheritedAttributes(
      own,
      doc.CityObjects[keys[root]].attributes
    );
    const baseZ = minZ.get(index) ?? 0;
    const total = (maxZ.get(index) ?? baseZ) - baseZ;
    const measured =
      typeof own.measuredHeight === "number" ? own.measuredHeight : total;
    const roofMin = roofMinZ.get(index);
    const look = inheritedLook(osmLut?.[id], osmLut?.[keys[root]]);
    const osm = inheritedOsm(osmLut?.[id], osmLut?.[keys[root]]);
    const eaveH = roofMin === undefined ? total : Math.max(roofMin - baseZ, 0);
    const footprints = footprintsOf[index];
    const context = look.context ?? facades;
    hosts[index] = {
      ...windowExtra(attrs, eaveH, osm),
      brick: brickWalls(attrs, context, look),
    };
    const monumental = hosts[index].monumental ?? false;
    return {
      building: o.type === "Building",
      root,
      baseZ: cm(baseZ),
      eaveH: cm(eaveH),
      flags: structureFlags(
        facadeFlags(
          inheritedFlags(osmLut?.[id], osmLut?.[keys[root]]),
          monumental
        ),
        hosts[index].fn
      ),
      storeyH: cm(
        mappedStoreyHeight(eaveH, measured, osm?.levels, osm?.storey)
      ),
      glow: buildingGlows(attrs) ? 1 : 0,
      rough: r3(roughJitter(id)),
      tint: rgb(buildingTint(id, attrs, context, look)),
      roof: rgb(roofColor(id, attrs, roofLut, look)),
      drawn: drawnOf(attrs, context, look, osm, {
        eaveH,
        own: hosts[index].why ?? null,
        roof: roofColourSource(id, roofLut, look),
      }),
      footprints,
      facts: lod2Facts({
        buildingId: keys[root],
        own,
        resolved: attrs,
        osm,
        fallbackHeight: total,
        footprints,
        rebuilt: rebuilt.has(id),
        shaped: rebuilt.get(id)?.some((f) => f.properties?.surface) ?? false,
      }),
    };
  });

  // a part of a building whose facade is its own shares it where OSM's
  // storeys are the building's (a hall's raised roof)
  objects.forEach((o, i) => {
    const own = partFacade(
      hosts[i].monumental ?? false,
      i !== o.root && (hosts[o.root].monumental ?? false),
      o.eaveH,
      hosts[i].storeys
    );
    if (own && !hosts[i].monumental) {
      hosts[i].monumental = true;
      // a hall's raised roof has no windows; a palace's wing keeps its
      // building's (its storey is the palace's, `palaceStorey`)
      hosts[i].palace = hosts[o.root].palace ?? false;
      o.flags = facadeFlags(o.flags, true);
      if (o.drawn) {
        o.drawn = { ...o.drawn, own: "part" };
      }
    }
  });

  // A Building with parts answers for its whole tree (the inquiry card
  // reads it): the union of the footprints, the tree's height.
  const trees = new Map<number, number[]>();
  objects.forEach((o, i) =>
    trees.set(o.root, [...(trees.get(o.root) ?? []), i])
  );
  for (const [root, members] of trees) {
    const facts = objects[root].facts;
    if (members.length > 1 && facts) {
      objects[root].facts = treeFacts(
        facts,
        // only what has geometry: a Building drawn by its parts has no
        // base of its own
        members
          .filter((i) => minZ.has(i))
          .map((i) => ({
            baseZ: minZ.get(i) ?? 0,
            topZ: maxZ.get(i) ?? 0,
            footprints: footprintsOf[i],
          })),
        typeof doc.CityObjects[keys[root]].attributes?.measuredHeight ===
          "number" && members.every((i) => !rebuilt.has(keys[i]))
      );
    }
  }

  joinEnsembles(
    objects,
    trees,
    (root) => osmLut?.[keys[root]]?.outline ?? "",
    (i) =>
      minZ.has(i)
        ? {
            baseZ: minZ.get(i) ?? 0,
            topZ: maxZ.get(i) ?? 0,
            footprints: footprintsOf[i],
          }
        : undefined
  );

  const baked: BakedCityMesh = { epsg, matrix, objects, offset, vertices: v };
  markFlatRoofs(objects, v);
  markTownHouses(objects, hosts);
  markOpenRoofs(objects, open);
  const passages = dressWalls(tile, baked, keys, hosts, onWalls, {
    facades,
    gaps,
    roofColours,
    scan,
  });
  withPassages(baked, passages);
  for (const o of objects) {
    if (o.facts) {
      o.facts = { ...o.facts, drawn: encodeDrawn(o.drawn) };
    }
  }
  return baked;
}

/**
 * How an object's walls, roof and storeys are drawn and from what (lib/
 * city/drawn-facts.ts), as `buildingTint`, `roofColor` and
 * `mappedStoreyHeight` decide; the windows join it in `assignWindows`.
 */
function drawnOf(
  attrs: Record<string, unknown>,
  context: FacadeMaterial,
  look: ReturnType<typeof inheritedLook>,
  osm: OsmBuildingFacts | undefined,
  o: { eaveH: number; own: DrawnFacts["own"] | null; roof: RoofColourSource }
): DrawnFacts {
  const wall = wallColourSource(attrs, context, look);
  const own = o.own;
  return {
    wall,
    ...(look.colour ? { colour: look.colour } : {}),
    ...(look.material ? { material: look.material } : {}),
    ...(look.materialFrom ? { materialFrom: look.materialFrom } : {}),
    ...(wall === "brick" ? { context } : {}),
    roof: o.roof,
    ...(look.roof_colour ? { roofColour: look.roof_colour } : {}),
    storey: countsStoreys(o.eaveH, osm?.levels)
      ? "osm"
      : (osm?.storey ?? 0) > 0 && o.eaveH >= 2.5
        ? "neighbours"
        : "height",
    ...(own ? { own } : {}),
    ...(osm?.wikidata ? { wikidata: osm.wikidata } : {}),
  };
}

/**
 * Building trees that are one building to a visitor (lib/city/ensembles.ts)
 * share an `ensemble`, the lowest root among them, whose facts become the
 * whole ensemble's: the union of its footprints, its lowest base to its
 * highest top (one tree's surveyed height does not describe the others);
 * its `group` the key of its OSM outline, so the trees a tile edge cuts it
 * into are asked together.
 */
export function joinEnsembles(
  objects: Pick<
    CityObjectRow,
    "ensemble" | "facts" | "footprints" | "group" | "root"
  >[],
  trees: ReadonlyMap<number, readonly number[]>,
  outlineOf: (root: number) => string,
  extent: (
    i: number
  ) =>
    | { baseZ: number; footprints: [number, number][][]; topZ: number }
    | undefined
): void {
  const named = [...trees].flatMap(([root, members]) => {
    // the root's name, else its first named part's
    const name =
      [root, ...members]
        .map((i) => objects[i].facts?.name ?? "")
        .find((n) => n !== "") ?? "";
    const outline = outlineOf(root);
    return name || outline
      ? [
          {
            root,
            name,
            outline,
            rings: members.flatMap((i) => objects[i].footprints),
          },
        ]
      : [];
  });
  const lead = ensembleRoots(named);
  // the ensemble's outline: the first of its trees' (they share one, but
  // for a tree joined by its name alone)
  const outlines = new Map<number, string>();
  for (const t of named) {
    const to = lead.get(t.root) ?? t.root;
    const had = outlines.get(to);
    if (t.outline && !(had && had < t.outline)) {
      outlines.set(to, t.outline);
    }
  }
  const joined = new Map<number, number[]>();
  for (const [root, members] of trees) {
    const to = lead.get(root) ?? root;
    const group = ensembleGroup(outlines.get(to) ?? "");
    for (const i of members) {
      objects[i].ensemble = to;
      objects[i].group = group;
    }
    const all = joined.get(to);
    if (all) {
      all.push(...members);
    } else {
      joined.set(to, [...members]);
    }
  }
  for (const [to, members] of joined) {
    const facts = objects[to].facts;
    if (facts && members.some((i) => objects[i].root !== to)) {
      objects[to].facts = treeFacts(
        facts,
        members.flatMap((i) => extent(i) ?? []),
        false
      );
    }
  }
}

export interface CityMesh {
  /** per-object minimap footprints (EPSG) */
  footprints: [number, number][][][];
  input: Omit<MeshInput, "extras" | "name">;
  maxElevation: number;
}

/** The stream's vertex normals: a curve LoD2 drew as facets rounded off
 *  within one object's walls or roofs, corners kept crisp
 *  (lib/city/crease-normals.ts); a triangle shaded otherwise is left out. */
export function vertexNormals(v: CityVertices): Float32Array {
  const groups = new Float64Array(v.objectIds.length);
  for (let i = 0; i < groups.length; i++) {
    groups[i] = 2 * v.objectIds[i] + (v.isRoof[i] === 1 ? 1 : 0);
  }
  const shaded = v.normals;
  return creaseNormals(v.positions, groups, {
    skip: shaded ? (t) => !Number.isNaN(shaded[9 * t]) : undefined,
  });
}

/** The flat normals with every vertex `shading` gives one (not NaN) — a
 *  measured roof face's, smoothed over it — taking that one instead. */
function withShading(
  flat: Float32Array,
  shading: Float32Array | undefined
): Float32Array {
  if (!shading) {
    return flat;
  }
  for (let i = 0; i < flat.length; i++) {
    if (!Number.isNaN(shading[i])) {
      flat[i] = shading[i];
    }
  }
  return flat;
}

/**
 * The building mesh with its property table: normals from the
 * non-indexed stream (flat, curves rounded), then welded (vertices of equal position, normal,
 * object and place on their wall, the roof flag in it, merge — never across
 * objects).
 */
export function cityMesh(baked: BakedCityMesh): CityMesh {
  const v = baked.vertices;
  const t = objectTable(baked.objects);
  const facts = factColumns(baked.objects.map((o) => o.facts));
  const table: PropertyTable = {
    className: "building",
    count: t.count,
    properties: {
      baseZ: { type: "SCALAR", componentType: "FLOAT32", values: t.baseZ },
      building: { type: "SCALAR", componentType: "UINT8", values: t.building },
      eaveH: { type: "SCALAR", componentType: "FLOAT32", values: t.eaveH },
      flags: { type: "SCALAR", componentType: "UINT16", values: t.flags },
      glow: { type: "SCALAR", componentType: "UINT8", values: t.glow },
      roof: { type: "VEC3", componentType: "FLOAT32", values: t.roof },
      root: { type: "SCALAR", componentType: "UINT32", values: t.root },
      ensemble: {
        type: "SCALAR",
        componentType: "UINT32",
        values: t.ensemble,
      },
      group: { type: "SCALAR", componentType: "UINT32", values: t.group },
      rough: { type: "SCALAR", componentType: "FLOAT32", values: t.rough },
      source: { type: "SCALAR", componentType: "UINT8", values: t.source },
      storeyH: { type: "SCALAR", componentType: "FLOAT32", values: t.storeyH },
      tint: { type: "VEC3", componentType: "FLOAT32", values: t.tint },
      // the windows the clay draws (lib/city/windows.ts)
      winAxis: { type: "SCALAR", componentType: "FLOAT32", values: t.winAxis },
      winH: { type: "SCALAR", componentType: "FLOAT32", values: t.winH },
      winStyle: { type: "SCALAR", componentType: "UINT32", values: t.winStyle },
      winW: { type: "SCALAR", componentType: "FLOAT32", values: t.winW },
      // What the object is, for the inquiry card (ADR 0042): read one row
      // at a time, only when asked — never packed for the shader.
      ...Object.fromEntries(
        Object.entries(facts.strings).map(([name, values]) => [
          name,
          { type: "STRING", values } satisfies Column,
        ])
      ),
      ...Object.fromEntries(
        Object.entries(facts.enums).map(([name, values]) => [
          name,
          { type: "ENUM", values } satisfies Column,
        ])
      ),
      ...Object.fromEntries(
        Object.entries(facts.numbers).map(([name, values]) => [
          name,
          {
            type: "SCALAR",
            componentType: "FLOAT32",
            values,
            noData: NO_FACT,
          } satisfies Column,
        ])
      ),
    },
  };
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let i = 2; i < v.positions.length; i += 3) {
    maxElevation = Math.max(maxElevation, v.positions[i]);
  }
  return {
    footprints: baked.objects.map((o) => o.footprints),
    input: {
      positions: v.positions,
      normals: withShading(vertexNormals(v), v.normals),
      attributes: { _FEATURE_ID_0: v.objectIds },
      // the place on the wall, a roof vertex flagged in it (FACADE_ROOF)
      vectors: {
        _FACADE: {
          array: v.facade ?? facadeAttribute(v, () => false),
          type: "VEC4",
        },
      },
      table,
      weld: true,
    },
    maxElevation,
  };
}

/**
 * The walls' storeys, windows and parts, in the order they read each
 * other: the storeys counted from the street, then the windows (the
 * plinths' and shopfronts' heights read the storey they snap to the
 * eave), then the parts beyond LoD2, and last each wall vertex's place on
 * its wall. The passages OSM maps through the walls (`passagePlans`, as
 * high as the storeys now say) keep the windows off their portals and
 * OSM's doors out of their openings; they are returned, to be cut last
 * (`withPassages`).
 */
function dressWalls(
  tile: string,
  baked: BakedCityMesh,
  keys: readonly string[],
  hosts: readonly WindowExtra[],
  all: OnWalls,
  extra: {
    facades: FacadeMaterial;
    gaps?: readonly StructureFeature[];
    roofColours?: RoofColours;
    scan?: readonly SmallBuildingFeature[];
  }
): PassagePlan[] {
  // a tank, a crane or a canopy: no doorway, plinth or shop band on it
  const onBuilt = onBuildings(all, keys, hosts);
  const plinths = onBuilt.plinths ?? [];
  // the storeys count from the street, where the plinths say where it is
  const asBuilt = liftToStreet(baked.objects, keys, plinths);
  const rises = groundRises(baked, onBuilt.groundAt);
  const reach = assignWindows(
    baked.objects,
    keys,
    hosts,
    onBuilt.windows ?? [],
    plinths,
    rises && { objectIds: baked.vertices.objectIds, rises }
  );
  const passages = passagePlans(
    baked.objects,
    keys,
    onBuilt.passages ?? [],
    baked.offset
  );
  const onWalls = {
    ...onBuilt,
    ...(onBuilt.doors && {
      doors: outsidePassages(onBuilt.doors, passages, keys, baked),
    }),
  };
  appendBeyondLod2(tile, baked, keys, { ...onWalls, ...extra });
  // standing on the ground or on a roof: as LoD2 built them
  markGrounded(baked.objects, asBuilt);
  // the parts laid on the walls copied their host's row: windows are the
  // LoD2 walls' alone
  for (const o of baked.objects) {
    if ((o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2) {
      delete o.windows;
    }
  }
  const reachOf = (i: number) => reach[i] ?? GROUND_REACH_M;
  baked.vertices.facade = facadeOf(
    baked,
    keys,
    onWalls,
    reachOf,
    rises && { at: rises, reach: reachOf },
    portalDoors(passages)
  );
  return passages;
}

/** What stands on the walls of buildings alone: the doors, plinths and
 *  shopfronts of a structure that is no building (lib/city/building-tint.ts
 *  `isStructure`: a tank, a silo, a crane, a canopy) left out — OSM's
 *  entrance on a petrol station's canopy, a shop sign the photos read on a
 *  silo. */
export function onBuildings(
  onWalls: OnWalls,
  keys: readonly string[],
  hosts: readonly Pick<WindowExtra, "fn">[]
): OnWalls {
  const index = new Map(keys.map((id, i) => [id, i]));
  const building = (of: string | undefined) => {
    const i = of === undefined ? undefined : index.get(of);
    return i === undefined || !isStructure(hosts[i]?.fn);
  };
  const { doors, plinths, shopfronts } = onWalls;
  return {
    ...onWalls,
    ...(doors && { doors: doors.filter((f) => building(f.properties?.of)) }),
    ...(plinths && {
      plinths: plinths.filter((f) => building(f.properties?.of)),
    }),
    ...(shopfronts && {
      shopfronts: shopfronts.filter((w) => building(w.oid)),
    }),
  };
}

/** How far the ground in front of each LoD2 wall triangle rises over its
 *  object's base (lib/city/windows.ts `wallRises`), where the fine ground
 *  is known. */
function groundRises(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  groundAt: OnWalls["groundAt"]
): Float32Array | undefined {
  if (!groundAt) {
    return undefined;
  }
  const { cx, cy } = baked.offset;
  return wallRises(
    baked.vertices,
    (i) => {
      const o = baked.objects[i];
      return o && (o.source ?? OBJECT_SOURCE_LOD2) === OBJECT_SOURCE_LOD2
        ? o.baseZ
        : undefined;
    },
    (x, y) => groundAt(x + cx, y + cy)
  );
}

/** What the windows read of an object beyond its row: its function,
 *  whether OSM counts its storeys, a facade of its own. */
function windowExtra(
  attrs: Record<string, unknown>,
  eaveH: number,
  osm: OsmBuildingFacts | undefined
): WindowExtra {
  const why = ownFacadeReason(
    attrs,
    eaveH,
    osm?.levels,
    (osm?.heritage ?? 0) > 0
  );
  return {
    fn: typeof attrs.function === "string" ? attrs.function : undefined,
    levels: (osm?.levels ?? 0) >= 1,
    monumental: why !== null,
    palace: palatialFacade(attrs),
    ...(why ? { why } : {}),
    storeys: osm?.levels,
  };
}

/** The flags of a structure that is no building (lib/city/building-tint.ts
 *  `isStructure`: a tank, a crane, a canopy) without OSM's shop: no shop
 *  zone and no shop's light on it — a kiosk mapped on a petrol station's
 *  canopy is the station's. */
function structureFlags(flags: number, fn: string | undefined): number {
  return isStructure(fn) && hasObjectFlag(flags, OBJECT_FLAG_SHOP)
    ? flags - OBJECT_FLAG_SHOP
    : flags;
}

/** The flags with OBJECT_FLAG_LANDMARK and OBJECT_FLAG_OWN_FACADE where
 *  the facade is its own. */
function facadeFlags(flags: number, own: boolean): number {
  if (!own) {
    return flags;
  }
  const landmark = hasObjectFlag(flags, OBJECT_FLAG_LANDMARK)
    ? 0
    : OBJECT_FLAG_LANDMARK;
  const facade = hasObjectFlag(flags, OBJECT_FLAG_OWN_FACADE)
    ? 0
    : OBJECT_FLAG_OWN_FACADE;
  return flags + landmark + facade;
}

/** What the tile's mesh carries beyond LoD2: the scan's sheds, the
 *  surface model's structures and dormers, OSM's doors (each on its LoD2
 *  host). */
function appendBeyondLod2(
  tile: string,
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  keys: readonly string[],
  extra: {
    doors?: readonly DoorFeature[];
    dormers?: readonly DormerFeature[];
    facades: FacadeMaterial;
    plinths?: readonly PlinthFeature[];
    shopfronts?: readonly ShopfrontWall[];
    gaps?: readonly StructureFeature[];
    roofColours?: RoofColours;
    scan?: readonly SmallBuildingFeature[];
  }
): void {
  // Each append copies the whole vertex stream and leaves its parts' plain
  // arrays behind: Bun's lazy collector let them pile up over the six, and
  // a München tile's bands alone left 2.5 GiB (its cold bake peaked at
  // 6.1 GiB, past what Vercel's 8 GB builder holds). Collected after each,
  // the tile stays near one append's peak.
  const appended = () => Bun.gc(true);
  if (extra.scan) {
    appendScanStructures(tile, baked, extra.scan, extra.roofColours?.scan);
    appended();
  }
  const objectIndex = new Map(keys.map((id, i) => [id, i]));
  if (extra.gaps) {
    appendGapStructures(
      tile,
      baked,
      extra.gaps,
      extra.facades,
      objectIndex,
      extra.roofColours?.gaps
    );
    appended();
  }
  if (extra.plinths) {
    appendPlinths(baked, extra.plinths, objectIndex);
    appended();
  }
  if (extra.shopfronts) {
    // before the doors: a bay is cut at a door, which the doors then draw
    appendShopfronts(baked, extra.shopfronts, extra.doors ?? [], objectIndex);
    appended();
  }
  if (extra.doors) {
    appendDoors(baked, extra.doors, objectIndex);
    appended();
  }
  if (extra.dormers) {
    appendDormers(baked, extra.dormers, objectIndex);
    appended();
  }
}

/** Each building tree's triangles (its root → each triangle's first vertex):
 *  the walls a door is laid on. */
function treeTriangles(
  baked: Pick<BakedCityMesh, "objects" | "vertices">
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const ids = baked.vertices.objectIds;
  for (let t = 0; t + 2 < ids.length; t += 3) {
    const root = baked.objects[ids[t]]?.root;
    if (root !== undefined) {
      const list = out.get(root);
      if (list) {
        list.push(t);
      } else {
        out.set(root, [t]);
      }
    }
  }
  return out;
}

/** A plinth's stone: its wall's tint, a touch darker and cooler. */
const PLINTH_STONE: [number, number, number] = [0.62, 0.62, 0.64];
/** What a plinth's host must not be: a facade of its own (a landmark, a
 *  church), a part with its own colour, glass or metal cladding, or a
 *  flat-roofed block — the painted Gliederung's own gate. */
const NO_PLINTH =
  OBJECT_FLAG_LANDMARK |
  OBJECT_FLAG_OWN_COLOUR |
  OBJECT_FLAG_GLASS |
  OBJECT_FLAG_METAL |
  OBJECT_FLAG_FLAT_ROOF;
/** A part whose base stands this far over the ground at its plinth stands
 *  on a roof (a tower's part), not on the street. */
const PLINTH_ON_GROUND_M = 1.5;

/** Whether a plinth piece is drawn on its host: not on a facade of its
 *  own, glass, metal or a flat-roofed block (`NO_PLINTH`) — a flat-roofed
 *  town house carries one (`townHouse`) —, not under 3 m of wall, not on a
 *  part standing on a roof. */
function carriesPlinth(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "flags" | "townHouse">,
  ground: readonly number[]
): boolean {
  const gate = host.townHouse ? NO_PLINTH & ~OBJECT_FLAG_FLAT_ROOF : NO_PLINTH;
  return (
    (host.flags & gate) === 0 &&
    host.eaveH >= 3 &&
    host.baseZ <= Math.min(...ground) + PLINTH_ON_GROUND_M
  );
}

/** Whether a plinth's host also carries a town house's cornices, the
 *  Gurtgesims and the Traufgesims: a town house — storeys from
 *  `TALL_STOREY_M`, listed, or a flat-roofed one (`townHouse`). A post-war
 *  house keeps its plinth but has no cornices (München's, Unna's, the
 *  suburbs'). */
export function carriesCornices(
  host: Pick<CityObjectRow, "flags" | "storeyH" | "townHouse">
): boolean {
  return (
    (host.townHouse ?? false) ||
    host.storeyH >= TALL_STOREY_M ||
    hasObjectFlag(host.flags, OBJECT_FLAG_HERITAGE)
  );
}

/**
 * The plinths on the LoD2 walls' street side (pipeline/bake/plinths.py),
 * appended as part of the building they carry, like its doors: one object
 * per host in a stone shade of the host's tint, the host's building tree
 * (asking or demolishing it takes the building), no footprint, no storey
 * band or eave line on it, `source` 5. Only a house carries one: a host
 * from 3 m of wall, standing on the street, not `NO_PLINTH` (a flat-roofed
 * town house is no block). Along the same stretches of a town house
 * (`carriesCornices`) the Gurtgesims over its ground floor
 * (`corniceHeight`) and the Traufgesims under its eave where the roof runs
 * level along the wall (`eaveAlong`: the wall's own roof edge, a front
 * rising over its object's lowest roof included), each an object in a
 * plaster shade a touch paler than the wall. Each band runs on from house to house along
 * a row (`joinStretches`): over the gaps LoD2's footprints leave between
 * them, at one level where theirs lie close.
 */
export function appendPlinths(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  plinths: readonly PlinthFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  const parts: AppendedPart[] = [];
  const walls = treeTriangles(baked);
  const vertices = baked.vertices.positions;
  const isRoof = baked.vertices.isRoof;
  const roofs = new Map<number, number[]>();
  for (const [root, tris] of walls) {
    roofs.set(
      root,
      tris.filter((t) => isRoof[t] === 1)
    );
  }
  const part = (
    tris: Shaded,
    host: CityObjectRow,
    tint: [number, number, number]
  ) => {
    if (tris.positions.length < 3) {
      return;
    }
    let base = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    for (let i = 2; i < tris.positions.length; i += 3) {
      base = Math.min(base, tris.positions[i]);
      top = Math.max(top, tris.positions[i]);
    }
    parts.push({ id: baked.objects.length, ...tris });
    const above = cm(top - base + 1);
    baked.objects.push({
      ...host,
      building: false,
      baseZ: cm(base),
      // above its top: no eave stroke, no storey band on it
      eaveH: above,
      storeyH: above,
      glow: 0,
      // its own colour, none of the host's OSM looks (no shop wash)
      flags: OBJECT_FLAG_OWN_COLOUR,
      tint,
      source: OBJECT_SOURCE_PLINTH,
      footprints: [],
    });
  };
  const wallOf = (h: number) => walls.get(baked.objects[h].root) ?? [];
  const shift: HostShift = (h, a, b, z0, z1) =>
    wallShiftKnots([a, b], [z0, z1], baked.offset, vertices, wallOf(h));
  const bands: Record<BandKind, Stretch[]> = {
    plinth: [],
    cornice: [],
    eave: [],
  };
  for (const f of plinths) {
    const p = f.properties;
    const hostIndex = p ? objectIndex.get(p.of) : undefined;
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(p && host && hostIndex !== undefined && carriesPlinth(host, p.g))) {
      continue;
    }
    bands.plinth.push(...plinthStretches(f, hostIndex));
    if (!carriesCornices(host)) {
      continue;
    }
    const top = Math.max(...p.top);
    const z = corniceHeight(host, top);
    if (z !== undefined) {
      bands.cornice.push(...lineStretches(f, hostIndex, z));
    }
    bands.eave.push(
      ...eaveStretches(f, hostIndex, host, z ?? top, (a, b, z0, z1) =>
        eaveAlong(
          [a, b],
          wallShiftAlong(
            [a, b],
            [z0, z1],
            baked.offset,
            vertices,
            wallOf(hostIndex)
          ),
          baked.offset,
          vertices,
          roofs.get(host.root) ?? []
        )
      )
    );
  }
  const tolerance: Record<BandKind, number> = {
    plinth: 0.2,
    cornice: 0.6,
    eave: EAVE_STEP_M,
  };
  for (const kind of ["plinth", "cornice", "eave"] as const) {
    const joined = joinStretches(
      bands[kind],
      kind === "plinth" ? "plinth" : "line",
      tolerance[kind]
    );
    for (const [h, tris] of bandMeshes(joined, baked.offset, kind, shift)) {
      const host = baked.objects[h];
      // close to the wall: the form, not the colour, carries it
      const tint =
        kind === "plinth"
          ? mixRgb(
              host.tint.map((c) => c * 0.9),
              PLINTH_STONE,
              0.25
            )
          : mixRgb(host.tint, SURROUND_STONE, 0.08);
      part(tris, host, tint);
    }
  }
  if (parts.length > 0) {
    baked.vertices = withParts(baked.vertices, parts);
  }
}

/** Triangles appended to the stream under one object id, a normal per
 *  vertex (NaN: flat). */
interface AppendedPart {
  id: number;
  normals: readonly number[];
  positions: readonly number[];
}

/** The vertex stream with `parts` appended (none of them roof), written
 *  straight into typed arrays: a tile's plinths and bands run to millions
 *  of coordinates, which a spread push and a copy through plain arrays
 *  spent seconds a tile on. */
function withParts(
  v: CityVertices,
  parts: readonly AppendedPart[]
): CityVertices {
  const own = v.objectIds.length;
  const total = parts.reduce((n, p) => n + p.positions.length / 3, own);
  const positions = new Float32Array(3 * total);
  const normals = new Float32Array(3 * total);
  const objectIds = new Float32Array(total);
  const isRoof = new Float32Array(total);
  positions.set(v.positions);
  if (v.normals) {
    normals.set(v.normals);
  } else {
    normals.fill(Number.NaN, 0, v.positions.length);
  }
  objectIds.set(v.objectIds);
  isRoof.set(v.isRoof);
  let at = own;
  for (const p of parts) {
    for (let i = 0; i < p.positions.length; i++) {
      positions[3 * at + i] = p.positions[i];
      normals[3 * at + i] = p.normals[i];
    }
    const n = p.positions.length / 3;
    objectIds.fill(p.id, at, at + n);
    at += n;
  }
  return { positions, objectIds, isRoof, normals, ...lod2RoofColours(v) };
}

/** Neighbouring houses' Traufgesimse this close in height run as one. */
const EAVE_STEP_M = 0.25;
/** A Traufgesims from this much wall, and this far over the band below. */
const EAVE_MIN_M = 5;
const EAVE_CLEAR_M = 1.5;

/** A host's Traufgesims along its plinth's straight runs: where the roof
 *  runs level along the wall (`eave`), its underside `EAVE_CORNICE.height`
 *  under the eave — on a wall from `EAVE_MIN_M`, `EAVE_CLEAR_M` over the
 *  band below it (`under`: the Gurtgesims, or the plinth's top). */
function eaveStretches(
  f: PlinthFeature,
  hostIndex: number,
  host: CityObjectRow,
  under: number,
  /** the eave along a→b, the wall read between two heights */
  eave: (
    a: readonly number[],
    b: readonly number[],
    z0: number,
    z1: number
  ) => number | undefined
): Stretch[] {
  const guess = host.baseZ + host.eaveH;
  return straightRuns(f.geometry.coordinates).flatMap(([a, b]) => {
    const e = eave(a, b, guess - 1.5, guess - 0.5);
    const z = e === undefined ? undefined : e - EAVE_CORNICE.height;
    return z !== undefined &&
      e !== undefined &&
      e - host.baseZ >= EAVE_MIN_M &&
      z > under + EAVE_CLEAR_M
      ? [{ a, b, lo: z, hi: z, host: hostIndex }]
      : [];
  });
}

/** Where a host's Gurtgesims sits (its underside, absolute): straddling
 *  the first storey line over the host's base, as the painted ledge did —
 *  only where the wall holds two storeys and the line stands a metre
 *  clear of the plinth's top. */
export function corniceHeight(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "storeyH">,
  plinthTop: number
): number | undefined {
  const storey = Math.max(host.storeyH, 2.4);
  if (host.eaveH < 2 * storey - 0.3) {
    return undefined;
  }
  const z = host.baseZ + storey - CORNICE.height / 2;
  return z > plinthTop + 1 ? z : undefined;
}

/** A doorway's surround: its wall's tint, lifted towards a pale stone. */
const SURROUND_STONE: [number, number, number] = [0.88, 0.85, 0.78];
/** A door leaf: dark wood in its wall's cast; a garage door a calm grey. */
const LEAF_WOOD: [number, number, number] = [0.31, 0.24, 0.18];
const LEAF_GARAGE: [number, number, number] = [0.5, 0.5, 0.48];

const mixRgb = (
  a: readonly number[],
  b: readonly number[],
  t: number
): [number, number, number] => [
  r3(a[0] + (b[0] - a[0]) * t),
  r3(a[1] + (b[1] - a[1]) * t),
  r3(a[2] + (b[2] - a[2]) * t),
];

/**
 * OSM's entrances on the LoD2 walls (pipeline/bake/doors.py), appended as
 * part of the object they open, like a landmark's relief: two objects per
 * door (the surround and the leaf, each its own tint), the host's building
 * tree (asking or demolishing a door takes the building), no footprint, no
 * storey band or eave line on them, `source` 3. A door whose host the tile
 * does not hold is dropped.
 */
export function appendDoors(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  doors: readonly DoorFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  if (doors.length === 0) {
    return;
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const walls = treeTriangles(baked);
  for (const f of doors) {
    const p = f.properties;
    const hostIndex = p ? objectIndex.get(p.of) : undefined;
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    // a landmark's or a church's portal is its own: no generic door on it
    if (!(p && host) || hasObjectFlag(host.flags, OBJECT_FLAG_LANDMARK)) {
      continue;
    }
    const shift = wallShift(
      f,
      baked.offset,
      baked.vertices.positions,
      walls.get(host.root) ?? []
    );
    const mesh = doorMesh(f, baked.offset, shift);
    const base = p.z - DOOR_SINK;
    const top = p.h + DOOR_SINK + DOOR_SURROUND.width;
    const part = (tris: number[], tint: [number, number, number]) => {
      const index = baked.objects.length;
      positions.push(...tris);
      for (let i = 0; i < tris.length / 3; i++) {
        objectIds.push(index);
      }
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above the door: no eave stroke, no storey band on it
        eaveH: cm(top + 1),
        storeyH: cm(top + 1),
        glow: 0,
        // its own colour, none of the host's OSM looks (no shop wash)
        flags: OBJECT_FLAG_OWN_COLOUR,
        tint,
        source: OBJECT_SOURCE_DOOR,
        footprints: [],
      });
    };
    // as calm as the painted plinth and cornices: the surround barely off
    // its wall, the leaf a shade of the wall rather than a dark hole
    part(mesh.surround, mixRgb(host.tint, SURROUND_STONE, 0.2));
    part(
      mesh.leaf,
      mixRgb(
        host.tint.map((c) => c * 0.62),
        p.kind === "garage" ? LEAF_GARAGE : LEAF_WOOD,
        p.kind === "main" ? 0.45 : 0.3
      )
    );
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(
      v.isRoof,
      objectIds.map(() => 0)
    ),
    ...flatNormalsAfter(v, positions.length),

    ...lod2RoofColours(v),
  };
}

/** The clay's base colour (the material's 0xece7df, linear) and how much
 *  of a building's tint the walls show at Farbvariation's fixed strength
 *  (app/_components/visual-style.ts `TINT`): a wall as one sees it. */
const CLAY_BASE: [number, number, number] = [0.838, 0.799, 0.737];
const WALL_TINT_SHOWN = 0.6;
/** A shop window: a muted glass a little darker and cooler than its wall
 *  — the wall as shown, darkened, drawn towards a cool slate — not a
 *  black hole; smooth enough to hold a calm reflection of the sun (its
 *  `rough` column is the pane's roughness, read as such for own-colour
 *  glass) and of the sky (the clay's `paneSky`,
 *  app/_components/visual-style.ts). */
const PANE_SLATE: [number, number, number] = [0.07, 0.09, 0.12];
const PANE_ROUGH = 0.2;
/** A shopfront's surround and fascia: its wall as shown, a shade darker
 *  and a touch cooler — part of the wall, not a frame. */
const SURROUND_COOL: [number, number, number] = [0.52, 0.55, 0.6];
/** A host this far above the ground in front of its wall stands on another
 *  part (a storey on a podium, a roof terrace): no shopfront on it. */
const SHOP_HOST_ABOVE_M = 2;

/** The shop glass and the surround for a host of tint `tint` (linear). */
export function shopfrontColours(tint: readonly number[]): {
  glass: [number, number, number];
  surround: [number, number, number];
} {
  const wall = mixRgb(CLAY_BASE, tint, WALL_TINT_SHOWN);
  return {
    glass: mixRgb(
      wall.map((c) => c * 0.4),
      PANE_SLATE,
      0.45
    ),
    surround: mixRgb(
      wall.map((c) => c * 0.9),
      SURROUND_COOL,
      0.12
    ),
  };
}

/**
 * The shopfronts on the LoD2 walls (pipeline/bake/shopfronts.py: bays and
 * signs from street photos, canopies from the surface model), appended as
 * part of the object they front, like the doors: per wall one object per
 * run of glass (its `eaveH` the pane's top, where the head's soft shadow
 * falls — `paneShade` in visual-style.ts), the surrounds and fascias as one
 * (rounded: their own smooth normals), the canopy in the host's own clay;
 * the host's building tree (asking or demolishing one takes the
 * building), no footprint, no storey band or eave line on them, `source` 6
 * (a wall with a sign and no bay gets its fascia alone).
 * Skipped: a host the tile does not hold, a glass or metal
 * facade (its own front), a host not on the ground; a bay is cut where an
 * OSM door stands. Returns the walls drawn.
 */
export function appendShopfronts(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  walls: readonly ShopfrontWall[],
  doors: readonly DoorFeature[],
  objectIndex: ReadonlyMap<string, number>
): number {
  const positions: number[] = [];
  const normals: number[] = [];
  const objectIds: number[] = [];
  const trees = treeTriangles(baked);
  const rootOf = (id: string) => {
    const i = objectIndex.get(id);
    return i === undefined ? undefined : baked.objects[i]?.root;
  };
  let drawn = 0;
  for (const w of walls) {
    const hostIndex = objectIndex.get(w.oid);
    const host = hostIndex === undefined ? undefined : baked.objects[hostIndex];
    if (!(host && w.z) || !shopHost(host, w)) {
      continue;
    }
    const bays = wallBays(
      w,
      doorSpans(w, doors, (of) => rootOf(of) === host.root)
    );
    const triangles = trees.get(host.root) ?? [];
    const mesh = shopfrontMesh(w, bays, host.storeyH, baked.offset, (span) =>
      wallShiftAt(w, span, baked.offset, baked.vertices.positions, triangles)
    );
    if (
      mesh.panes.length === 0 &&
      mesh.frame.positions.length === 0 &&
      mesh.canopy.positions.length === 0
    ) {
      continue;
    }
    drawn++;
    const base = footAt(w, [0, w.L]);
    const above = cm(
      Math.max(...(w.z ?? [0])) -
        base +
        Math.max(
          paneTop(w, host.storeyH) + SHOPFRONT.head + CANOPY.tuck,
          w.sign?.z?.[1] ?? 0,
          ...(w.canopy ?? []).map((c) => c.h)
        ) +
        1
    );
    const part = (
      tris: Shaded,
      tint: [number, number, number],
      flags: number,
      rough: number,
      eaveH = above
    ) => {
      const index = baked.objects.length;
      positions.push(...tris.positions);
      normals.push(...tris.normals);
      for (let i = 0; i < tris.positions.length / 9; i++) {
        objectIds.push(index, index, index);
      }
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above the shopfront: no eave stroke, no storey band on it
        eaveH,
        storeyH: above,
        glow: 0,
        // its own colour, none of the host's OSM looks (no shop wash)
        flags,
        rough,
        tint,
        source: OBJECT_SOURCE_SHOPFRONT,
        footprints: [],
      });
    };
    const colours = shopfrontColours(host.tint);
    for (const pane of mesh.panes) {
      part(
        {
          positions: pane.positions,
          normals: pane.positions.map(() => Number.NaN),
        },
        colours.glass,
        OBJECT_FLAG_OWN_COLOUR + OBJECT_FLAG_GLASS,
        PANE_ROUGH,
        // the glass's eave is its top: the head's shadow under it
        cm(pane.top - base)
      );
    }
    if (mesh.frame.positions.length > 0) {
      part(mesh.frame, colours.surround, OBJECT_FLAG_OWN_COLOUR, host.rough);
    }
    // the canopy is the building's own: its clay and tint, lit like its
    // walls (not a frame's darker own colour), the shop wash left to the
    // ground floor behind it
    if (mesh.canopy.positions.length > 0) {
      part(mesh.canopy, host.tint, host.flags & ~OBJECT_FLAG_SHOP, host.rough);
    }
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(
      v.isRoof,
      objectIds.map(() => 0)
    ),
    normals: shadedNormalsAfter(v, normals),

    ...lod2RoofColours(v),
  };
  return drawn;
}

/** Whether a host may wear a shopfront: not a glass or metal facade (its
 *  own front), and standing on the ground in front of the wall. */
function shopHost(
  host: Pick<CityObjectRow, "baseZ" | "flags">,
  w: ShopfrontWall
): boolean {
  if (
    hasObjectFlag(host.flags, OBJECT_FLAG_GLASS) ||
    hasObjectFlag(host.flags, OBJECT_FLAG_METAL)
  ) {
    return false;
  }
  return host.baseZ <= Math.min(...(w.z ?? [host.baseZ])) + SHOP_HOST_ABOVE_M;
}

/**
 * The dormers the surface model shows on the pitched LoD2 roofs (pipeline/
 * bake/dormers.py), appended as part of the object they sit on: one object
 * per host, in the host's tint and roof colour, the host's building tree
 * (asking or demolishing a dormer takes the building), no footprint, `source`
 * 4. Its walls carry no storey band, eave line, plinth or shop zone (its
 * base is its own, high on the roof). A dormer whose host the tile does not
 * hold is dropped.
 */
export function appendDormers(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  dormers: readonly DormerFeature[],
  objectIndex: ReadonlyMap<string, number>
): void {
  const byHost = new Map<number, DormerFeature[]>();
  for (const f of dormers) {
    const hostIndex = f.properties
      ? objectIndex.get(f.properties.of)
      : undefined;
    if (hostIndex !== undefined && baked.objects[hostIndex]) {
      byHost.set(hostIndex, [...(byHost.get(hostIndex) ?? []), f]);
    }
  }
  if (byHost.size === 0) {
    return;
  }
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const [hostIndex, list] of byHost) {
    const host = baked.objects[hostIndex];
    const index = baked.objects.length;
    let base = Number.POSITIVE_INFINITY;
    let top = Number.NEGATIVE_INFINITY;
    for (const f of list) {
      const mesh = dormerMesh(f, baked.offset);
      positions.push(...mesh.positions);
      isRoof.push(...mesh.isRoof);
      for (let i = 0; i < mesh.isRoof.length; i++) {
        objectIds.push(index);
      }
      base = Math.min(base, mesh.base);
      top = Math.max(top, f.properties?.top ?? mesh.base);
    }
    const above = cm(top - base + 1);
    baked.objects.push({
      ...host,
      building: false,
      baseZ: cm(base),
      // above its top: no eave stroke, no storey band on it
      eaveH: above,
      storeyH: above,
      glow: 0,
      // the host's facts but its ground floor's: no shop wash up here
      flags: host.flags & ~OBJECT_FLAG_SHOP,
      source: OBJECT_SOURCE_DORMER,
      footprints: [],
    });
  }
  const v = baked.vertices;
  baked.vertices = {
    positions: concat(v.positions, positions),
    objectIds: concat(v.objectIds, objectIds),
    isRoof: concat(v.isRoof, isRoof),
    ...flatNormalsAfter(v, positions.length),

    ...lod2RoofColours(v),
  };
}

/** An object's footprint centre (EPSG): its first ring's mean. */
function footprintCentre(
  footprints: readonly [number, number][][]
): [number, number] | undefined {
  const ring = footprints[0];
  if (!ring?.length) {
    return undefined;
  }
  const x = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const y = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return [x, y];
}

/** What keeps a building's walls free of windows beside a facade of its
 *  own (`WindowExtra.monumental`): glass or metal cladding, its own colour.
 *  A Wikidata landmark's flag alone does not — most are town houses whose
 *  neighbours have windows (the Neumarkt's, a listed Mietshaus). */
const NO_WINDOW_FLAGS =
  OBJECT_FLAG_GLASS | OBJECT_FLAG_METAL | OBJECT_FLAG_OWN_COLOUR;

/**
 * Marks the flat-roofed town houses (lib/city/windows.ts `flatTownHouse`:
 * housing from three storeys' eave whose storey — OSM's count, or its
 * neighbours' — is a town house's, or that is listed) on their rows (`townHouse`) and for their
 * windows (`town`): they carry a town house's plinth, cornices and windows,
 * not a block's bare front. In place.
 */
export function markTownHouses(
  objects: CityObjectRow[],
  hosts: WindowExtra[]
): void {
  objects.forEach((o, i) => {
    if (
      hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF) &&
      (o.source ?? OBJECT_SOURCE_LOD2) === OBJECT_SOURCE_LOD2 &&
      flatTownHouse({
        eaveH: o.eaveH,
        fn: hosts[i]?.fn,
        listed: hasObjectFlag(o.flags, OBJECT_FLAG_HERITAGE),
        storeyH: o.storeyH,
      })
    ) {
      o.townHouse = true;
      hosts[i] = { ...hosts[i], town: true };
    }
  });
}

/** What the windows read of an object beyond its row. */
export type WindowExtra = Pick<
  WindowHost,
  "brick" | "fn" | "levels" | "town"
> & {
  /** its facade its own (lib/city/building-tint.ts `ownFacade`: a
   *  church, a palace, a theatre, a hall) */
  monumental?: boolean;
  /** its facade, if its own, a palace's (`palatialFacade`) */
  palace?: boolean;
  /** the storeys OSM counts, its own or its building's */
  storeys?: number;
  /** why its facade is its own (`ownFacadeReason`), for the card */
  why?: "hall" | "listed" | "use";
};

/** A building's street level stands at most this far over the lowest
 *  ground under its plinths (m): up a steep street its ground floor's
 *  level lies between. */
const STREET_RISE_M = 1;
/** An object's base moves up to its building's street level from at most
 *  this far under it (m): deeper, it stands in a courtyard or a cut. */
const STREET_UNDER_M = 1.5;

/**
 * Each LoD2 object's base moved up to its building's street level where
 * the building's plinths say where that is (`carriesPlinth`): the highest
 * of their pieces' lowest ground, at most `STREET_RISE_M` over the lowest;
 * its eave stays where it is. A LoD2 base is the lowest ground round the
 * whole footprint — a courtyard's, a light well's, a ramp's — and lay a
 * median 0.3 m under the street on Dresden's spawn tile, so storeys, bands
 * and windows counted from it put the ground floor's windows behind the
 * plinth. Every part of the building moves to the same level, so their
 * storeys meet. Returns the base and eave of each object it moved, as they
 * were.
 */
export function liftToStreet(
  objects: CityObjectRow[],
  keys: readonly string[],
  plinths: readonly PlinthFeature[]
): Map<number, { baseZ: number; eaveH: number }> {
  const index = new Map(keys.map((id, i) => [id, i]));
  const ground = new Map<number, { lo: number; hi: number }>();
  for (const f of plinths) {
    const p = f.properties;
    const i = p ? index.get(p.of) : undefined;
    const host = i === undefined ? undefined : objects[i];
    if (p && host && carriesPlinth(host, p.g)) {
      const had = ground.get(host.root);
      ground.set(host.root, {
        lo: Math.min(had?.lo ?? Number.POSITIVE_INFINITY, ...p.g),
        hi: Math.max(had?.hi ?? Number.NEGATIVE_INFINITY, ...p.g),
      });
    }
  }
  const asBuilt = new Map<number, { baseZ: number; eaveH: number }>();
  objects.forEach((o, i) => {
    const g = ground.get(o.root);
    if (!g || (o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2) {
      return;
    }
    const street = Math.min(g.hi, g.lo + STREET_RISE_M);
    const rise = street - o.baseZ;
    if (rise > 0 && rise <= STREET_UNDER_M) {
      asBuilt.set(i, { baseZ: o.baseZ, eaveH: o.eaveH });
      o.eaveH = cm(Math.max(o.eaveH - rise, 0));
      o.baseZ = cm(street);
    }
  });
  return asBuilt;
}

/** How high each plinth piece stands over its host's base (m): its top where
 *  one is drawn (`carriesPlinth`), else the ground along it — a palace, a
 *  landmark or a flat-roofed block gets no plinth, and its ground floor's
 *  windows sank where the ground rises along its walls (the Albertinum's
 *  terrace side, 4.6 m over its base). */
function groundTops(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "flags">,
  p: PlinthFeature["properties"] & {}
): number[] {
  return (carriesPlinth(host, p.g) ? p.top : p.g).map((z) => z - host.baseZ);
}

/** How far the ground in front of each wall triangle rises over its
 *  object's base (`wallRises`), and each triangle's object. */
interface WallGround {
  objectIds: ArrayLike<number>;
  rises: Float32Array;
}

/** Each object's readings of the ground in front of its walls. */
function groundOf(ground: WallGround | undefined): Map<number, number[]> {
  const out = new Map<number, number[]>();
  ground?.rises.forEach((rise, k) => {
    if (Number.isNaN(rise)) {
      return;
    }
    const i = ground.objectIds[3 * k];
    const list = out.get(i);
    if (list) {
      list.push(rise);
    } else {
      out.set(i, [rise]);
    }
  });
  return out;
}

/** How high each object's plinth pieces stand over its base (m), each
 *  piece's top (`groundTops`): levels its ground-floor windows keep over
 *  where they can, like the ground in front of its walls. */
function plinthLevels(
  objects: readonly CityObjectRow[],
  plinths: readonly PlinthFeature[],
  index: ReadonlyMap<string, number>
): Map<number, number[]> {
  const tops = new Map<number, number[]>();
  for (const f of plinths) {
    const p = f.properties;
    const i = p ? index.get(p.of) : undefined;
    const host = i === undefined ? undefined : objects[i];
    if (i !== undefined && host && p) {
      tops.set(i, [...(tops.get(i) ?? []), ...groundTops(host, p)]);
    }
  }
  return tops;
}

/**
 * Each LoD2 object's windows (lib/city/windows.ts `windowSpecs`: measured
 * on its walls, on another part of its building, on the nearest building
 * of its kind, or its type's) and the storey they keep, snapped to its
 * eave — written into its row (`windows`, `storeyH`); its ground floor's
 * over its plinth pieces and the ground in front of its walls (`ground`),
 * as high as they still leave it one (`overGround`). Returns
 * each object's reach (`WindowChoice.reach`: a wall the ground rises
 * higher in front of loses its ground floor).
 */
export function assignWindows(
  objects: CityObjectRow[],
  keys: readonly string[],
  extra: readonly WindowExtra[],
  walls: readonly WindowWall[],
  plinths: readonly PlinthFeature[] = [],
  ground?: WallGround
): number[] {
  const index = new Map(keys.map((id, i) => [id, i]));
  const tops = plinthLevels(objects, plinths, index);
  const fronts = groundOf(ground);
  const hosts: WindowHost[] = objects.map((o, i) => ({
    centre: footprintCentre(o.footprints),
    eaveH: o.eaveH,
    flat: hasObjectFlag(o.flags, OBJECT_FLAG_FLAT_ROOF),
    fn: extra[i]?.fn,
    ground: [...(fronts.get(i) ?? []), ...(tops.get(i) ?? [])],
    levels: extra[i]?.levels ?? false,
    lod2: (o.source ?? OBJECT_SOURCE_LOD2) === OBJECT_SOURCE_LOD2,
    ownFacade:
      (extra[i]?.monumental ?? false) || (o.flags & NO_WINDOW_FLAGS) !== 0,
    // a palace's own facade carries a palace's windows, unless it is
    // glass, metal or its own colour
    palace:
      (extra[i]?.monumental ?? false) &&
      (extra[i]?.palace ?? false) &&
      (o.flags & NO_WINDOW_FLAGS) === 0,
    root: o.root,
    shop: hasObjectFlag(o.flags, OBJECT_FLAG_SHOP),
    storeyH: o.storeyH,
    storeys: extra[i]?.storeys,
    town: extra[i]?.town,
    brick: extra[i]?.brick,
  }));
  const reach: number[] = [];
  windowSpecs(hosts, walls, index).forEach((choice, i) => {
    const o = objects[i];
    reach[i] = choice.reach ?? GROUND_REACH_M;
    if (choice.spec.axis > 0) {
      o.windows = choice.spec;
      o.storeyH = cm(choice.storey);
    }
    if (o.drawn) {
      o.drawn = {
        ...o.drawn,
        windows: choice.from,
        ...(choice.why ? { noWindows: choice.why } : {}),
        ...(choice.storeyFromPhotos ? { storey: "photos" as const } : {}),
      };
    }
  });
  return reach;
}

/**
 * Where on its wall each vertex of a window-carrying object lies (lib/city/
 * windows.ts `facadeAttribute`), with OSM's doors, the passages' portals
 * and the shopfronts on those walls.
 */
function facadeOf(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  keys: readonly string[],
  onWalls: {
    doors?: readonly DoorFeature[];
    plinths?: readonly PlinthFeature[];
    shopfronts?: readonly ShopfrontWall[];
  },
  reach: (object: number) => number,
  rises?: Parameters<typeof facadeAttribute>[4],
  portals: readonly FacadeDoor[] = []
): Int16Array<ArrayBuffer> {
  const { cx, cy } = baked.offset;
  const index = new Map(keys.map((id, i) => [id, i]));
  const osmDoors = (onWalls.doors ?? []).flatMap((f) => {
    const p = f.properties;
    const object = p ? index.get(p.of) : undefined;
    if (!p || object === undefined) {
      return [];
    }
    const [x, y] = f.geometry.coordinates;
    return [
      {
        object,
        at: [x - cx, y - cy] as [number, number],
        n: [p.nx, p.ny] as [number, number],
        w: p.w,
      },
    ];
  });
  const shops = (onWalls.shopfronts ?? []).flatMap((w) => {
    const object = index.get(w.oid);
    return object === undefined
      ? []
      : [
          {
            object,
            a: [w.a[0] - cx, w.a[1] - cy] as [number, number],
            b: [w.b[0] - cx, w.b[1] - cy] as [number, number],
            n: w.n,
          },
        ];
  });
  return facadeAttribute(
    baked.vertices,
    (i) => (baked.objects[i]?.windows?.axis ?? 0) > 0,
    [...osmDoors, ...portals],
    [...shops, ...buriedWalls(baked, index, onWalls.plinths ?? [], reach)],
    rises,
    // every LoD2 wall carries its own eave (a front over its object's
    // lowest roof), with windows or not
    {
      of: (i) => {
        const o = baked.objects[i];
        return o && (o.source ?? OBJECT_SOURCE_LOD2) === OBJECT_SOURCE_LOD2
          ? { base: o.baseZ, eave: o.baseZ + o.eaveH }
          : undefined;
      },
    }
  );
}

/** The walls whose plinth or ground rises past their object's reach
 *  (`groundTops` over `WindowChoice.reach`): marked as a shopfront's with
 *  that height, they lose the windows under it. Either way round, as a
 *  piece's line does not say which side is out. */
function buriedWalls(
  baked: Pick<BakedCityMesh, "objects" | "offset">,
  index: ReadonlyMap<string, number>,
  plinths: readonly PlinthFeature[],
  reach: (object: number) => number
): FacadeShop[] {
  const { cx, cy } = baked.offset;
  return plinths.flatMap((f) => {
    const p = f.properties;
    const object = p ? index.get(p.of) : undefined;
    const host = object === undefined ? undefined : baked.objects[object];
    if (!p || !host?.windows || object === undefined) {
      return [];
    }
    const tops = groundTops(host, p);
    return f.geometry.coordinates.flatMap((line, k) => {
      const top = tops[k] ?? 0;
      const a = line[0];
      const b = line[line.length - 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!(top > reach(object)) || len === 0) {
        return [];
      }
      const n: [number, number] = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
      const at = {
        ground: top,
        object,
        a: [a[0] - cx, a[1] - cy] as [number, number],
        b: [b[0] - cx, b[1] - cy] as [number, number],
      };
      return [
        { ...at, n },
        { ...at, n: [-n[0], -n[1]] as [number, number] },
      ];
    });
  });
}

// --- passages through the buildings ---------------------------------------

/** A passage the bake opens (`passagePlans`), recentred: its axis and the
 *  volume it takes, the LoD2 objects it runs through with their shares,
 *  and the box (x0, y0, z0, x1, y1, z1) it can touch. */
interface PassagePlan {
  axis: PassageAxis;
  box: readonly [number, number, number, number, number, number];
  hosts: { object: number; part: PassagePart }[];
  regions: Plane[][];
}

/** The widest door a `_FACADE` slot holds (m): a wider portal keeps the
 *  windows off its middle that far, the rest of it is open wall anyway. */
const PORTAL_W_MAX = doorClassWidth(DOOR_SLOT.widths - 1);
/** An OSM door this close to a passage's opening (m past its half width)
 *  stands in it: none is drawn there. */
const PORTAL_DOOR_M = 0.3;

/**
 * The passages of the tile (pipeline/bake/passages.py) as the bake opens
 * them: the LoD2 objects of this tile each runs through, its clear height
 * from their eaves and storeys (lib/city/building-passages.ts
 * `passageHeight`) — none where they stand too low — and its volume.
 */
export function passagePlans(
  objects: readonly CityObjectRow[],
  keys: readonly string[],
  passages: readonly PassageFeature[],
  offset: { cx: number; cy: number }
): PassagePlan[] {
  const index = new Map(keys.map((id, i) => [id, i]));
  const local = (q: readonly number[]): [number, number] => [
    q[0] - offset.cx,
    q[1] - offset.cy,
  ];
  return passages.flatMap((f) => {
    const p = f.properties;
    if (!p || f.geometry.coordinates.length < 2) {
      return [];
    }
    const hosts = Object.entries(p.of).flatMap(([id, part]) => {
      const object = index.get(id);
      const o = object === undefined ? undefined : objects[object];
      if (
        object === undefined ||
        !o ||
        (o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2
      ) {
        return [];
      }
      return [
        {
          object,
          part: {
            portals: part.portals.map(
              ([x, y, nx, ny]): [number, number, number, number] => [
                x - offset.cx,
                y - offset.cy,
                nx,
                ny,
              ]
            ),
            roof: part.roof.map((r) => r.map(local)),
            sides: part.sides.map((r) => r.map(local)),
          },
        },
      ];
    });
    const h = passageHeight(
      p.kind,
      p.h,
      Math.max(...p.z),
      hosts.map(({ object }) => ({
        eaveZ: objects[object].baseZ + objects[object].eaveH,
        storeyH: objects[object].storeyH,
      }))
    );
    if (h === null) {
      return [];
    }
    const axis: PassageAxis = {
      axis: f.geometry.coordinates.map(local),
      ground: p.z,
      h,
      w: p.w,
    };
    const xs = axis.axis.map((q) => q[0]);
    const ys = axis.axis.map((q) => q[1]);
    const box = [
      Math.min(...xs) - p.w,
      Math.min(...ys) - p.w,
      Math.min(...p.z) - SINK.wall,
      Math.max(...xs) + p.w,
      Math.max(...ys) + p.w,
      Math.max(...p.z) + h,
    ] as const;
    return [{ axis, box, hosts, regions: passageRegions(axis) }];
  });
}

/** The passages' portals as doors on their walls (lib/city/windows.ts
 *  `FacadeDoor`): the ground floor's windows keep off them. */
function portalDoors(plans: readonly PassagePlan[]): FacadeDoor[] {
  return plans.flatMap((plan) =>
    plan.hosts.flatMap(({ object, part }) =>
      part.portals.map(([x, y, nx, ny]) => ({
        object,
        at: [x, y] as [number, number],
        n: [nx, ny] as [number, number],
        w: Math.min(plan.axis.w, PORTAL_W_MAX),
      }))
    )
  );
}

/** The distance (m) from plan point `q` to a polyline. */
function toPolyline(
  q: readonly [number, number],
  line: readonly (readonly [number, number])[]
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let k = 0; k + 1 < line.length; k++) {
    const [a, b] = [line[k], line[k + 1]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t =
      l2 > 0
        ? Math.min(
            Math.max(((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2, 0),
            1
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy)
    );
  }
  return best;
}

/** OSM's doors without those that stand in a passage's opening on their
 *  own building (an entrance mapped where the passage meets the wall): the
 *  opening is the way in. */
function outsidePassages(
  doors: readonly DoorFeature[],
  plans: readonly PassagePlan[],
  keys: readonly string[],
  baked: Pick<BakedCityMesh, "objects" | "offset">
): DoorFeature[] {
  if (plans.length === 0) {
    return [...doors];
  }
  const index = new Map(keys.map((id, i) => [id, i]));
  const { cx, cy } = baked.offset;
  return doors.filter((f) => {
    const object = f.properties ? index.get(f.properties.of) : undefined;
    const root = object === undefined ? undefined : baked.objects[object]?.root;
    const [x, y] = f.geometry.coordinates;
    return !plans.some(
      (plan) =>
        plan.hosts.some(({ object: h }) => baked.objects[h].root === root) &&
        toPolyline([x - cx, y - cy], plan.axis.axis) <=
          plan.axis.w / 2 + PORTAL_DOOR_M
    );
  });
}

/** Whether triangle `t` of the stream can reach into `box`. */
function inBox(
  p: ArrayLike<number>,
  t: number,
  box: PassagePlan["box"]
): boolean {
  for (let c = 0; c < 3; c++) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < 3; k++) {
      const x = p[3 * (t + k) + c];
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    if (hi < box[c] || lo > box[c + 3]) {
      return false;
    }
  }
  return true;
}

/** Whether two boxes (x0, y0, z0, x1, y1, z1) overlap. */
function boxesMeet(a: PassagePlan["box"], b: PassagePlan["box"]): boolean {
  return [0, 1, 2].every((c) => a[c] <= b[c + 3] && b[c] <= a[c + 3]);
}

/** Triangles (flat x, y, z) cut to what lies outside the plans' volumes. */
function outsideOf(
  positions: readonly number[],
  plans: readonly PassagePlan[]
): number[] {
  if (plans.length === 0) {
    return [...positions];
  }
  const out: number[] = [];
  for (let k = 0; k + 8 < positions.length; k += 9) {
    const tri = positions.slice(k, k + 9);
    const regions = plans.flatMap((plan) =>
      plan.regions.filter((r) => touches(tri, r))
    );
    out.push(...(regions.length > 0 ? cutOut(tri, regions) : tri));
  }
  return out;
}

/**
 * The passages cut open (lib/city/building-passages.ts): every triangle
 * but a roof's of the building trees each runs through — the LoD2 walls
 * and floor, and the plinths, doors and shopfronts laid on them — cut to
 * what lies outside its volume, and per object its lining (walls along
 * it, its ceiling) appended as a part of the object (`OBJECT_SOURCE_
 * PASSAGE`: its own colour, the host's, no windows, no eave). Last of the
 * bake: the windows and doors were placed on the whole walls, and a cut
 * piece carries its triangle's place on its wall (`_FACADE`) and normal.
 */
export function withPassages(
  baked: Pick<BakedCityMesh, "objects" | "vertices">,
  plans: readonly PassagePlan[]
): void {
  if (plans.length === 0) {
    return;
  }
  const { objects } = baked;
  const v = baked.vertices;
  const byRoot = new Map<number, PassagePlan[]>();
  for (const plan of plans) {
    for (const root of new Set(plan.hosts.map((h) => objects[h.object].root))) {
      byRoot.set(root, [...(byRoot.get(root) ?? []), plan]);
    }
  }
  const pieces = new Map<number, number[]>();
  const p = v.positions;
  for (let t = 0; t + 2 < v.objectIds.length; t += 3) {
    const near =
      v.isRoof[t] === 1
        ? undefined
        : byRoot.get(objects[v.objectIds[t]]?.root ?? -1);
    if (!near) {
      continue;
    }
    const tri = Array.from(p.subarray(3 * t, 3 * t + 9));
    const regions = near.flatMap((plan) =>
      inBox(p, t, plan.box) ? plan.regions.filter((r) => touches(tri, r)) : []
    );
    if (regions.length > 0) {
      pieces.set(t, cutOut(tri, regions));
    }
  }
  const linings: { id: number; positions: number[] }[] = [];
  for (const plan of plans) {
    // a passage crossing it, or beside it through one gateway: its lining
    // keeps out of that one's opening
    const crossing = plans.filter(
      (other) => other !== plan && boxesMeet(other.box, plan.box)
    );
    for (const { object, part } of plan.hosts) {
      const positions = outsideOf(
        passageLining(plan.axis, part, triangulateXY),
        crossing
      );
      if (positions.length === 0) {
        continue;
      }
      let base = Number.POSITIVE_INFINITY;
      let top = Number.NEGATIVE_INFINITY;
      for (let i = 2; i < positions.length; i += 3) {
        base = Math.min(base, positions[i]);
        top = Math.max(top, positions[i]);
      }
      const host = { ...objects[object] };
      delete host.windows;
      const above = cm(top - base + 1);
      linings.push({ id: objects.length, positions });
      objects.push({
        ...host,
        building: false,
        baseZ: cm(base),
        // above its top: no eave stroke, no storey band in it
        eaveH: above,
        storeyH: above,
        glow: 0,
        // the host's plaster runs on in, none of its OSM looks
        flags: OBJECT_FLAG_OWN_COLOUR,
        source: OBJECT_SOURCE_PASSAGE,
        footprints: [],
      });
    }
  }
  baked.vertices = withCuts(v, pieces, linings);
}

/** The stream with triangle `t`'s vertices replaced by `pieces.get(t)`
 *  (flat x, y, z: its pieces, none, or itself cut), each new vertex
 *  carrying its triangle's attributes — its normal and place on its wall
 *  (`_FACADE`'s first number) interpolated, the rest the triangle's — and
 *  `parts` appended (flat, no roof, no wall of the facade's). */
function withCuts(
  v: CityVertices,
  pieces: ReadonlyMap<number, readonly number[]>,
  parts: readonly { id: number; positions: readonly number[] }[]
): CityVertices {
  const count = v.objectIds.length;
  let total = count;
  for (const [, xyz] of pieces) {
    total += xyz.length / 3 - 3;
  }
  for (const part of parts) {
    total += part.positions.length / 3;
  }
  const out = emptyStream(v, total);
  const { positions, objectIds, normals, facade } = out;
  const noDoor = Math.round(NO_DOOR * 32_767);
  let at = 0;
  // the old stream's vertices from `run` up to `end`, as they were, to
  // `at`: the uncut triangles go over in runs, not vertex by vertex (a
  // tile's millions of vertices were as many subarrays for the collector)
  let run = 0;
  const flush = (end: number) => {
    copyVertices(v, run, end - run, out, at);
    at += end - run;
  };
  for (const t of [...pieces.keys()].sort((a, b) => a - b)) {
    flush(t);
    run = t + 3;
    const xyz = pieces.get(t) ?? [];
    const bary = barycentric(v.positions, t);
    for (let k = 0; k + 2 < xyz.length; k += 3) {
      const w = bary(xyz[k], xyz[k + 1], xyz[k + 2]);
      copyVertices(v, t, 1, out, at);
      positions[3 * at] = xyz[k];
      positions[3 * at + 1] = xyz[k + 1];
      positions[3 * at + 2] = xyz[k + 2];
      if (normals && v.normals) {
        normals.set(blend(v.normals, 3, t, w, true), 3 * at);
      }
      if (facade && v.facade) {
        facade[4 * at] = Math.round(blend(v.facade, 4, t, w, false)[0]);
      }
      at++;
    }
  }
  flush(count);
  for (const part of parts) {
    const n = part.positions.length / 3;
    positions.set(part.positions, 3 * at);
    objectIds.fill(part.id, at, at + n);
    if (facade) {
      for (let i = at; i < at + n; i++) {
        facade[4 * i + 2] = noDoor;
        facade[4 * i + 3] = noDoor;
      }
    }
    at += n;
  }
  return out;
}

/** A stream of `total` vertices with `v`'s attributes, unset: no normal
 *  (NaN), roof colour or surface. */
function emptyStream(v: CityVertices, total: number): CityVertices {
  return {
    positions: new Float32Array(3 * total),
    objectIds: new Float32Array(total),
    isRoof: new Float32Array(total),
    ...(v.normals && {
      normals: new Float32Array(3 * total).fill(Number.NaN),
    }),
    ...(v.roofRgb && {
      roofRgb: new Float32Array(3 * total).fill(Number.NaN),
    }),
    ...(v.surfaces && { surfaces: new Float32Array(2 * total).fill(-1) }),
    ...(v.facade && { facade: new Int16Array(4 * total) }),
  };
}

/** `n` vertices of `from` from vertex `i`, every attribute, to vertex `at`
 *  of `to`. */
function copyVertices(
  from: CityVertices,
  i: number,
  n: number,
  to: CityVertices,
  at: number
): void {
  if (n <= 0) {
    return;
  }
  to.positions.set(from.positions.subarray(3 * i, 3 * (i + n)), 3 * at);
  to.objectIds.set(from.objectIds.subarray(i, i + n), at);
  to.isRoof.set(from.isRoof.subarray(i, i + n), at);
  if (to.normals && from.normals) {
    to.normals.set(from.normals.subarray(3 * i, 3 * (i + n)), 3 * at);
  }
  // only the stream's first vertices carry a roof colour
  const rgbEnd = Math.min(3 * (i + n), from.roofRgb?.length ?? 0);
  if (to.roofRgb && from.roofRgb && rgbEnd > 3 * i) {
    to.roofRgb.set(from.roofRgb.subarray(3 * i, rgbEnd), 3 * at);
  }
  if (to.surfaces && from.surfaces) {
    to.surfaces.set(from.surfaces.subarray(2 * i, 2 * (i + n)), 2 * at);
  }
  if (to.facade && from.facade) {
    to.facade.set(from.facade.subarray(4 * i, 4 * (i + n)), 4 * at);
  }
}

/** Triangle `t`'s barycentric weights of a point in its plane. */
function barycentric(
  p: ArrayLike<number>,
  t: number
): (x: number, y: number, z: number) => [number, number, number] {
  const a = [p[3 * t], p[3 * t + 1], p[3 * t + 2]];
  const e1 = [p[3 * t + 3] - a[0], p[3 * t + 4] - a[1], p[3 * t + 5] - a[2]];
  const e2 = [p[3 * t + 6] - a[0], p[3 * t + 7] - a[1], p[3 * t + 8] - a[2]];
  const d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2];
  const d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
  const d22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
  const det = d11 * d22 - d12 * d12;
  return (x, y, z) => {
    const q = [x - a[0], y - a[1], z - a[2]];
    const q1 = q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2];
    const q2 = q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2];
    const u = det > 0 ? (d22 * q1 - d12 * q2) / det : 0;
    const w = det > 0 ? (d11 * q2 - d12 * q1) / det : 0;
    return [1 - u - w, u, w];
  };
}

/** Triangle `t`'s per-vertex attribute (`n` a vertex) at weights `w`;
 *  `unit` normalises it, and leaves NaN where a vertex has none. */
function blend(
  a: ArrayLike<number>,
  n: number,
  t: number,
  w: readonly [number, number, number],
  unit: boolean
): number[] {
  const out = Array.from({ length: n }, (_, c) =>
    w.reduce((s, wk, k) => s + wk * a[n * (t + k) + c], 0)
  );
  if (!unit) {
    return out;
  }
  const len = Math.hypot(...out);
  return len > 0 ? out.map((c) => c / len) : out.map(() => Number.NaN);
}
