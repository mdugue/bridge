import type {
  MonumentFeature,
  SoundmarkFeature,
  TramFeature,
} from "@/lib/city/features";
import { ringCentre } from "@/lib/city/monuments";
import { decodeGreyPng } from "@/lib/city/png-raster";
import {
  BELL_REACH_M,
  type BellTower,
  type ClassAt,
  classShares,
  nearestOnLines,
  nearestWater,
  NEAR_M,
  type SoundTile,
  stepSurface,
  type StepSurface,
  WATER_REACH_M,
} from "@/lib/city/soundscape";
import type { TerrainBounds } from "@/lib/city/terrain-geometry";
import { ownsPoint } from "@/lib/city/tileset";
import { fetchFeatures } from "../fetch-optional";

/**
 * What the soundscape knows of the tiles around the listener — CPU copies
 * fetched and decoded only while the sound plays, and dropped with it (the
 * viewer drops its own copies after upload, for iOS memory): the class
 * raster at 4 m (256 KB a tile, from the ≤ 2048² one), the sky view, the
 * paving raster's surface byte for the tile underfoot, and the small
 * vector files (bell towers, tram tracks, fountains) of every tile within
 * bell reach.
 */

/** A raster over a tile: row 0 = north. */
interface Grid {
  bounds: TerrainBounds;
  data: Uint8Array;
  size: number;
}

interface TileEar {
  classes?: Grid;
  fountains: [number, number][];
  /** set while a fetch for the tile's rasters runs or has run */
  rasters: "loaded" | "loading" | "none";
  skyView?: Grid;
  surface?: Grid;
  surfaceState: "loaded" | "loading" | "none";
  tile: SoundTile;
  towers: BellTower[];
  tracks: [number, number][][];
}

/** The class raster is kept at this edge (≈ 4 m over a 2 km tile). */
const CLASS_KEEP_PX = 512;
/** Rasters are fetched for tiles this close (m) and dropped beyond LEAVE_M. */
const LOAD_M = WATER_REACH_M + 60;
const LEAVE_M = LOAD_M + 400;

function distanceToBounds(b: TerrainBounds, x: number, y: number): number {
  const dx = Math.max(b[0] - x, 0, x - b[2]);
  const dy = Math.max(b[1] - y, 0, y - b[3]);
  return Math.hypot(dx, dy);
}

function gridAt(g: Grid | undefined, x: number, y: number): number | null {
  if (!g || !ownsPoint(g.bounds, x, y)) {
    return null;
  }
  const [x0, y0, x1, y1] = g.bounds;
  const c = Math.min(Math.floor(((x - x0) / (x1 - x0)) * g.size), g.size - 1);
  const r = Math.min(Math.floor(((y1 - y) / (y1 - y0)) * g.size), g.size - 1);
  return g.data[r * g.size + c];
}

/** Every `step`-th sample of every `step`-th row (NEAREST: no class blends). */
function decimate(
  data: Uint8Array,
  width: number,
  height: number,
  keep: number
) {
  const out = new Uint8Array(keep * keep);
  for (let r = 0; r < keep; r++) {
    const sr = Math.floor(((r + 0.5) * height) / keep);
    for (let c = 0; c < keep; c++) {
      out[r * keep + c] =
        data[sr * width + Math.floor(((c + 0.5) * width) / keep)];
    }
  }
  return out;
}

async function fetchPng(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return decodeGreyPng(new Uint8Array(await res.arrayBuffer()));
}

function towersOf(features: SoundmarkFeature[]): BellTower[] {
  return features.flatMap((f) =>
    f.properties && f.geometry.type === "Point"
      ? [
          {
            x: f.geometry.coordinates[0],
            y: f.geometry.coordinates[1],
            size: f.properties.size,
          },
        ]
      : []
  );
}

function tracksOf(features: TramFeature[]): [number, number][][] {
  return features.flatMap((f) =>
    f.properties?.k === "track" && f.geometry.type === "LineString"
      ? [f.geometry.coordinates.map(([x, y]): [number, number] => [x, y])]
      : []
  );
}

function fountainsOf(features: MonumentFeature[]): [number, number][] {
  return features.flatMap((f): [number, number][] => {
    if (f.properties?.kind !== "fountain") {
      return [];
    }
    const g = f.geometry;
    if (g.type === "Point") {
      return [[g.coordinates[0], g.coordinates[1]]];
    }
    const ring = g.coordinates[0];
    return ring
      ? [ringCentre(ring.map(([x, y]): [number, number] => [x, y]))]
      : [];
  });
}

/** What the ear reads at the listener. */
export interface Heard {
  fountainDistance: number;
  near: ReturnType<typeof classShares>;
  skyView: number | null;
  /** the surface a step lands on */
  surface: StepSurface;
  tram: { distance: number; x: number; y: number };
  water: { bearing: number; distance: number };
}

