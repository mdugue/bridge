/**
 * Glass facades the street photos found (pipeline/bake/facade_glass.py,
 * windows.py `wall_glass`): an object whose walls the photos read as glass
 * takes the material OSM's `building:material=glass` gives — the cool
 * sheen, no windows (lib/city/windows.ts `ownFacade`) — where neither OSM
 * nor Wikidata names its material. Decided per object from the length of
 * its walls read: glass when at least `GLASS_LENGTH_SHARE` of it is
 * (docs/transformations.md, *Glass facades from street photos*). No THREE.
 */
import type { OsmBuildingFacts, OsmBuildingLut } from "./city-mesh";
import type { WindowWall } from "./windows-file";

/** The share of an object's walls read for glass, by length, that must read
 *  as glass: a glass hall on a stone plinth wing is glass, a stone house
 *  with one glazed stair tower is not. */
export const GLASS_LENGTH_SHARE = 0.5;

/** The objects (LoD2 ids) the photos read as glass. */
export function photoGlassObjects(
  walls: readonly WindowWall[]
): ReadonlySet<string> {
  const read = new Map<string, { all: number; glass: number }>();
  for (const w of walls) {
    if (!w.glass) {
      continue;
    }
    const sum = read.get(w.oid) ?? { all: 0, glass: 0 };
    sum.all += w.L;
    sum.glass += w.glass.glass ? w.L : 0;
    read.set(w.oid, sum);
  }
  return new Set(
    [...read]
      .filter(([, s]) => s.glass >= GLASS_LENGTH_SHARE * s.all && s.glass > 0)
      .map(([oid]) => oid)
  );
}

/**
 * The OSM table with the photos' glass: material `glass`, from `photos`,
 * on each object the photos read as glass and no source names a material
 * of (an object's own or, through `inheritedLook`, its root Building's).
 */
export function withPhotoGlass(
  lut: OsmBuildingLut | undefined,
  walls: readonly WindowWall[] | undefined,
  rootOf: (id: string) => string | undefined
): OsmBuildingLut | undefined {
  const glass = photoGlassObjects(walls ?? []);
  if (glass.size === 0) {
    return lut;
  }
  const out: OsmBuildingLut = { ...lut };
  for (const id of glass) {
    const own: OsmBuildingFacts | undefined = out[id];
    const root = rootOf(id);
    const named = own?.material ?? (root ? out[root]?.material : undefined);
    if (!named) {
      out[id] = { ...own, material: "glass", materialFrom: "photos" };
    }
  }
  return out;
}
