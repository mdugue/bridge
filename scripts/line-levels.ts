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
  AreaFeature,
  BridgeFeature,
  RailFeature,
  TramFeature,
} from "../lib/city/features";
import { epsgToWorld } from "../lib/city/ground-clamp";
import {
  LEVEL_JUMP_M,
  type LevelLine,
  type LevelRun,
  lineGrade,
  runLevelAt,
} from "../lib/city/levels";
import {
  DECK_REACH_M,
  isMonorail,
  type LevelGround,
  type LinePiece,
  pieceSamples,
  RIDES,
  railPrefer,
  railSteep,
  solvePieces,
} from "../lib/city/line-levels";
import { decodeProfile, encodeProfile } from "../lib/city/line-profile";
import {
  BURIED_M,
  type Bed,
  type BedShape,
  railBed,
  TRACK_PITCH_M,
  tramBed,
} from "../lib/city/track-beds";
import {
  deckPassages,
  PASSAGE_UNDER_DECK,
  type Passage,
  passageHalf,
} from "../lib/city/passages";
import {
  DLM_REST_M,
  outsideAreas,
  PLATFORM_EDGE_M,
  type TrackAxis,
} from "../lib/city/platform-clearance";
import type { Point2 } from "../lib/city/polyline";
import type { Site } from "../lib/city/site";
import { sampleHeightfield } from "../lib/city/terrain-geometry";
import { dgmSourceFiles, sideFileSource, tileIds } from "../lib/city/tile";
import { ownsPoint } from "../lib/city/tileset";
import { type Dgm, readDgm } from "./bake-tiles";

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

/** Every platform outline of the site (OSM's, pipeline/bake/rail.py). */
const platformMemo = new Map<string, Point2[][][]>();

export function sitePlatforms(site: Site): Point2[][][] {
  let found = platformMemo.get(site.id);
  if (!found) {
    found = readPlatforms(site);
    platformMemo.set(site.id, found);
  }
  return found;
}

function readPlatforms(site: Site): Point2[][][] {
  return tileIds(site).flatMap((tile) =>
    features<AreaFeature>(lineFile(site, "platform", tile)).flatMap((f) => {
      const g = f.geometry;
      if (g?.type === "Polygon") {
        return [g.coordinates];
      }
      return g?.type === "MultiPolygon" ? g.coordinates : [];
    })
  );
}

/** A Basis-DLM line (rail.py writes `bridge` on every OSM track, never on
 *  the DLM's lines it keeps where OSM maps no track; a monorail's beam has
 *  none either, and is no line). */
export function isDlmLine(f: RailFeature): boolean {
  return f.properties?.bridge === undefined && !isMonorail(f);
}

/** A catenary mast belongs to the part of a split line it stands this
 *  near (m). */
const MAST_REACH_M = 8;

/** How far (m) a mast stands from a part of a line. */
function distanceToPart(x: number, y: number, part: readonly Point2[]): number {
  let d = Infinity;
  for (let i = 1; i < part.length; i++) {
    d = Math.min(d, distanceToSegment(x, y, part[i - 1], part[i]));
  }
  return d;
}

/** The masts (`m`) that stand beside part `k` of a line: each with the
 *  part it is nearest (one mast, one part), within MAST_REACH_M — those
 *  beside the stretch dropped go with it. */
function mastsBeside(
  masts: [number, number][] | undefined,
  parts: readonly Point2[][],
  k: number
): { m?: [number, number][] } {
  if (!masts) {
    return {};
  }
  const near = masts.filter(([x, y]) => {
    const d = parts.map((part) => distanceToPart(x, y, part));
    const best = Math.min(...d);
    return best <= MAST_REACH_M && d.indexOf(best) === k;
  });
  return near.length > 0 ? { m: near } : {};
}

/** The distance (m) from (x, y) to the segment a→b. */
function distanceToSegment(x: number, y: number, a: Point2, b: Point2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t =
    l2 > 0
      ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2))
      : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

const railMemo = new Map<string, Map<string, RailFeature[]>>();

/**
 * A tile's rail lines as the build draws them: the bake's file, a
 * Basis-DLM line's stretches over a platform dropped
 * (lib/city/platform-clearance.ts `outsideAreas` — a line's centreline
 * between the tracks of a station, not a track). A line split in two
 * keeps its place with its first part; the others follow the file's
 * lines. Every reader of the rail lines (the levels, the beds, the
 * published file) takes them from here, so the indices agree.
 */
