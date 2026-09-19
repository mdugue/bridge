/**
 * The tiles the viewer loads, and the names of the files prepared for them.
 * One home for the tile ids: `scripts/prepare-data.ts` bakes exactly these
 * into `public/data/`, and `app/_components/city-walk-client.tsx` builds its
 * URLs from the same list. No THREE, no DOM.
 *
 * Tile id scheme (Saxony open data):
 * `<UTM zone><easting km>_<northing km>_<edge km>_sn`.
 */

/** Spawn tile — the one that is walked on, collided with and demolished. */
export const PRIMARY_TILE = "33412_5656_2_sn";

/** The rest of the 2x2 block, loaded for context only. */
export const NEIGHBOUR_TILES = [
  "33410_5656_2_sn",
  "33410_5658_2_sn",
  "33412_5658_2_sn",
];

/**
 * Heightfield grid size per role. The primary tile carries the silhouette the
 * player walks over and is sampled for ground height, so it gets 1024² (~2 m
 * over a 2 km tile); the neighbours are backdrop and load at 512².
 */
export const PRIMARY_HEIGHTFIELD_N = 1024;
export const NEIGHBOUR_HEIGHTFIELD_N = 512;

export interface TileSpec {
  /** heightfield grid size baked and served for this tile */
  n: number;
  tile: string;
}

/** Every tile the app loads, with the grid size it is served at. */
export const TILE_BLOCK: TileSpec[] = [
  { tile: PRIMARY_TILE, n: PRIMARY_HEIGHTFIELD_N },
  ...NEIGHBOUR_TILES.map((tile) => ({ tile, n: NEIGHBOUR_HEIGHTFIELD_N })),
];

/** Files served from /data (= public/data/), all derived from the tile id. */
export function cityJsonFile(tile: string): string {
  return `lod2_${tile}.city.json`;
}

export function heightfieldHeaderFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.json`;
}

export function heightfieldDataFile(tile: string, n: number): string {
  return `dgm1_${tile}.heightfield-${n}.f32`;
}
