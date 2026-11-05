/**
 * A site's rasters, by kind, behind one interface: what a content root reads
 * (a terrain level, a building tile's sky view) is on the GPU — or set up for
 * the compile, on a desktop — when handed out, shared by every root that
 * names the file, freed with the last holder, weighed a share per weighed
 * holder. Behind it: which file a level and a tier read (`rasterFiles`, the
 * tier twins and gates), the look (`RASTER_KINDS`), the turn and the upload
 * (raster-upload.ts), the sharing (shared-rasters.ts) and the weighing
 * (raster-shares.ts).
 *
 * The two holder counts stay two on purpose (plan 041): the buildings hold
 * the sky view, but a building tile weighs no raster.
 *
 * The file names are hashed (ADR 0024), so the runtime cannot compute them:
 * it maps a kind to a file through the content's extras, which the build
 * writes from the artifact table (lib/city/tile.ts `terrain`,
 * lib/city/tileset.ts `terrainRasterExtras`). A new tier twin or gate is a
 * column of its row here, never a branch in terrain-layer.ts.
 */
import {
  DataTexture,
  FloatType,
  NearestFilter,
  RGBAFormat,
} from "three/webgpu";
import type { DataArrayTexture, Texture, WebGPURenderer } from "three/webgpu";
import { WATER_CLASS } from "@/lib/city/landcover";
import { packMarkingTable } from "@/lib/city/markings";
import type { MarkingTable } from "@/lib/city/markings";
import { packSportTable } from "@/lib/city/sport";
import type { SportTable } from "@/lib/city/sport";
import type { ContentExtras, TerrainRasterKey } from "@/lib/city/tileset";
import { waterMaskOf } from "@/lib/city/water-mask";
import type { WaterMask } from "@/lib/city/water-mask";
import { fetchOptionalJson, untilAborted } from "./fetch-optional";
import { paintLandcoverSplat, splatScaleFor } from "./landcover-splat";
import type { LandcoverSplat } from "./landcover-splat";
import { RasterShares } from "./raster-shares";
import { loadDataRaster } from "./raster-upload";
import type { RasterLook } from "./raster-upload";
import { createSharedRasters } from "./shared-rasters";
import type { SharedRasters } from "./shared-rasters";
import { HORIZON_TEXTURE_LAYERS } from "@/lib/city/skyview";

/** A class raster and the colour splat painted from it. */
export interface SplatRasters {
  height: number;
  painted: LandcoverSplat;
  texture: Texture;
  width: number;
  /**
   * Where the raster has water (lib/city/water-mask.ts), read before its
   * bytes go: null where it has none, undefined where it could not be read
   * (a PNG the browser decoded) — the sheets then cover the whole tile.
   */
  water?: WaterMask | null;
}

/** A raster read through its table: the row raster and the float table. */
export interface IndexedRaster {
  raster: Texture;
  table: DataTexture;
}

/** What a content root reads, by kind (one row each in `RASTER_KINDS`). */
export type RasterKind =
  | "class"
  | "ndvi"
  | "surface"
  | "edges"
  | "sport"
  | "markings"
  | "colonies"
  | "svf"
  | "horizon";

export interface RasterOf {
  class: SplatRasters;
  colonies: Texture;
  edges: Texture;
  horizon: DataArrayTexture;
  markings: IndexedRaster;
  ndvi: Texture;
  sport: IndexedRaster;
  surface: Texture;
  svf: Texture;
}

/** A site's rasters: loaded once per file, on the GPU (or set up for the
 *  compile, on a desktop) when handed out, shared by every content root
 *  that names the file, freed with the last holder, weighed a share per
 *  weighed holder. */
export interface TileRasters {
  /** Σ over `root`'s rasters of tracked bytes / weighed holders. */
  bytesOf: (root: object) => number;
  /** frees everything, aborting loads on their way (the stream's end) */
  clear: () => void;
  /** `root`'s handle. `weighed: false` for a holder the tile cache does not
   *  weigh by its rasters (a building tile's sky view). */
  holder: (root: object, opts?: { weighed?: boolean }) => RasterHold;
}