export function railFeatures(site: Site, tile: string): RailFeature[] {
  let bySite = railMemo.get(site.id);
  if (!bySite) {
    bySite = new Map();
    railMemo.set(site.id, bySite);
  }
  const memo = bySite.get(tile);
  if (memo) {
    return memo;
  }
  const raw = features<RailFeature>(lineFile(site, LINE_FILES.rail, tile));
  let platforms: Point2[][][] | undefined;
  const extra: RailFeature[] = [];
  const kept = raw.flatMap((f): RailFeature[] => {
    if (f.geometry?.type !== "LineString" || !isDlmLine(f)) {
      return [f];
    }
    const { m, ...props } = f.properties ?? {};
    platforms ??= sitePlatforms(site);
    const parts = outsideAreas(f.geometry.coordinates, platforms, DLM_REST_M);
    if (parts === null) {
      return [f];
    }
    const [first, ...rest] = parts.map((coords, k): RailFeature => ({
      ...f,
      geometry: { type: "LineString", coordinates: coords },
      properties: { ...props, ...mastsBeside(m, parts, k) },
    }));
    extra.push(...rest);
    return first ? [first] : [];
  });
  const out = [...kept, ...extra];
  bySite.set(tile, out);
  return out;
}

/** Every file the site's levels are solved from (the cache key). */
export function levelInputs(site: Site): string[] {
  return tileIds(site).flatMap((tile) => {
    const dgm = dgmSourceFiles(site, tile);
    return [
      at(dgm.tif),
      at(dgm.tfw),
      lineFile(site, "bridge", tile),
      lineFile(site, "platform", tile),
      ...Object.values(LINE_FILES).map((k) => lineFile(site, k, tile)),
    ];
  });
}

/** A piece's tile, file and feature index. */
interface PieceOf {
  /** the bed it is laid on (lib/city/track-beds.ts) */
  bed: BedShape;
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
    railFeatures(site, tile).forEach((f, index) => {
      // a monorail's beam has no track to lay (lib/city/monorail.ts)
      if (f.geometry?.type === "LineString" && !isMonorail(f)) {
        pieces.push({
          coords: f.geometry.coordinates,
          line: "rail",
          prefer: railPrefer(f),
          below: (f.properties?.layer ?? 0) < 0,
          steep: railSteep(f),
        });
        of.push({
          tile,
          line: "rail",
          index,
          tracks: f.properties?.tracks ?? 1,
          bed: railBed(f),
        });
      }
    });
    features<TramFeature>(lineFile(site, LINE_FILES.tram, tile)).forEach(
      (f, index) => {
        if (isTrack(f) && f.geometry.type === "LineString") {
          pieces.push({
            coords: f.geometry.coordinates,
            line: "tram",
            prefer: f.properties?.bridge === 1 ? "deck" : "ground",
          });
          of.push({
            tile,
            line: "tram",
            index,
            tracks: 1,
            bed: tramBed(f.properties?.bed ?? "street"),
          });
        }
      }
    );
  }
  return { pieces, of };
}

/** The site's decks: every tile's bridges, each deck once (a deck across
 *  a seam is in both tiles' files). */
export function siteDecks(site: Site): DeckPoly[] {
  return bridgeDecks(siteBridges(site), OFFSET);
}

/** Every deck of the site once (a deck across a seam is in both tiles'
 *  files). */
function siteBridges(site: Site): BridgeFeature[] {
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
  return all;
}

/** A tile's native DGM from its TIFF and world file. */
export type ReadDgm = (tif: string, tfw: string) => Promise<Dgm>;

async function decodeDgm(tif: string, tfw: string): Promise<Dgm> {
  const bytes = readFileSync(tif);
  return readDgm(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    existsSync(tfw) ? readFileSync(tfw, "utf8") : null,
    "native"
  );
}

/** The site's ground: every tile's native DGM, read by `read` (the checks
 *  pass scripts/dgm-cache.ts's, which the build does not import). */
export async function siteDgm(
  site: Site,
  read: ReadDgm = decodeDgm
): Promise<(x: number, y: number) => number | null> {
  const grounds = await Promise.all(
    tileIds(site).map(async (tile) => {
      const src = dgmSourceFiles(site, tile);
      const dgm = await read(at(src.tif), at(src.tfw));
      return { bounds: dgm.bounds, field: dgm };
    })
  );
  return (x, y) => {
    const g = grounds.find((t) => ownsPoint(t.bounds, x, y));
    const h = g ? sampleHeightfield(g.field, x, y) : null;
    return h === null || Number.isNaN(h) ? null : h;
  };
}

