/**
 * The hidden soundscape's boot-side half (plan 035): the little the viewer
 * carries before anyone asks for sound — what the scene hands the engine
 * (`Listening`, the tiles' sound files) and the silence rule the toggle
 * applies. Everything else (lib/city/soundscape.ts and the engine) arrives
 * with the first toggle. No THREE, no DOM.
 */

import type { TerrainBounds } from "./terrain-geometry";
import type { TileSoundFiles, TilesetTileInfo } from "./tileset";

export type MovementMode = "fly" | "walk";

/** What the scene tells the soundscape at each pose sample (the handle's
 *  `listen`). */
export interface Listening {
  /** the scene clock (s) the crowns sway with */
  clock: number;
  heightAboveGround: number;
  mode: MovementMode;
  /** trees within the asked radius */
  trees: number;
}

/** A tile as the soundscape fetches it: its extent, its ≤ 2048² class
 *  raster and its sound files, all as served URLs. */
export interface SoundTile {
  bounds: TerrainBounds;
  files: TileSoundFiles;
  id: string;
  landcover: string;
}

/** A tileset tile's sound files resolved against the tileset's URL. */
export function soundTileOf(info: TilesetTileInfo, base: string): SoundTile {
  const files: TileSoundFiles = {};
  const kinds = ["monuments", "soundmarks", "surface", "svf", "tram"] as const;
  for (const kind of kinds) {
    const name = info.sound?.[kind];
    if (name) {
      files[kind] = new URL(name, base).href;
    }
  }
  return {
    bounds: info.bounds,
    files,
    id: info.id,
    landcover: new URL(info.minimap, base).href,
  };
}

// --- silence -------------------------------------------------------------------

export interface SilenceInputs {
  /** the visitor turned the sound on (L or the switch) */
  enabled: boolean;
  /** the tab is hidden */
  hidden: boolean;
  /** the loading screen is up */
  loading: boolean;
}

/** Whether the master is open: only after an explicit toggle (the speaker
 *  glyph's click turns it off again), never in a hidden tab, never behind
 *  the loading screen. */
export function audible(s: SilenceInputs): boolean {
  return s.enabled && !s.hidden && !s.loading;
}