export interface RasterHold {
  /** The raster `kind` the extras name for this level and tier, or null
   *  (not named, gated off, absent, undecodable, refused by the GPU, the
   *  hold let go meanwhile). Rejects only with an abort of `signal`, at once:
   *  the hold is let go by `release`, not by the wait. */
  acquire: <K extends RasterKind>(
    kind: K,
    extras: ContentExtras,
    signal?: AbortSignal
  ) => Promise<RasterOf[K] | null>;
  /** The holder is dressed: what it took, and takes from here on, counts in
   *  the shares. Until then it weighs nothing and moves nobody's share: the
   *  cache must not see a raster's other holders at half while this one
   *  still weighs 0 (ADR 0047). */
  settle: () => void;
  /** lets go of everything this holder took; idempotent */
  release: () => void;
}

/**
 * Whether a terrain level reads its tile's sports grounds: the fine level
 * on a desktop only. The index raster is a 2048² RGBA — 16 MiB on the GPU
 * for a PNG of a few dozen kB (14 of Dresden's 15 tiles have grounds) —
 * and the lines it places are a pixel or less beyond the fine level's
 * reach. A phone draws its pitches in their land-cover class, without
 * lines (the goals and nets come from the table, sport-fixtures.ts): 16
 * MiB a fine tile against a 336 MiB cache. Without the slot a level builds
 * the variant every tile without grounds shares.
 */
export function readsSportGrounds(level: 0 | 1, lowRasters: boolean): boolean {
  return level === 0 && !lowRasters;
}

/** A row of the kinds table: where the extras name the file, and its look. */
export interface RasterRow {
  /** the extras key of the file */
  extras: TerrainRasterKey;
  /** how it is sampled (raster-upload.ts) */
  look: RasterLook;
  /** the extras key of a phone's twin */
  phone?: TerrainRasterKey;
  /** a phone reads the full file where the twin is not named */
  phoneFallsBack?: true;
  /** whether this level, on this tier, reads it at all (always, unset) */
  readWhen?: (level: 0 | 1, lowRasters: boolean) => boolean;
  /** the extras key of the table it is read through: named only with it */
  table?: TerrainRasterKey;
}

/** Ids (class, paving, sports grounds, markings): exact texels. */
const idLook = (channels: 1 | 4): RasterLook => ({
  channels,
  filter: "nearest",
});

/** Fields (edge distances, colonies): smooth, read near the camera. */
const FIELD_LOOK: RasterLook = { channels: 2, filter: "linear" };

/**
 * The kinds table. A term whose raster is absent is left out of the ground's
 * graph, so what this hands out decides the program a level builds
 * (terrain-layer.ts `splatVariant`, ADR 0027).
 */
