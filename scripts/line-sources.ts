/**
 * A tile's committed line sources — its rails, ballast yards, platforms,
 * trams and riverside, and the bridges they ride — read from
 * `data/<site>/dlm/` as the fine terrain bake (prepare-data.ts, with
 * bake-lines.ts) and the ground-join check (ground-joins.ts) both need
 * them, the rails and trams with their levels (`lv`, scripts/
 * line-levels.ts). Reads files, no side effects.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  AreaFeature,
  BridgeFeature,
  FeatureCollection,
  RailFeature,
  RiversideFeature,
  TramFeature,
} from "../lib/city/features";
import type { LevelLine, LevelRun } from "../lib/city/levels";
import type { Site } from "../lib/city/site";
import {
  type LineKind,
  LINE_KINDS,
  sideFileSource,
  tileArtifacts,
} from "../lib/city/tile";

const at = (path: string) => join(process.cwd(), path);

/** A tile's line features, as its committed files hold them. */
export interface LineFeatures {
  ballast: AreaFeature[];
  bridges: BridgeFeature[];
  platforms: AreaFeature[];
  rails: RailFeature[];
  river: RiversideFeature[];
  trams: TramFeature[];
}

/** A tile's lines' runs off the ground, by line and feature index
 *  (scripts/line-levels.ts `SiteLevels[tile]`). */
export type TileLevels = Partial<Record<LevelLine, Record<number, LevelRun[]>>>;

/** The files a tile's lines are built from (the bake's cache inputs). */
export function lineSourceFiles(site: Site, tile: string): string[] {
  const a = tileArtifacts(tile);
  return [...LINE_KINDS, "bridge" as const].map((kind) =>
    at(sideFileSource(site, a[kind].file))
  );
}

/** A line file's features with each line's runs off the ground (`lv`), as
 *  prepare-data published them before the lines were baked. */
export function withLevels<F extends RailFeature | TramFeature>(
  features: F[],
  runs: Record<number, LevelRun[]> | undefined
): F[] {
  if (!runs || Object.keys(runs).length === 0) {
    return features;
  }
  return features.map((f, i) =>
    runs[i] ? { ...f, properties: { ...f.properties, lv: runs[i] } } : f
  );
}

/** A tile's line features (an absent file: none), the rails and trams
 *  with their levels. */
export function lineFeatures(
  site: Site,
  tile: string,
  levels: TileLevels = {}
): LineFeatures {
  const a = tileArtifacts(tile);
  const read = <F>(kind: LineKind | "bridge"): F[] => {
    const path = at(sideFileSource(site, a[kind].file));
    return existsSync(path)
      ? ((JSON.parse(readFileSync(path, "utf8")) as FeatureCollection<F>)
          .features ?? [])
      : [];
  };
  return {
    rails: withLevels(read<RailFeature>("rail"), levels.rail),
    ballast: read<AreaFeature>("railarea"),
    platforms: read<AreaFeature>("platform"),
    bridges: read<BridgeFeature>("bridge"),
    trams: withLevels(read<TramFeature>("tram"), levels.tram),
    river: read<RiversideFeature>("riverside"),
  };
}
