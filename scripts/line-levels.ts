/**
 * The levels of a site's railway and tram lines (lib/city/levels.ts,
 * lib/city/line-levels.ts), from its committed files: every tile's rails,
 * trams and bridge decks on the native DGM. prepare-data.ts bakes them into
 * the published rail and tram files (`lv` on each line), so the layers
 * draw a line on the level its whole run says — not lifted onto every deck
 * it passes under, not dropped into the gap the DGM leaves around a
 * bridge. Reads files, no side effects.
 *
 * Where the drawn lines still jump, before (the old rule: any deck under a
 * point lifts it) and after: `bun scripts/line-levels-cli.ts <site>`. The
 * runner is a file of its own so this module imports no `sites/` config
 * (the build cache keys the terrain on this module's imports).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeDecks, type DeckPoly, decksAt } from "../lib/city/decks";
import type {
  BridgeFeature,
  RailFeature,
  TramFeature,
} from "../lib/city/features";
import { epsgToWorld } from "../lib/city/ground-clamp";
import {
  LEVEL_GRADE,
  LEVEL_JUMP_M,
  type LevelLine,
  type LevelRun,
  runLevelAt,
} from "../lib/city/levels";
import {
  DECK_REACH_M,
  type LevelGround,
  type LinePiece,
  pieceSamples,
  RIDES,
  solvePieces,
} from "../lib/city/line-levels";
import { type Passage, passageHalf } from "../lib/city/passages";
import type { Site } from "../lib/city/site";
import { sampleHeightfield } from "../lib/city/terrain-geometry";
import { dgmSourceFiles, sideFileSource, tileIds } from "../lib/city/tile";
import { ownsPoint } from "../lib/city/tileset";
import { readDgm } from "./bake-tiles";

const at = (path: string) => join(process.cwd(), path);

const OFFSET = { cx: 0, cy: 0 }; // levels are heights: the frame does not matter

/** The line files of a tile, by the line they hold. */
export const LINE_FILES: Readonly<Record<LevelLine, string>> = {
  rail: "rail",
  tram: "tram",
};

/** The file of a tile's lines or decks under data/<site>/dlm/. */
export function lineFile(site: Site, kind: string, tile: string): string {
  return at(sideFileSource(site, `${kind}_${tile}.geojson`));
}

function features<F>(path: string): F[] {
  return existsSync(path)
    ? ((JSON.parse(readFileSync(path, "utf8")) as { features?: F[] })
        .features ?? [])
    : [];
}

/** Every file the site's levels are solved from (the cache key). */
export function levelInputs(site: Site): string[] {
  return tileIds(site).flatMap((tile) => {
    const dgm = dgmSourceFiles(site, tile);
    return [
      at(dgm.tif),
      at(dgm.tfw),
      lineFile(site, "bridge", tile),
      ...Object.values(LINE_FILES).map((k) => lineFile(site, k, tile)),
    ];
  });
}

/** A piece's tile, file and feature index. */
interface PieceOf {
  index: number;
  line: LevelLine;
  tile: string;
  /** a rail's track count (a tram track is one) */
  tracks: number;
}

/** A tram feature that is a track (the file holds masts and spans too). */
function isTrack(f: TramFeature): boolean {
  return f.properties?.k === "track" && f.geometry?.type === "LineString";
}

/** Every line piece of the site, with where it came from. */
function sitePieces(site: Site): { pieces: LinePiece[]; of: PieceOf[] } {
  const pieces: LinePiece[] = [];
  const of: PieceOf[] = [];
  for (const tile of tileIds(site)) {
    features<RailFeature>(lineFile(site, LINE_FILES.rail, tile)).forEach(
      (f, index) => {
        if (f.geometry?.type === "LineString") {
          pieces.push({ coords: f.geometry.coordinates, line: "rail" });
          of.push({
            tile,
            line: "rail",
            index,
            tracks: f.properties?.tracks ?? 1,
          });
        }
      }
    );
    features<TramFeature>(lineFile(site, LINE_FILES.tram, tile)).forEach(
      (f, index) => {
        if (isTrack(f) && f.geometry.type === "LineString") {
          pieces.push({
            coords: f.geometry.coordinates,
            line: "tram",
            prefer: f.properties?.bridge === 1 ? "deck" : "ground",
          });
          of.push({ tile, line: "tram", index, tracks: 1 });
        }
      }
    );
  }
  return { pieces, of };
}