export const RASTER_KINDS: Readonly<Record<RasterKind, RasterRow>> = {
  /** The land-cover class ids, painted to the colour splat on the GPU (ADR
   *  0010); a phone's own 2048² raster, no fallback to the 4096². */
  class: {
    extras: "landcover",
    phone: "landcoverLow",
    look: { ...idLook(1), browserFallback: true },
  },
  /** The DOP's greenness for the meadow tint: LINEAR + mipmaps low-pass the
   *  ≈ 2 m raster into a smooth gradient, read across the whole tile. */
  ndvi: {
    extras: "ndvi",
    look: {
      channels: 1,
      filter: "linear",
      mipmaps: true,
      anisotropy: 16,
      browserFallback: true,
    },
  },
  /** OSM paving (pipeline/bake/surface.py): R = the packed road/walk surface
   *  ids and parking kind, G = the bearing, BA = the along-street offset. */
  surface: { extras: "surface", look: idLook(4) },
  /** Signed distances to the road and the meadow edge (edges.py): LINEAR so
   *  the isolines are smooth, no mipmaps (only read near the camera). */
  edges: { extras: "edges", look: FIELD_LOOK },
  /** Sports grounds (sport.py): R = the row, G = the second row, B = the
   *  exact bit. */
  sport: {
    extras: "sport",
    table: "sportTable",
    look: idLook(4),
    readWhen: readsSportGrounds,
  },
  /** Road markings (markings.py): RA = the row, G = lane bits, B = the centre
   *  offset; phones the 1024² twin of the same table. */
  markings: {
    extras: "markings",
    phone: "markingsLow",
    phoneFallsBack: true,
    table: "markingsTable",
    look: idLook(4),
  },
  /** Allotment colonies (cultivated.py, cropped by the build): R = the signed
   *  distance to the garden land's edge, G = the axis. LINEAR; no mipmaps
   *  (it fades out before it would need them). Phones the half-resolution
   *  twin of the same crop. */
  colonies: {
    extras: "cultivated",
    phone: "cultivatedLow",
    phoneFallsBack: true,
    look: FIELD_LOOK,
  },
  /** The sky-view factor (skyview.py): a soft field, read by the ground and
   *  the clay. */
  svf: {
    extras: "svf",
    look: { channels: 1, filter: "linear", mipmaps: true },
  },
  /** The horizon's eight layers: the far band's four planes, then the near
   *  band's. LINEAR (the angles interpolate), no mipmaps; an older one-band
   *  raster is no raster. */
  horizon: {
    extras: "horizon",
    look: { channels: 4, filter: "linear", layers: HORIZON_TEXTURE_LAYERS },
  },
};

/** The files a kind reads, by the name the extras give them. */
export interface RasterFiles {
  raster: string;
  table?: string;
}

/**
 * The files `kind` reads for this content, level and tier, or null: not
 * named, gated off, or a pair with one file missing. Not one rule for the
 * twins: `markings` and `colonies` fall back to the full file on a phone,
 * the class raster does not (its row).
 */
export function rasterFiles(
  extras: ContentExtras,
  kind: RasterKind,
  lowRasters: boolean
): RasterFiles | null {
  const row = RASTER_KINDS[kind];
  // reason: a building tile's extras name only some of these keys
  const named = extras as Partial<Record<TerrainRasterKey, string>> & {
    level?: 0 | 1;
  };
  if (row.readWhen && !row.readWhen(named.level ?? 0, lowRasters)) {
    return null;
  }
  const twin = lowRasters && row.phone ? named[row.phone] : undefined;
  const raster =
    lowRasters && row.phone && !row.phoneFallsBack
      ? twin
      : (twin ?? named[row.extras]);
  if (!raster) {
    return null;
  }
  if (!row.table) {
    return { raster };
  }
  const table = named[row.table];
  return table ? { raster, table } : null;
}

/** What a raster's load is handed. */
interface LoadContext {
  renderer: WebGPURenderer;
  signal: AbortSignal;
}

/** How one kind loads, what it weighs and how it is freed. */
interface KindHooks<T> {
  free: (value: T) => void;
  load: (key: string, kind: RasterKind, ctx: LoadContext) => Promise<T | null>;
  textures: (value: T) => Texture[];
}

/** A row and nothing else: one raster, its own texture. */
const plainHooks = <T extends Texture>(): KindHooks<T> => ({
  load: async (url, kind, { renderer, signal }) => {
    const loaded = await loadDataRaster(url, RASTER_KINDS[kind].look, {
      renderer,
      signal,
    });
    // reason: the row's look decides the class (`layers`: an array texture)
    return (loaded?.texture as T | undefined) ?? null;
  },
  textures: (texture) => [texture],
  free: (texture) => texture.dispose(),
});

/**
 * Loads a class raster and paints its colour splat: the coarse level reads
 * its own 1024² one on every tier, the fine level the 4096² one, or the
 * 2048² on a phone. Its water mask is read before its bytes go.
 */
