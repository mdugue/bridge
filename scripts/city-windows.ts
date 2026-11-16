/**
 * The windows of the building bake (scripts/bake-city-mesh.ts): the
 * storeys counted from the street (`liftToStreet`), each object's window
 * columns (`assignWindows`) and each wall vertex's place on its wall, the
 * `_FACADE` attribute (`facadeOf`). No DOM.
 */
import { carriesPlinth } from "./city-fittings";
import { cm } from "./city-bake";
import type { BakedCityMesh } from "./city-bake";
import {
  hasObjectFlag,
  OBJECT_FLAG_FLAT_ROOF,
  OBJECT_FLAG_GLASS,
  OBJECT_FLAG_HERITAGE,
  OBJECT_FLAG_METAL,
  OBJECT_FLAG_OWN_COLOUR,
  OBJECT_SOURCE_DORMER,
  OBJECT_SOURCE_LOD2,
} from "../lib/city/city-mesh";
import type { CityObjectRow } from "../lib/city/city-mesh";
import type {
  DoorFeature,
  ShopfrontWall,
  PlinthFeature,
} from "../lib/city/features";
import {
  facadeAttribute,
  flatTownHouse,
  GROUND_REACH_M,
  measuredAxes,
  windowSpecs,
} from "../lib/city/windows";
import type {
  FacadeDoor,
  FacadeShop,
  WindowHost,
  WindowWall,
} from "../lib/city/windows";

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
  for (let i = 0; i < objects.length; i += 1) {
    const o = objects[i];
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
  }
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
  for (let i = 0; i < objects.length; i += 1) {
    const o = objects[i];
    const g = ground.get(o.root);
    if (!g || (o.source ?? OBJECT_SOURCE_LOD2) !== OBJECT_SOURCE_LOD2) {
      continue;
    }
    const street = Math.min(g.hi, g.lo + STREET_RISE_M);
    const rise = street - o.baseZ;
    if (rise > 0 && rise <= STREET_UNDER_M) {
      asBuilt.set(i, { baseZ: o.baseZ, eaveH: o.eaveH });
      o.eaveH = cm(Math.max(o.eaveH - rise, 0));
      o.baseZ = cm(street);
    }
  }
  return asBuilt;
}

/** How high each plinth piece stands over its host's base (m): its top where
 *  one is drawn (`carriesPlinth`), else the ground along it — a palace, a
 *  landmark or a flat-roofed block gets no plinth, and its ground floor's
 *  windows sank where the ground rises along its walls (the Albertinum's
 *  terrace side, 4.6 m over its base). */
function groundTops(
  host: Pick<CityObjectRow, "baseZ" | "eaveH" | "flags">,
  p: NonNullable<PlinthFeature["properties"]>
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
  if (!ground) {
    return out;
  }
  for (let k = 0; k < ground.rises.length; k += 1) {
    const rise = ground.rises[k];
    if (Number.isNaN(rise)) {
      continue;
    }
    const i = ground.objectIds[3 * k];
    const list = out.get(i);
    if (list) {
      list.push(rise);
    } else {
      out.set(i, [rise]);
    }
  }
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
    storeyH: o.storeyH,
    storeys: extra[i]?.storeys,
    town: extra[i]?.town,
    brick: extra[i]?.brick,
  }));
  const reach: number[] = [];
  for (const [i, choice] of windowSpecs(hosts, walls, index).entries()) {
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
      };
    }
  }
  return reach;
}

/**
 * Where on its wall each vertex of a window-carrying object lies (lib/city/
 * windows.ts `facadeAttribute`), with OSM's doors, the passages' portals
 * and the shopfronts on those walls.
 */
export function facadeOf(
  baked: Pick<BakedCityMesh, "objects" | "offset" | "vertices">,
  keys: readonly string[],
  onWalls: {
    doors?: readonly DoorFeature[];
    plinths?: readonly PlinthFeature[];
    shopfronts?: readonly ShopfrontWall[];
    windows?: readonly WindowWall[];
  },
  reach: (object: number) => number,
  rises?: Parameters<typeof facadeAttribute>[4],
  portals: readonly FacadeDoor[] = [],
  blind: readonly number[] = [],
  /** the walls a shop window was cut into: theirs is the ground floor */
  opened: ReadonlyMap<ShopfrontWall, ReadonlySet<number>> = new Map()
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
  // only a wall a shop window was cut into loses its ground-floor
  // windows: one where the photos read a sign alone (318 of Dresden's
  // 1003, most from a single drive), or whose bays found no wall, kept a
  // blank ground floor under its fascia
  // (every object a window was cut into: the host's own wall)
  const shops = (onWalls.shopfronts ?? []).flatMap((w) =>
    [...(opened.get(w) ?? [])].map((object) => ({
      object,
      a: [w.a[0] - cx, w.a[1] - cy] as [number, number],
      b: [w.b[0] - cx, w.b[1] - cy] as [number, number],
      n: w.n,
    }))
  );
  const facade = facadeAttribute(
    baked.vertices,
    (i) => (baked.objects[i]?.windows?.axis ?? 0) > 0,
    [...osmDoors, ...portals],
    [...shops, ...buriedWalls(baked, index, onWalls.plinths ?? [], reach)],
    rises,
    // every LoD2 wall carries its own eave (a front over its object's
    // lowest roof), with windows or not, and a dormer's front its own top
    {
      of: (i) => {
        const o = baked.objects[i];
        const source = o?.source ?? OBJECT_SOURCE_LOD2;
        return o &&
          (source === OBJECT_SOURCE_LOD2 ||
            (source === OBJECT_SOURCE_DORMER && o.windows))
          ? { base: o.baseZ, eave: o.baseZ + o.eaveH }
          : undefined;
      },
    },
    // the walls whose axes the drives placed (window_axes.py)
    measuredAxes(
      onWalls.windows ?? [],
      index,
      (i) => baked.objects[i]?.windows,
      baked.offset
    )
  );
  // a wall of no length has no window (a dormer's cheek)
  for (const v of blind) {
    facade[4 * v] = 0;
    facade[4 * v + 1] = 0;
  }
  return facade;
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
      const b = line.at(-1);
      if (!b) {
        return [];
      }
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
