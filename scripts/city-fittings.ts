/**
 * What the building bake lays on the LoD2 walls and roofs
 * (scripts/bake-city-mesh.ts): plinths, cornices and Traufgesimse
 * (`appendPlinths`), OSM's doors (`appendDoors`) and the surface model's
 * dormers and chimneys (`appendDormers`), each an object in its host's
 * building tree. No DOM.
 */
import { cm, mixRgb, treeTriangles } from "./city-bake";
import type { PlinthBreak, BakedCityMesh } from "./city-bake";
import {
  hasObjectFlag,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_LANDMARK,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_FLAG_SHOP,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_PLINTH,
  OBJECT_SOURCE_DOOR,
} from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import {
  DOOR_SINK,
  DOOR_SURROUND,
  doorMesh,
  eaveAlong,
  wallShift,
  wallShiftAlong,
  wallShiftKnots,
} from "../lib/city/doors";
import { chimneyMesh, dormerMesh } from "../lib/city/dormers";
import {
  bandMeshes,
  CORNICE,
  EAVE_CORNICE,
  joinStretches,
  lineStretches,
  plinthStretches,
  straightRuns,
  withoutSegments,
} from "../lib/city/plinths";
import type { BandKind, HostShift, Shaded, Stretch } from "../lib/city/plinths";
import type {
  DoorFeature,
  DormerFeature,
  PlinthFeature,
} from "../lib/city/features";
import { TALL_STOREY_M, dormerWindows } from "../lib/city/windows";
import { appended } from "./vertex-stream";
import type { StreamPart } from "./vertex-stream";

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
export function carriesPlinth(
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
  objectIndex: ReadonlyMap<string, number>,
  /** EPSG segments the plinth band breaks for (`shopWindowBreaks`), each
   *  with the building tree whose plinth alone it breaks */
  breaks: readonly PlinthBreak[] = []
): void {
  const parts: StreamPart[] = [];
  const walls = treeTriangles(baked);
  const vertices = baked.vertices.positions;
  const { isRoof } = baked.vertices;
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
    bands.plinth.push(
      ...withoutSegments(
        plinthStretches(f, hostIndex),
        breaks.filter((b) => b.root === host.root).map((b) => b.at)
      )
    );
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
    baked.vertices = appended(baked.vertices, parts);
  }
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
export const SURROUND_STONE: [number, number, number] = [0.88, 0.85, 0.78];
/** A door leaf: dark wood in its wall's cast; a garage door a calm grey. */
export const LEAF_WOOD: [number, number, number] = [0.31, 0.24, 0.18];
export const LEAF_GARAGE: [number, number, number] = [0.5, 0.5, 0.48];

/**
 * How far apart (m) the feet of two dormers on one host may lie and still
 * be one object: the window's sill is read from the object's base, so a
 * row of dormers along one eave shares one, a row higher up the roof
 * another.
 */
const DORMER_FOOT_BAND_M = 0.15;

/** One host's dormers, or its chimneys, as one object's triangles. */
interface DormerPart {
  base: number;
  chimney: boolean;
  front: number[];
  isRoof: number[];
  positions: number[];
  top: number;
}

/** A host's dormers and chimneys as the objects they are appended as:
 *  its chimneys one, its dormers one per band of feet
 *  (`DORMER_FOOT_BAND_M`). */