export interface Hearing {
  /** the bell towers within reach of a point (every tile's, once loaded) */
  towers: (x: number, y: number) => BellTower[];
  /** samples the environment at a point; starts fetches it lacks */
  hear: (x: number, y: number) => Heard;
  /** drops every copy and aborts what is in flight */
  dispose: () => void;
}

export function createHearing(tiles: readonly SoundTile[]): Hearing {
  const aborter = new AbortController();
  const { signal } = aborter;
  const ears: TileEar[] = tiles.map((tile) => ({
    tile,
    rasters: "none",
    surfaceState: "none",
    fountains: [],
    towers: [],
    tracks: [],
  }));
  // A file that fails (or is aborted with the sound) leaves its part of the
  // sound out; nothing retries while the sound plays.
  const quiet = () => undefined;

  // The small vector files of every tile: a few kB each.
  for (const ear of ears) {
    const { files } = ear.tile;
    Promise.all([
      fetchFeatures<SoundmarkFeature>(files.soundmarks, signal),
      fetchFeatures<TramFeature>(files.tram, signal),
      fetchFeatures<MonumentFeature>(files.monuments, signal),
    ]).then(([marks, trams, monuments]) => {
      ear.towers = towersOf(marks);
      ear.tracks = tracksOf(trams);
      ear.fountains = fountainsOf(monuments);
    }, quiet);
  }

  const loadRasters = (ear: TileEar) => {
    ear.rasters = "loading";
    const { tile } = ear;
    fetchPng(tile.landcover, signal).then((png) => {
      ear.classes = {
        bounds: tile.bounds,
        size: CLASS_KEEP_PX,
        data: decimate(png.data, png.width, png.height, CLASS_KEEP_PX),
      };
      ear.rasters = "loaded";
    }, quiet);
    if (tile.files.svf) {
      fetchPng(tile.files.svf, signal).then((png) => {
        ear.skyView = { bounds: tile.bounds, size: png.width, data: png.data };
      }, quiet);
    }
  };

  // The paving raster is RGBA packed 4× wide (surface.py); only R is kept.
  const loadSurface = (ear: TileEar) => {
    const url = ear.tile.files.surface;
    ear.surfaceState = "loading";
    if (!url) {
      return;
    }
    fetchPng(url, signal).then((png) => {
      const size = png.height;
      const data = new Uint8Array(size * size);
      for (let i = 0; i < size * size; i++) {
        data[i] = png.data[i * 4];
      }
      ear.surface = { bounds: ear.tile.bounds, size, data };
      ear.surfaceState = "loaded";
    }, quiet);
  };

  const manage = (x: number, y: number) => {
    for (const ear of ears) {
      const d = distanceToBounds(ear.tile.bounds, x, y);
      if (d <= LOAD_M && ear.rasters === "none") {
        loadRasters(ear);
      } else if (d > LEAVE_M && ear.rasters === "loaded") {
        ear.classes = undefined;
        ear.skyView = undefined;
        ear.rasters = "none";
      }
      const under = d === 0;
      if (under && ear.surfaceState === "none") {
        loadSurface(ear);
      } else if (d > NEAR_M * 10 && ear.surfaceState === "loaded") {
        ear.surface = undefined;
        ear.surfaceState = "none";
      }
    }
  };

  const earAt = (x: number, y: number) =>
    ears.find((e) => ownsPoint(e.tile.bounds, x, y));
  const classAt: ClassAt = (x, y) => gridAt(earAt(x, y)?.classes, x, y);

  const hear = (x: number, y: number): Heard => {
    manage(x, y);
    const ear = earAt(x, y);
    const svf = gridAt(ear?.skyView, x, y);
    const cls = classAt(x, y) ?? 0;
    const near = ears.filter(
      (e) => distanceToBounds(e.tile.bounds, x, y) < 200
    );
    const fountains = near.flatMap((e) => e.fountains);
    let fountainDistance = Number.POSITIVE_INFINITY;
    for (const [fx, fy] of fountains) {
      fountainDistance = Math.min(fountainDistance, Math.hypot(fx - x, fy - y));
    }
    return {
      near: classShares(classAt, x, y),
      water: nearestWater(classAt, x, y),
      skyView: svf === null ? null : svf / 255,
      surface: stepSurface(cls, gridAt(ear?.surface, x, y) ?? 0),
      tram: nearestOnLines(
        near.flatMap((e) => e.tracks),
        x,
        y
      ),
      fountainDistance,
    };
  };

  return {
    hear,
    towers: (x, y) =>
      ears
        .filter((e) => distanceToBounds(e.tile.bounds, x, y) <= BELL_REACH_M)
        .flatMap((e) => e.towers),
    dispose: () => {
      aborter.abort();
      for (const ear of ears) {
        ear.classes = undefined;
        ear.skyView = undefined;
        ear.surface = undefined;
      }
    },
  };
}