/** The site's decks: every tile's bridges, each deck once (a deck across
 *  a seam is in both tiles' files). */
function siteDecks(site: Site): DeckPoly[] {
  const seen = new Set<string>();
  const all: BridgeFeature[] = [];
  for (const tile of tileIds(site)) {
    for (const f of features<BridgeFeature>(lineFile(site, "bridge", tile))) {
      const key = JSON.stringify(f.geometry?.coordinates?.[0]?.slice(0, 3));
      if (!seen.has(key)) {
        seen.add(key);
        all.push(f);
      }
    }
  }
  return bridgeDecks(all, OFFSET);
}

/** The site's ground: every tile's native DGM. */
async function siteDgm(
  site: Site
): Promise<(x: number, y: number) => number | null> {
  const grounds = await Promise.all(
    tileIds(site).map(async (tile) => {
      const src = dgmSourceFiles(site, tile);
      const tif = readFileSync(at(src.tif));
      const dgm = await readDgm(
        tif.buffer.slice(tif.byteOffset, tif.byteOffset + tif.byteLength),
        existsSync(at(src.tfw)) ? readFileSync(at(src.tfw), "utf8") : null,
        "native"
      );
      return { bounds: dgm.bounds, field: dgm };
    })
  );
  return (x, y) => {
    const g = grounds.find((t) => ownsPoint(t.bounds, x, y));
    const h = g ? sampleHeightfield(g.field, x, y) : null;
    return h === null || Number.isNaN(h) ? null : h;
  };
}

/** tile → line → feature index → its runs off the ground (only lines
 *  that have any). */
export type SiteLevels = Record<
  string,
  Partial<Record<LevelLine, Record<number, LevelRun[]>>>
>;

/** The levels of every line of the site, solved on its DGM. */
export async function siteLineLevels(
  site: Site,
  heightAt?: (x: number, y: number) => number | null
): Promise<SiteLevels> {
  const { pieces, of } = sitePieces(site);
  const ground: LevelGround = {
    decks: siteDecks(site),
    heightAt: heightAt ?? (await siteDgm(site)),
    offset: OFFSET,
  };
  const out: SiteLevels = {};
  solvePieces(pieces, ground).forEach((runs, k) => {
    if (runs.length === 0) {
      return;
    }
    const { tile, line, index } = of[k];
    const byLine = (out[tile] ??= {});
    (byLine[line] ??= {})[index] = runs;
  });
  return out;
}

/** A cut opens a passage when at least this share of it lies under a
 *  drawn deck (any kind): the fill under a bridge, not a tunnel or a
 *  station's cover. */
const PASSAGE_UNDER_DECK = 0.3;

/**
 * The passages the site's lines open under its decks (lib/city/passages.ts):
 * every cut (`LevelRun` "c") that lies under a drawn deck, with its rims,
 * at the cut's level. A line near a seam is in both tiles' files: its
 * passage is opened once per copy, the same.
 */