/** What a line's feature publishes: its runs off the ground (`lv`, only
 *  where it has any) and its profile (`lz`, lib/city/line-profile.ts). */
export interface LineLevels {
  lv?: LevelRun[];
  lz: (number | null)[];
}

/** tile → line → feature index → what the line publishes. */
export type SiteLevels = Record<
  string,
  Partial<Record<LevelLine, Record<number, LineLevels>>>
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
  solvePieces(pieces, ground).forEach(({ runs, profile }, k) => {
    const { tile, line, index } = of[k];
    const byLine = (out[tile] ??= {});
    (byLine[line] ??= {})[index] = {
      ...(runs.length > 0 ? { lv: runs } : {}),
      lz: encodeProfile(profile),
    };
  });
  return out;
}

/**
 * The passages the site's lines open under its decks (lib/city/passages.ts):
 * every cut (`LevelRun` "c") that lies under a drawn deck, with its rims,
 * at the cut's level. A line near a seam is in both tiles' files: its
 * passage is opened once per copy, the same. Then the decks' own passages
 * (`deckPassages`), each deck once.
 */
export function sitePassages(site: Site, levels: SiteLevels): Passage[] {
  const bridges = siteBridges(site);
  const decks = bridgeDecks(bridges, OFFSET);
  const { pieces, of } = sitePieces(site);
  const out: Passage[] = [];
  pieces.forEach((piece, k) => {
    const { tile, line, index, tracks } = of[k];
    const solved = levels[tile]?.[line]?.[index];
    const runs = solved?.lv ?? [];
    if (!runs.some((r) => r[2] === "c")) {
      return;
    }
    const pts = pieceSamples(piece);
    const z = solved?.lz ? decodeProfile(solved.lz) : [];
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
        // the track is drawn on its profile: the floor follows it
        y: idx.map((i) => z[i] ?? runLevelAt(runs, d, i)?.y ?? Number.NaN),
      });
    }
  });
  // a rim is on the ground: its level is the line's own there
  // and the decks' own: the streets and paths the DGM closes under them,
  // the bridges it still holds (`under`, pipeline/bake/bridge.py)
  return [...out.map((p) => fillRims(p)), ...deckPassages(bridges)];
}

/**
 * The beds the site's lines lie on (lib/city/track-beds.ts): every stretch
 * of a line on the ground at its profile, every stretch on a deck or over
 * a span as a bed that only lowers the ground, and every cut as a trench
 * where the ground lies at most BURIED_M over it (deeper it is a tunnel's
 * or a passage's). A line near a seam is in both tiles' files: both copies' beds
 * are burned, the same within millimetres (the profile is fitted over the
 * same context).
 */
