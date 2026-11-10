/**
 * Glass facades the street photos found (pipeline/bake/facade_glass.py,
 * windows.py `wall_glass`): an object whose walls the photos read as glass
 * takes the material OSM's `building:material=glass` gives — the cool
 * sheen, no windows (lib/city/windows.ts `ownFacade`) — where neither OSM
 * nor Wikidata names its material. Decided per object from the length of
 * its walls read and of all its outer walls (docs/transformations.md,
 * *Glass facades from street photos*). No THREE.
 */
import type { OsmBuildingFacts, OsmBuildingLut } from "./city-mesh";
import type { WindowFile, WindowWall } from "./windows-file";

/** The share of an object's walls read for glass, by length, that must read
 *  as glass: a glass hall on a stone plinth wing is glass. */
export const GLASS_LENGTH_SHARE = 0.5;
/** … and how much glass that must be: this share of all its outer walls,
 *  or this many metres and at least `GLASS_OUTER_LEAST` of them — a stone
 *  house with one glazed stair tower, the only wall the photos read, is not
 *  glass, nor a mall with a glazed entrance (16 m of 547); a glass front
 *  on a big block, read on one side, is (20 m of 254, the Volkshochschule). */
export const GLASS_OUTER_SHARE = 0.25;
export const GLASS_MIN_M = 15;
export const GLASS_OUTER_LEAST = 0.05;

/** The objects (LoD2 ids) the photos read as glass; `outer` the length of
 *  each one's outer walls (the windows file's `outer`). */
export function photoGlassObjects(
  walls: readonly WindowWall[],
  outer: Readonly<Record<string, number>> = {}
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
  const enough = (oid: string, glass: number) => {
    const all = outer[oid] ?? 0;
    return (
      glass >= GLASS_OUTER_SHARE * all ||
      (glass >= GLASS_MIN_M && glass >= GLASS_OUTER_LEAST * all)
    );
  };
  return new Set(
    [...read]
      .filter(
        ([oid, s]) =>
          s.glass > 0 &&
          s.glass >= GLASS_LENGTH_SHARE * s.all &&
          enough(oid, s.glass)
      )
      .map(([oid]) => oid)
  );
}

/**
 * The OSM table with the photos' glass: material `glass`, from `photos`,
 * on each object the photos read as glass and no source names a material
 * of (an object's own or, through `inheritedLook`, its root Building's) —
 * never on a Building whose parts were read, which would pass it on to
 * them. Both the tile bake and the windows report build their table so.
 */
export function withPhotoGlass(
  lut: OsmBuildingLut | undefined,
  file: Pick<WindowFile, "buildings" | "outer"> | undefined
): OsmBuildingLut | undefined {
  const roots = Object.entries(file?.buildings ?? {});
  const walls = roots.flatMap(([, ws]) => ws);
  const glass = photoGlassObjects(walls, file?.outer);
  if (glass.size === 0) {
    return lut;
  }
  const rootOf = new Map<string, string>();
  // a Building with parts of its own: its look would pass to every part
  // (`inheritedLook`), the ones the photos read as solid too
  const parents = new Set<string>();
  for (const [root, ws] of roots) {
    for (const w of ws) {
      rootOf.set(w.oid, root);
      if (w.oid !== root) {
        parents.add(root);
      }
    }
  }
  const out: OsmBuildingLut = { ...lut };
  for (const id of glass) {
    if (parents.has(id)) {
      continue;
    }
    const own: OsmBuildingFacts | undefined = out[id];
    const root = rootOf.get(id);
    const named = own?.material ?? (root ? out[root]?.material : undefined);
    if (!named) {
      out[id] = { ...own, material: "glass", materialFrom: "photos" };
    }
  }
  return out;
}
