/**
 * This session's demolitions, in one place: what goes when a building is
 * demolished (the picked object, the same object on its tile's other level,
 * the rest of its ensemble across a tile edge), what stays remembered across
 * a tile's unload, and how a tile that loads later takes them back
 * (`replayDemolitions`). The memory itself still lies in the stream's two
 * collections (`TileStream.demolished`, `demolishedGroups`), which only this
 * module writes. Pure bookkeeping over the layers: no GPU, no DOM.
 */
import type { CityLayer } from "./city-layer";

/** The part of a city layer a demolition reads and asks. */
export type DemolishedLayer = Pick<
  CityLayer,
  "alive" | "demolish" | "table" | "tile"
>;

/** The stream's memory of the session's demolitions, and its layers. */
export interface DemolitionMemory {
  cities: Iterable<DemolishedLayer>;
  /** demolished object indices per tile, kept across unload and reload */
  demolished: Map<string, Set<number>>;
  /** the site-wide groups of demolished ensembles */
  demolishedGroups: Set<number>;
}

export interface Demolitions {
  /** Demolishes an object of `layer` and all that goes with it; false when
   *  the layer refuses (it was gone already). */
  demolish: (layer: DemolishedLayer, objectIndex: number) => boolean;
  /** The objects of a tile demolished this session, if any. */
  goneOn: (tile: string) => ReadonlySet<number> | undefined;
}

export function createDemolitions(memory: DemolitionMemory): Demolitions {
  const keep = (layer: DemolishedLayer) => {
    const kept = memory.demolished.get(layer.tile) ?? new Set();
    for (let i = 0; i < layer.alive.length; i += 1) {
      if (!layer.alive[i]) {
        kept.add(i);
      }
    }
    memory.demolished.set(layer.tile, kept);
  };
  return {
    demolish: (layer, objectIndex) => {
      if (!layer.demolish(objectIndex)) {
        return false;
      }
      keep(layer);
      // the tile's other level (its far or its baked buildings: the same
      // table), loaded but not shown now: the same objects go
      for (const other of memory.cities) {
        if (other !== layer && other.tile === layer.tile) {
          other.demolish(objectIndex);
        }
      }
      // the rest of its ensemble in the tiles across an edge: those loaded
      // now, and (the group kept) those that load later
      const group = layer.table.group[objectIndex];
      if (!group) {
        return true;
      }
      memory.demolishedGroups.add(group);
      for (const other of memory.cities) {
        const first = other.table.group.indexOf(group);
        if (
          other.tile !== layer.tile &&
          first !== -1 &&
          other.demolish(first)
        ) {
          keep(other);
        }
      }
      return true;
    },
    goneOn: (tile) => memory.demolished.get(tile),
  };
}

/**
 * A tile that loads takes this session's demolitions back: `demolished` its
 * own, `demolishedGroups` those of ensembles across a tile edge (a part
 * demolished while this tile was not loaded). Marks them in `alive`; how
 * many objects are gone, so the caller knows whether to rebuild its index.
 */
export function replayDemolitions(
  alive: Uint8Array,
  group: ArrayLike<number>,
  demolished: ReadonlySet<number>,
  demolishedGroups: ReadonlySet<number>
): number {
  let dead = demolished.size;
  for (const i of demolished) {
    alive[i] = 0;
  }
  if (demolishedGroups.size > 0) {
    for (let i = 0; i < alive.length; i += 1) {
      if (alive[i] === 1 && demolishedGroups.has(group[i])) {
        alive[i] = 0;
        dead += 1;
      }
    }
  }
  return dead;
}
