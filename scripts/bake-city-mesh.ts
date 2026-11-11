/**
 * Parses one tile's CityJSON into the building mesh the viewer streams:
 * runs cityjson-threejs-loader once, then folds in everything the clay
 * style needs per building (tints, roof colour incl. the DOP LUT,
 * storey/eave heights, dusk glow, roughness jitter), the OSM flags (shop,
 * heritage; a part carries its Building's too), the demolish tree and the
 * minimap footprints, then dresses the walls (`dressWalls`). `cityMesh`
 * turns the result into the glTF writer's input (scripts/tile-glb.ts) with
 * its per-object property table. Its steps each have their module, all on
 * one vertex stream (scripts/vertex-stream.ts): the LoD2 parse
 * (city-lod2.ts), the rebuilt and opened roofs (city-roofs.ts), the
 * structures LoD2 lacks (city-structures.ts), plinths, doors and dormers
 * (city-fittings.ts), shopfronts (city-shopfronts.ts), the windows' places
 * (city-windows.ts) and the passages (city-passages.ts); city-bake.ts
 * holds what they share. Called by scripts/prepare/city.ts; no DOM.
 */
import { appendDoors, appendDormers, appendPlinths } from "./city-fittings";
import { appendGapStructures, appendScanStructures } from "./city-structures";
import {
  appendShopfronts,
  planShopfronts,
  shopWindowBreaks,
} from "./city-shopfronts";
import {
  assignWindows,
  facadeOf,
  liftToStreet,
  markTownHouses,
} from "./city-windows";
import { cm, r3, rgb } from "./city-bake";
import {
  collectVertices,
  epsgOf,
  objectHeights,
  rootOf,
  withFaceRoofColours,
} from "./city-lod2";
import {
  markOpenRoofs,
  openRoofObjects,
  withMeasuredRoofs,
  withOpenRoofs,
} from "./city-roofs";
import {
  outsidePassages,
  passagePlans,
  portalDoors,
  withPassages,
} from "./city-passages";
import type { BakedCityMesh, OnWalls } from "./city-bake";
import type { PassagePlan } from "./city-passages";
import type { WindowExtra } from "./city-windows";
import { CityJSONLoader, CityJSONParser } from "cityjson-threejs-loader";
import type { Matrix4 } from "three";
import {
  brickWalls,
  buildingGlows,
  isStructure,
  palatialFacade,
  partFacade,
  buildingTint,
  inheritedAttributes,
  countsStoreys,
  ownFacadeReason,
  roofColor,
  roofColourSource,
  roughJitter,
  mappedStoreyHeight,
  wallColourSource,
} from "../lib/city/building-tint";
import type {
  FacadeMaterial,
  RoofColourSource,
  RoofColours,
} from "../lib/city/building-tint";
import {
  hasObjectFlag,
  inheritedFlags,
  inheritedLook,
  markFlatRoofs,
  markGrounded,
  OBJECT_FLAG_OWN_FACADE,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_LOD2,
  objectTable,
  withoutTrafficStructures,
} from "../lib/city/city-mesh";
import type {
  CityObjectRow,
  OsmBuildingFacts,
  OsmBuildingLut,
} from "../lib/city/city-mesh";
import { creaseNormals } from "../lib/city/crease-normals";
import { encodeDrawn } from "../lib/city/drawn-facts";
import type { DrawnFacts } from "../lib/city/drawn-facts";
import { ensembleGroup, ensembleRoots } from "../lib/city/ensembles";
import type {
  DoorFeature,
  DormerFeature,
  MeasuredRoofFeature,
  ShopfrontWall,
  PlinthFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { buildingFootprintPolys } from "../lib/city/minimap";
import {
  factColumns,
  inheritedOsm,
  lod2Facts,
  NO_FACT,
  treeFacts,
} from "../lib/city/object-facts";
import { recenterOffset } from "../lib/city/recenter";
import type { CityJsonDocument } from "../lib/city/types";
import {
  facadeAttribute,
  GROUND_REACH_M,
  wallRises,
} from "../lib/city/windows";
import { measuredRoofsById } from "./measured-roofs";
import type { Column, MeshInput, PropertyTable } from "./tile-glb";
import type { CityVertices } from "./vertex-stream";

/** A part of a building whose facade is its own shares it where OSM's
 *  storeys are the building's (a hall's raised roof). */
function shareBuildingFacades(
  objects: CityObjectRow[],
  hosts: WindowExtra[]
): void {
  for (let i = 0; i < objects.length; i += 1) {
    const o = objects[i];
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
  }
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
  roofColours: Partial<RoofColours> | undefined,
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
  const { matrix } = loader;
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

  const { minZ, maxZ, roofMinZ } = objectHeights(v);

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
    const measuredH =
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
        mappedStoreyHeight(eaveH, measuredH, osm?.levels, osm?.storey)
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

  shareBuildingFacades(objects, hosts);

  // A Building with parts answers for its whole tree (the inquiry card
  // reads it): the union of the footprints, the tree's height.
  const trees = new Map<number, number[]>();
  for (let i = 0; i < objects.length; i += 1) {
    const o = objects[i];
    trees.set(o.root, [...(trees.get(o.root) ?? []), i]);
  }
  for (const [root, members] of trees) {
    const { facts } = objects[root];
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
  // the walls' dressing left its garbage, and the cut copies the stream
  // once more: collected on either side, the two do not stand together
  collectAfterAppend();
  withPassages(baked, passages);
  collectAfterAppend();
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
  const { own } = o;
  let storey: DrawnFacts["storey"] = "height";
  if (countsStoreys(o.eaveH, osm?.levels)) {
    storey = "osm";
  } else if ((osm?.storey ?? 0) > 0 && o.eaveH >= 2.5) {
    storey = "neighbours";
  }
  return {
    wall,
    ...(look.colour ? { colour: look.colour } : {}),
    ...(look.material ? { material: look.material } : {}),
    ...(look.materialFrom ? { materialFrom: look.materialFrom } : {}),
    ...(wall === "brick" ? { context } : {}),
    roof: o.roof,
    ...(look.roof_colour ? { roofColour: look.roof_colour } : {}),
    storey,
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
    const { facts } = objects[to];
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
  const groups = new Uint32Array(v.objectIds.length);
  for (let i = 0; i < groups.length; i += 1) {
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
  for (let i = 0; i < flat.length; i += 1) {
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
    roofColours?: Partial<RoofColours>;
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
  const opened = new Map<ShopfrontWall, ReadonlySet<number>>();
  const cutFrom = new Map<number, number>();
  const blind = appendBeyondLod2(
    tile,
    baked,
    keys,
    { ...onWalls, ...extra },
    opened,
    cutFrom
  );
  // standing on the ground or on a roof: as LoD2 built them
  markGrounded(baked.objects, asBuilt);
  // the parts laid on the walls copied their host's row: windows are the
  // LoD2 walls' and the dormers' fronts' alone
  for (const o of baked.objects) {
    const source = o.source ?? OBJECT_SOURCE_LOD2;
    if (source !== OBJECT_SOURCE_LOD2 && source !== OBJECT_SOURCE_DORMER) {
      delete o.windows;
    }
  }
  const reachOf = (i: number) => reach[i] ?? GROUND_REACH_M;
  baked.vertices.facade = facadeOf(
    baked,
    keys,
    onWalls,
    reachOf,
    rises && { at: risesAfterCuts(rises, cutFrom), reach: reachOf },
    portalDoors(passages),
    blind,
    opened
  );
  return passages;
}

/** The ground's rise in front of each triangle (`groundRises`, by the
 *  LoD2's triangles) carried onto the remainders the shop windows' and
 *  signs' cuts appended (`from`: appended triangle → the one it was cut
 *  from); a wall cut keeps its rise. */
function risesAfterCuts(
  rises: Float32Array,
  from: ReadonlyMap<number, number>
): Float32Array {
  if (from.size === 0) {
    return rises;
  }
  let count = rises.length;
  for (const t of from.keys()) {
    count = Math.max(count, t + 1);
  }
  // (NaN: no ground known, as `wallRises` has it for what is no wall)
  const out = new Float32Array(count).fill(Number.NaN);
  out.set(rises);
  for (const [t, source] of from) {
    out[t] = rises[source] ?? 0;
  }
  return out;
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

/** Collects the garbage an append left (see `appendBeyondLod2`). */
const collectAfterAppend = () => Bun.gc(true);

/** What the tile's mesh carries beyond LoD2: the scan's sheds, the
 *  surface model's structures and dormers, OSM's doors (each on its LoD2
 *  host). Returns the walls' vertices of a windowed object that take no
 *  window (a dormer's cheeks, `appendDormers`). */
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
    roofColours?: Partial<RoofColours>;
    scan?: readonly SmallBuildingFeature[];
  },
  /** filled with the walls a shop window was cut into, each with the
   *  objects it cut (its host's, a sibling part's coplanar wall) */
  opened: Map<ShopfrontWall, ReadonlySet<number>>,
  /** filled with each remainder triangle a cut appended and the LoD2
   *  triangle it was cut from */
  cutFrom: Map<number, number>
): number[] {
  // Each append copies the whole vertex stream and leaves its parts' plain
  // arrays behind: Bun's lazy collector let them pile up over the six, and
  // a München tile's bands alone left 2.5 GiB (its cold bake peaked at
  // 6.1 GiB, past what Vercel's 8 GB builder holds). Collected after each,
  // the tile stays near one append's peak.
  if (extra.scan) {
    appendScanStructures(tile, baked, extra.scan, extra.roofColours?.scan);
    collectAfterAppend();
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
    collectAfterAppend();
  }
  // laid out before the plinths, which break for the windows it cuts
  const shops = planShopfronts(
    baked,
    extra.shopfronts ?? [],
    extra.doors ?? [],
    objectIndex
  );
  if (extra.plinths) {
    appendPlinths(baked, extra.plinths, objectIndex, shopWindowBreaks(shops));
    collectAfterAppend();
  }
  if (shops.length > 0) {
    // before the doors: a bay is cut at a door, which the doors then draw
    const cut = appendShopfronts(baked, shops);
    for (const [w, objects] of cut.opened) {
      opened.set(w, objects);
    }
    for (const [t, source] of cut.from) {
      cutFrom.set(t, source);
    }
    collectAfterAppend();
  }
  if (extra.doors) {
    appendDoors(baked, extra.doors, objectIndex);
    collectAfterAppend();
  }
  if (!extra.dormers) {
    return [];
  }
  const blind = appendDormers(baked, extra.dormers, objectIndex);
  collectAfterAppend();
  return blind;
}