export function sitePassages(site: Site, levels: SiteLevels): Passage[] {
  const decks = siteDecks(site);
  const { pieces, of } = sitePieces(site);
  const out: Passage[] = [];
  pieces.forEach((piece, k) => {
    const { tile, line, index, tracks } = of[k];
    const runs = levels[tile]?.[line]?.[index] ?? [];
    if (!runs.some((r) => r[2] === "c")) {
      return;
    }
    const pts = pieceSamples(piece);
    const d: number[] = [];
    pts.forEach((p, i) =>
      d.push(
        i === 0
          ? 0
          : d[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
      )
    );
    for (const [a, b, mode] of runs) {
      if (mode !== "c") {
        continue;
      }
      let covered = 0;
      for (let i = a; i <= b; i++) {
        const w = epsgToWorld(pts[i][0], pts[i][1], OFFSET);
        if (decksAt(decks, w.x, w.z, undefined, "all", DECK_REACH_M).length) {
          covered++;
        }
      }
      if (covered < PASSAGE_UNDER_DECK * (b - a + 1)) {
        continue;
      }
      const from = Math.max(a - 1, 0);
      const to = Math.min(b + 1, pts.length - 1);
      const idx = Array.from({ length: to - from + 1 }, (_, i) => from + i);
      out.push({
        coords: idx.map((i) => pts[i]),
        half: passageHalf(tracks),
        y: idx.map((i) => runLevelAt(runs, d, i)?.y ?? Number.NaN),
      });
    }
  });
  // a rim is on the ground: its level is the line's own there
  return out.map((p) => fillRims(p));
}

/** A passage's rims (outside the cut) at their neighbours' level. */
function fillRims(p: Passage): Passage {
  const y = [...p.y];
  if (Number.isNaN(y[0])) {
    y[0] = y[1];
  }
  const last = y.length - 1;
  if (Number.isNaN(y[last])) {
    y[last] = y[last - 1];
  }
  return { ...p, y };
}

/** The height a layer draws a sample at: its run's, the deck nearest it,
 *  or the ground (the layers' rule, on the DGM). */
function drawnAt(
  run: ReturnType<typeof runLevelAt>,
  ground: number | null,
  decks: readonly number[]
): number | null {
  if (!run) {
    return ground;
  }
  if (run.mode !== "deck" || decks.length === 0) {
    return run.y;
  }
  return decks.reduce((p, q) =>
    Math.abs(q - run.y) < Math.abs(p - run.y) ? q : p
  );
}

/** Where drawn lines jump: steps between two samples beyond the line's
 *  grade by more than a LEVEL_JUMP_M, with the old rule's count beside. */
export interface JumpReport {
  /** the old rule: any deck under a point lifts it */
  before: number;
  after: number;
  samples: number;
  worst: { line: LevelLine; x: number; y: number; by: number }[];
}

/** Counts the jumps of every line of the site, drawn with `levels`. */
export async function measureJumps(
  site: Site,
  levels?: SiteLevels
): Promise<JumpReport> {
  const heightAt = await siteDgm(site);
  const solved = levels ?? (await siteLineLevels(site, heightAt));
  const decks = siteDecks(site);
  const { pieces, of } = sitePieces(site);
  const report: JumpReport = { before: 0, after: 0, samples: 0, worst: [] };
  pieces.forEach((piece, k) => {
    const { tile, line, index } = of[k];
    const runs = solved[tile]?.[line]?.[index] ?? [];
    const pts = pieceSamples(piece);
    const d: number[] = [];
    let run = 0;
    const old: (number | null)[] = [];
    const now: (number | null)[] = [];
    pts.forEach((p, i) => {
      if (i > 0) {
        run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      }
      d.push(run);
      const w = epsgToWorld(p[0], p[1], OFFSET);
      const under = decksAt(decks, w.x, w.z, RIDES[line], "all", DECK_REACH_M);
      const g = heightAt(p[0], p[1]);
      old.push(under[0] ?? g);
      now.push(drawnAt(runLevelAt(runs, d, i), g, under));
    });
    report.samples += pts.length;
    const jump = (ys: (number | null)[], i: number) => {
      const a = ys[i - 1];
      const b = ys[i];
      if (a === null || b === null) {
        return 0;
      }
      const by = Math.abs(b - a) - LEVEL_GRADE[line] * (d[i] - d[i - 1]) - 0.35;
      return by >= LEVEL_JUMP_M ? by : 0;
    };
    for (let i = 1; i < pts.length; i++) {
      if (jump(old, i) > 0) {
        report.before++;
      }
      const by = jump(now, i);
      if (by > 0) {
        report.after++;
        report.worst.push({ line, x: pts[i][0], y: pts[i][1], by });
      }
    }
  });
  report.worst.sort((p, q) => q.by - p.by);
  return report;
}