const classHooks: KindHooks<SplatRasters> = {
  load: async (url, kind, { renderer, signal }) => {
    let water: WaterMask | null | undefined;
    const raster = await loadDataRaster(url, RASTER_KINDS[kind].look, {
      renderer,
      signal,
      inspect: (data, width, height) => {
        water = waterMaskOf(data, width, height, WATER_CLASS);
      },
    });
    if (!raster) {
      return null;
    }
    const { texture: classes, width, height } = raster;
    // every level that wanted it gone while it decoded: no splat painted (a
    // mipmapped RGBA target, half the raster's size at 4096²) for nobody
    if (signal.aborted) {
      classes.dispose();
      signal.throwIfAborted();
    }
    return {
      ...raster,
      water,
      painted: paintLandcoverSplat(
        renderer,
        classes,
        width,
        height,
        splatScaleFor(width)
      ),
    };
  },
  textures: ({ texture, painted }) => [texture, painted.texture],
  free: ({ texture, painted }) => {
    texture.dispose();
    painted.dispose();
  },
};

/** A 2-texel-high float table (sport.ts, markings.ts) as a NEAREST data
 *  texture; at least one texel wide (a table with no rows still binds).
 *  Not tracked: it weighs nothing in the cache. */
function tableTexture(packed: {
  data: Float32Array;
  width: number;
}): DataTexture {
  const table = new DataTexture(
    packed.width > 0 ? packed.data : new Float32Array(8),
    Math.max(packed.width, 1),
    2,
    RGBAFormat,
    FloatType
  );
  table.magFilter = NearestFilter;
  table.minFilter = NearestFilter;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  return table;
}

/** The key a pair is shared under: both files (one string, as
 *  `SharedRasters` keys). */
const PAIR_JOIN = "\n";

/**
 * A raster read through its table (the sports grounds, the road markings).
 * The table is packed first, so nothing can fail once the raster is on the
 * GPU; without the raster the table goes again. `pack` says whether the
 * table has what the raster needs (null: it does not, no raster fetched).
 */
const indexedHooks = (
  pack: (doc: object) => { data: Float32Array; width: number } | null
): KindHooks<IndexedRaster> => ({
  load: async (key, kind, { renderer, signal }) => {
    const [rasterUrl = "", tableUrl = ""] = key.split(PAIR_JOIN);
    const doc = await fetchOptionalJson<object>(tableUrl, signal);
    let table: DataTexture;
    try {
      const packed = doc && pack(doc);
      if (!packed) {
        return null;
      }
      table = tableTexture(packed);
    } catch {
      return null;
    }
    const loaded = await loadDataRaster(rasterUrl, RASTER_KINDS[kind].look, {
      renderer,
      signal,
    }).catch((error: unknown) => {
      table.dispose();
      throw error;
    });
    if (!loaded) {
      table.dispose();
      return null;
    }
    return { raster: loaded.texture, table };
  },
  textures: ({ raster, table }) => [raster, table],
  free: ({ raster, table }) => {
    raster.dispose();
    table.dispose();
  },
});

const HOOKS: { readonly [K in RasterKind]: KindHooks<RasterOf[K]> } = {
  class: classHooks,
  ndvi: plainHooks(),
  surface: plainHooks(),
  edges: plainHooks(),
  // Either file absent, empty or undecodable: a pitch stays its land-cover
  // class.
  sport: indexedHooks((doc) => {
    // reason: the bake's own table (pipeline/bake/sport.py), no schema yet
    const table = doc as SportTable;
    return table.grounds?.length ? packSportTable(table) : null;
  }),
  // A table with no rows still binds (a 1-texel texture): the lane bits need
  // the program, the row lookups never run.
  markings: indexedHooks((doc) => {
    // reason: the bake's own table (pipeline/bake/markings.py), no schema yet
    const table = doc as MarkingTable;
    return table.markings ? packMarkingTable(table) : null;
  }),
  colonies: plainHooks(),
  svf: plainHooks(),
  horizon: plainHooks<DataArrayTexture>(),
};

