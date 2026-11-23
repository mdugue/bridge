/**
 * The buildings LoD2 lacks, appended to the building bake's stream
 * (scripts/bake-city-mesh.ts): the small structures the laser scan saw
 * (`appendScanStructures`) and those the surface model shows
 * (`appendGapStructures`), one object each. No DOM.
 */
import { cm, r3, rgb, triangulateXY } from "./city-bake";
import type { BakedCityMesh } from "./city-bake";
import {
  buildingTint,
  roofTint,
  roughJitter,
  storeyHeight,
} from "../lib/city/building-tint";
import type { FacadeMaterial, TintRgb } from "../lib/city/building-tint";
import {
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_SOURCE_GAP,
  OBJECT_SOURCE_SCAN,
} from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import type {
  MeasuredRoofFeature,
  SmallBuildingFeature,
  StructureFeature,
} from "../lib/city/features";
import { gapFacts, scanFacts } from "../lib/city/object-facts";
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
import { OPEN_ROOF_FUNCTIONS } from "../lib/city/open-roofs";
import { measuredRoofMesh } from "./measured-roofs";
import type { PrismMesh } from "./measured-roofs";
import { appended } from "./vertex-stream";
import type { StreamPart } from "./vertex-stream";

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
  const parts: StreamPart[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
    const box = structureMesh(f, baked.offset);
    const outline = structureCorners(f);
    const z = f.properties?.z;
    if (box.positions.length === 0 || !outline || z === undefined) {
      continue;
    }
    const index = baked.objects.length;
    const id = scanStructureId(tile, f);
    const eave = Math.min(...outline.map((c) => c.h));
    const footprint = outline.map((c): [number, number] => [cm(c.x), cm(c.y)]);
    parts.push({ id: index, isRoof: box.isRoof, positions: box.positions });
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
  baked.vertices = appended(baked.vertices, parts);
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
  const parts: StreamPart[] = [];
  for (let i = 0; i < features.length; i += 1) {
    const f = features[i];
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
    parts.push({
      id: index,
      isRoof: mesh.isRoof,
      // a shaped roof's faces shade smooth, the rest flat
      ...(shaped?.normals.some((n) => !Number.isNaN(n)) && {
        normals: shaped.normals,
      }),
      positions: mesh.positions,
    });
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
  baked.vertices = appended(baked.vertices, parts);
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
  for (let i = 0; i < mesh.isRoof.length; i += 1) {
    const roof = mesh.isRoof[i];
    if (roof === 1) {
      lowest = Math.min(lowest, mesh.positions[i * 3 + 2]);
    }
  }
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

/** A scan structure's hash key: the tile and its ring's first corner to the
 *  decimetre — stable when the tile's LoD2 object count changes. */
export function scanStructureId(tile: string, f: SmallBuildingFeature): string {
  const [x, y] = f.geometry.coordinates[0]?.[0] ?? [0, 0];
  return `scan:${tile}:${x.toFixed(1)}:${y.toFixed(1)}`;
}