export function siteBeds(site: Site, levels: SiteLevels): Bed[] {
  const { pieces, of } = sitePieces(site);
  const out: Bed[] = [];
  pieces.forEach((piece, k) => {
    const { tile, line, index, bed } = of[k];
    const solved = levels[tile]?.[line]?.[index];
    if (!solved) {
      return;
    }
    const runs = solved.lv ?? [];
    const z = decodeProfile(solved.lz);
    const pts = pieceSamples(piece);
    const d: number[] = [];
    pts.forEach((p, i) =>
      d.push(
        i === 0
          ? 0
          : d[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
      )
    );
    type Kind = "lay" | "lower" | "cut";
    let run: { coords: Point2[]; z: number[]; kind: Kind } = {
      coords: [],
      z: [],
      kind: "lay",
    };
    const flush = (kind: Kind) => {
      if (run.coords.length >= 2) {
        out.push({
          ...bed,
          coords: run.coords,
          z: run.z,
          ...(run.kind === "lower" ? { lowerOnly: true } : {}),
          ...(run.kind === "cut" ? { shallow: BURIED_M } : {}),
        });
      }
      run = { coords: [], z: [], kind };
    };
    pts.forEach((p, i) => {
      const zi = z[i];
      if (zi === null || zi === undefined) {
        flush("lay");
        return;
      }
      const mode = runLevelAt(runs, d, i)?.mode ?? "ground";
      const kind: Kind =
        mode === "ground" ? "lay" : mode === "cut" ? "cut" : "lower";
      if (kind !== run.kind) {
        // the two runs share the sample where they meet
        const last = run.coords.at(-1);
        const lastZ = run.z.at(-1);
        flush(kind);
        if (last && lastZ !== undefined) {
          run.coords.push(last);
          run.z.push(lastZ);
        }
      }
      run.coords.push(p);
      run.z.push(zi);
    });
    flush("lay");
  });
  return out;
}

/** The rail layer draws a line of at most this many tracks
 *  (app/_components/rail-layer.ts). */
const MAX_TRACKS = 3;

/**
 * The site's drawn tracks as the axes a platform keeps clear of
 * (lib/city/platform-clearance.ts): every rail and tram line above ground,
 * a line of several tracks by its outer track's distance from its axis,
 * on its profile where it has one (a track crossing a platform on a
 * bridge leaves it whole).
 */
export function siteTrackAxes(site: Site, levels: SiteLevels): TrackAxis[] {
  const { pieces, of } = sitePieces(site);
  return pieces.flatMap((piece, k): TrackAxis[] => {
    if (piece.below) {
      return [];
    }
    const { line, tracks, tile, index } = of[k];
    const n = Math.min(Math.max(tracks, 1), MAX_TRACKS);
    const clear =
      line === "rail"
        ? PLATFORM_EDGE_M.rail + ((n - 1) * TRACK_PITCH_M) / 2
        : PLATFORM_EDGE_M.tram;
    const lz = levels[tile]?.[line]?.[index]?.lz;
    const z = lz ? decodeProfile(lz) : [];
    const pts = pieceSamples(piece);
    if (z.length !== pts.length || z.some((v) => v === null)) {
      return [{ coords: piece.coords, clear }];
    }
    return [{ coords: pts, clear, z: z as number[] }];
  });
}

/** The deck cell (m) of `underDecks`' index. */
const DECK_CELL_M = 32;

/** Whether a point (EPSG) lies on any of `decks` (`siteDecks`): the ground
 *  there is the passage's, never a bed's. */
export function underDecks(
  decks: readonly DeckPoly[]
): (x: number, y: number) => boolean {
  const cells = new Map<string, DeckPoly[]>();
  for (const d of decks) {
    for (
      let c = Math.floor(d.minX / DECK_CELL_M);
      c <= Math.floor(d.maxX / DECK_CELL_M);
      c++
    ) {
      for (
        let r = Math.floor(d.minZ / DECK_CELL_M);
        r <= Math.floor(d.maxZ / DECK_CELL_M);
        r++
      ) {
        const key = `${c}:${r}`;
        const list = cells.get(key);
        if (list) {
          list.push(d);
        } else {
          cells.set(key, [d]);
        }
      }
    }
  }
  return (x, y) => {
    const w = epsgToWorld(x, y, OFFSET);
    const list = cells.get(
      `${Math.floor(w.x / DECK_CELL_M)}:${Math.floor(w.z / DECK_CELL_M)}`
    );
    return !!list && decksAt(list, w.x, w.z, undefined, "decks").length > 0;
  };
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

/** The height a layer draws a sample at without a profile: its run's,
 *  the deck nearest it, or the ground (the layers' rule, on the DGM). */
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
  levels?: SiteLevels,
  minStep = LEVEL_JUMP_M,
  read?: ReadDgm
): Promise<JumpReport> {
  const heightAt = await siteDgm(site, read);
  const solved = levels ?? (await siteLineLevels(site, heightAt));
  const decks = siteDecks(site);
  const { pieces, of } = sitePieces(site);
  const report: JumpReport = { before: 0, after: 0, samples: 0, worst: [] };
  pieces.forEach((piece, k) => {
    const { tile, line, index } = of[k];
    const baked = solved[tile]?.[line]?.[index];
    const runs = baked?.lv ?? [];
    const profile = baked ? decodeProfile(baked.lz) : null;
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
      now.push(
        profile && profile.length === pts.length
          ? profile[i]
          : drawnAt(runLevelAt(runs, d, i), g, under)
      );
    });
    report.samples += pts.length;
    const jump = (ys: (number | null)[], i: number) => {
      const a = ys[i - 1];
      const b = ys[i];
      if (a === null || b === null) {
        return 0;
      }
      const grade = lineGrade(line, piece.steep);
      const by = Math.abs(b - a) - grade * (d[i] - d[i - 1]) - 0.35;
      return by >= minStep ? by : 0;
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