export function createTileRasters(opts: {
  /** resolves a file named in the extras to its URL */
  url: (file: string) => string;
  /** the tier's twins and gates */
  lowRasters: boolean;
  /** another root's share changed: reweigh its tile */
  onShareChange: (root: object) => void;
  renderer: WebGPURenderer;
}): TileRasters {
  const { lowRasters, onShareChange, renderer, url } = opts;
  const weighing = new RasterShares();
  /** what each weighed root holds, once each */
  const weighed = new Map<object, Set<Texture>>();
  let cleared = false;

  const shareOf = <K extends RasterKind>(
    kind: K
  ): SharedRasters<RasterOf[K]> => {
    const hooks: KindHooks<RasterOf[K]> = HOOKS[kind];
    return createSharedRasters<RasterOf[K]>(
      async (key, signal) => await hooks.load(key, kind, { renderer, signal }),
      hooks.free
    );
  };
  const shares: { readonly [K in RasterKind]: SharedRasters<RasterOf[K]> } = {
    class: shareOf("class"),
    ndvi: shareOf("ndvi"),
    surface: shareOf("surface"),
    edges: shareOf("edges"),
    sport: shareOf("sport"),
    markings: shareOf("markings"),
    colonies: shareOf("colonies"),
    svf: shareOf("svf"),
    horizon: shareOf("horizon"),
  };

  const reweigh = (others: readonly object[]) => {
    for (const other of others) {
      onShareChange(other);
    }
  };

  const weigh = (root: object, textures: Texture[]) => {
    let held = weighed.get(root);
    if (!held) {
      held = new Set();
      weighed.set(root, held);
    }
    for (const texture of textures) {
      held.add(texture);
    }
    reweigh(weighing.hold(root, textures));
  };

  const unweigh = (root: object) => {
    const held = weighed.get(root);
    if (held) {
      weighed.delete(root);
      reweigh(weighing.release(root, [...held]));
    }
  };

  return {
    holder: (root, holderOpts) => {
      const counted = holderOpts?.weighed !== false;
      const lets: (() => void)[] = [];
      let released = false;
      let settled = false;
      const landed: Texture[] = [];
      return {
        acquire: async <K extends RasterKind>(
          kind: K,
          extras: ContentExtras,
          signal?: AbortSignal
        ): Promise<RasterOf[K] | null> => {
          const files = rasterFiles(extras, kind, lowRasters);
          if (!files || released || cleared) {
            return null;
          }
          const key = files.table
            ? `${url(files.raster)}${PAIR_JOIN}${url(files.table)}`
            : url(files.raster);
          const share: SharedRasters<RasterOf[K]> = shares[kind];
          // the reference is taken here, in the caller's task; an abort lets
          // go at once (`release`), not once the raster this waits for has
          // decoded and uploaded: the last holder gone, its load stops too
          const loading = share.acquire(key);
          lets.push(() => share.release(key));
          const value = await untilAborted(loading, signal);
          if (value === null || released) {
            return null;
          }
          if (counted) {
            const hooks: KindHooks<RasterOf[K]> = HOOKS[kind];
            if (settled) {
              weigh(root, hooks.textures(value));
            } else {
              landed.push(...hooks.textures(value));
            }
          }
          return value;
        },
        settle: () => {
          if (settled || released) {
            return;
          }
          settled = true;
          if (landed.length > 0) {
            weigh(root, landed.splice(0));
          }
        },
        release: () => {
          if (released) {
            return;
          }
          released = true;
          // the shares first: the others reweighed while it is all alive
          unweigh(root);
          for (const letGo of lets.splice(0)) {
            letGo();
          }
        },
      };
    },
    bytesOf: (root) => weighing.bytesOf([...(weighed.get(root) ?? [])]),
    clear: () => {
      cleared = true;
      for (const share of Object.values(shares)) {
        share.clear();
      }
    },
  };
}