function dormerParts(
  list: readonly DormerFeature[],
  offset: BakedCityMesh["offset"]
): DormerPart[] {
  const meshes = list.map((f) => {
    const chimney = f.properties?.k === "chimney";
    const mesh = chimney ? chimneyMesh(f, offset) : dormerMesh(f, offset);
    return { chimney, mesh, top: f.properties?.top ?? mesh.base };
  });
  const parts: DormerPart[] = [];
  const add = (into: DormerPart | undefined, m: (typeof meshes)[number]) => {
    const part = into ?? {
      base: m.mesh.base,
      chimney: m.chimney,
      front: [],
      isRoof: [],
      positions: [],
      top: m.top,
    };
    part.base = Math.min(part.base, m.mesh.base);
    part.top = Math.max(part.top, m.top);
    part.positions.push(...m.mesh.positions);
    part.isRoof.push(...m.mesh.isRoof);
    part.front.push(...m.mesh.front);
    if (!into) {
      parts.push(part);
    }
  };
  const stacks = meshes.filter((m) => m.chimney);
  for (const m of stacks) {
    add(parts[0], m);
  }
  let band: DormerPart | undefined;
  for (const m of meshes
    .filter((d) => !d.chimney)
    .sort((a, b) => a.mesh.base - b.mesh.base)) {
    if (band && m.mesh.base - band.base > DORMER_FOOT_BAND_M) {
      band = undefined;
    }
    add(band, m);
    band ??= parts.at(-1);
  }
  return parts;
}

/**
 * The dormers and chimneys the surface model shows on the LoD2 roofs
 * (pipeline/bake/dormers.py), appended as part of the object they sit on:
 * per host its chimneys one object and its dormers one per band of feet
 * (`dormerParts`), in the host's tint and roof colour, the host's building
 * tree (asking or demolishing a dormer takes the building), no footprint,
 * `source` 4. Their walls carry no storey band, plinth or shop zone (their
 * base is their own, high on the roof); a dormer's front its window
 * (lib/city/windows.ts `dormerWindows`, under its own eave) where its
 * host has windows, its cheeks and a chimney none. A dormer whose host the tile does not hold is dropped.
 * Returns the vertices of the dormers' walls that take no window (their
 * cheeks), for `facadeOf`.
 */
export function appendDormers(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  dormers: readonly DormerFeature[],
  objectIndex: ReadonlyMap<string, number>
): number[] {
  const byHost = new Map<number, DormerFeature[]>();
  for (const f of dormers) {
    const hostIndex = f.properties
      ? objectIndex.get(f.properties.of)
      : undefined;
    if (hostIndex !== undefined && baked.objects[hostIndex]) {
      const list = byHost.get(hostIndex);
      if (list) {
        list.push(f);
      } else {
        byHost.set(hostIndex, [f]);
      }
    }
  }
  const blind: number[] = [];
  if (byHost.size === 0) {
    return blind;
  }
  const v = baked.vertices;
  const first = v.objectIds.length;
  const positions: number[] = [];
  const objectIds: number[] = [];
  const isRoof: number[] = [];
  for (const [hostIndex, list] of byHost) {
    const host = baked.objects[hostIndex];
    for (const part of dormerParts(list, baked.offset)) {
      const index = baked.objects.length;
      // a host the clay draws no windows on (a landmark, glass, a hall)
      // has none in its dormers either
      const windowed = !part.chimney && (host.windows?.axis ?? 0) > 0;
      for (let i = 0; i < part.isRoof.length; i += 1) {
        if (windowed && part.isRoof[i] === 0 && part.front[i] === 0) {
          blind.push(first + objectIds.length);
        }
        objectIds.push(index);
      }
      positions.push(...part.positions);
      isRoof.push(...part.isRoof);
      const above = cm(part.top - part.base + 1);
      baked.objects.push({
        ...host,
        building: false,
        baseZ: cm(part.base),
        // each front's eave is its own (its wall's top, `facadeOf`): the
        // object's under the roof, no storey band on it
        eaveH: windowed ? 0 : above,
        storeyH: above,
        glow: 0,
        // the host's facts but its ground floor's: no shop wash up here
        flags: host.flags & ~OBJECT_FLAG_SHOP,
        source: OBJECT_SOURCE_DORMER,
        footprints: [],
        windows: windowed ? dormerWindows(host.windows) : undefined,
      });
    }
  }
  baked.vertices = appended(v, [{ id: objectIds, isRoof, positions }]);
  return blind;
}

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
  const parts: StreamPart[] = [];
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
      parts.push({ id: index, positions: tris });
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
  baked.vertices = appended(baked.vertices, parts);
}
