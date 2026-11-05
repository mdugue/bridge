import type { Mesh } from "three/webgpu";
import { Group, ShapeUtils, Vector2 } from "three/webgpu";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import {
  bridgeDecks,
  decksAt,
  pointInRing,
  ringToWorld,
} from "@/lib/city/decks";
import type { DeckPoly, Ring2 } from "@/lib/city/decks";
import { epsgToWorld, worldToEpsg } from "@/lib/city/ground-clamp";
import type { GroundContext } from "@/lib/city/ground-clamp";
import {
  LEVEL_STEP,
  lineGrade,
  lineLevels,
  modeRuns,
  runLevelAt,
} from "@/lib/city/levels";
import type { Level, LevelLine, LevelRun } from "@/lib/city/levels";
import { OVERPASS_DEPTH_M, OVERPASS_M } from "@/lib/city/catenary";
import {
  DECK_REACH_M,
  isMonorail,
  RIDES,
  railPrefer,
  railSteep,
} from "@/lib/city/line-levels";
import { platformTops, TrackIndex } from "@/lib/city/platform-level";
import type { TrackSample } from "@/lib/city/platform-level";
import { decodeProfile } from "@/lib/city/line-profile";
import { PASSAGE_UNDER_DECK } from "@/lib/city/passages";
import { subdividePolyline } from "@/lib/city/polyline";
import type { Point2 } from "@/lib/city/polyline";
import {
  BURIED_M,
  BedIndex,
  RAIL_BED_HALF_M,
  TRACK_PITCH_M,
} from "@/lib/city/track-beds";
import type { Bed } from "@/lib/city/track-beds";
import { finished } from "@/lib/city/build-steps";
import type { Steps } from "@/lib/city/build-steps";
import { buildDeckTable } from "./bridge-deck";
import { addSpanDeck, buildBridges, spanRuns } from "./bridge-layer";
import type { BridgeContext } from "./bridge-layer";
import { deckMaterial, stoneMaterial } from "./bridge-surface";
import { addCatenary, catenaryParts, catenaryWires } from "./catenary-layer";
import type { CatenaryRun } from "./catenary-layer";
import {
  addFootprint,
  addRibbon,
  COLORS,
  mesh3,
  meshFrom,
  meshSteps,
  outward,
  pushTri,
  quad,
  ringWinding,
  tangentsXZ,
} from "./mesh-kit";
import type { Mesh3, Pt } from "./mesh-kit";
import { addMonorail } from "./monorail-beam";
import {
  addSleepers,
  SLEEPER_TOP,
  sleeperMesh,
  sleeperRibbons,
} from "./track-bed";
import type { SleeperRibbons } from "./track-bed";

/**
 * Railway + bridge layer. The railway corridor and bridges used to exist only as
 * a flat land-cover colour painted on the DGM (a brown smear; bridges sank into
 * the Elbe). This builds stylized geometry from the baked GeoJSONs
 * (pipeline/bake/rail.py), redesigned after the first pass z-fought into ragged
 * edges and stacked into "2-story" bridges:
 *
 *  - Ballast yards: ONE merged surface from the DISSOLVED Basis-DLM ver03_f area
 *    polygons (no per-line overlap → no z-fight). The recoloured class-5 splat
 *    sits underneath, so any sub-pixel gap reads as ballast, not a seam.
 *  - Rails: OSM's every track one by one, and the Basis-DLM ver03_l
 *    centrelines (heavy rail) OSM has none beside, built per fine terrain
 *    tile on the cross-tile heightAt (every loaded terrain) and split at NoData
 *    gaps, so tracks follow the ground across tile seams; their heads 0.17 m
 *    over the level their line runs on (the DGM holds the ballast's surface;
 *    on a rail deck the ballast runs on across it), flush in the paving; the
 *    sleepers under them (track-bed.ts); a buried stretch (cut under a lid)
 *    not drawn.
 *  - Bridges: built here first (bridge-layer.ts, its lift table bridge-deck.ts).
 *    Rails ride the deck directly (no ballast stacked on top).
 *  - Platforms: OSM railway=platform polygons (ODbL), on the level of the
 *    track beside them (lib/city/platform-level.ts).
 *  - Catenary: over the contact lines, masts and portals with their wires
 *    (catenary-layer.ts, lib/city/catenary.ts).
 *  - Monorails: the beam on its supports (monorail-beam.ts); a funicular is
 *    a track like any, on its steep profile.
 *
 * All geometry is hand-wound to match its supplied normal (mesh-kit.ts `pushTri`), so every
 * material is FrontSide. Authored in Y-up world coords → added to `scene`.
 * The materials are plain lit node materials, one per colour/finish for the
 * whole scene (`sceneMaterial`): they carry no per-tile data, and the
 * scene's fog node reaches them like every other material.
 * Non-fatal: missing/empty inputs yield an empty group.
 */

/** Outer rings of a Polygon or MultiPolygon geometry (holes are ignored). */
function outerRings(
  geometry: AreaFeature["geometry"] | null | undefined
): [number, number][][] {
  if (geometry?.type === "Polygon") {
    const outer = geometry.coordinates[0];
    return outer ? [outer] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates
      .map((poly) => poly[0])
      .filter((ring): ring is [number, number][] => ring !== undefined);
  }
  return [];
}

/** What the rail layer draws against: the bridges' (a deck's owner). */
export type RailContext = BridgeContext;

/** The whole block's baked features, every tile's lists merged. */
export interface RailFeatures {
  /** dissolved ballast areas (Basis-DLM ver03_f) */
  ballast: AreaFeature[];
  /** bridge decks (Basis-DLM ver06_f) */
  bridges: BridgeFeature[];
  /** OSM platforms (ODbL) */
  platforms: AreaFeature[];
  /** railway-track centrelines (Basis-DLM ver03_l) */
  rails: RailFeature[];
}

const SAMPLE_M = LEVEL_STEP.rail; // densify polylines to this spacing (m)
// The DGM already holds the ballast's surface: the ground at a track and
// 5 m beside it differ by nothing. Drawn 0.18 m over it with the rail head
// 0.16 m above that, the heads stood 0.17 m too high; 0.08 m over a deck's
// measured top, 0.09 m too low.
const BALLAST_RAISE = 0.03; // ballast surface above the DGM: off the ground's own (m)
const BALLAST_DROP = 0.45; // ballast shoulder depth at the edge (m)
const RAIL_RAISE = 0.17; // rail head above the ballast's surface, a rail deck's top too (m)
const RAIL_PAVED_RAISE = 0.02; // rail head above the paving it is set in (m)
const BED_HALF_M = RAIL_BED_HALF_M; // half a one-track ballast bed (m)
const RAIL_WEB = 0.11; // rail vertical web depth so it reads obliquely (m)
const GAUGE = 1.435; // standard-gauge rail spacing (m)
const TRACK_PITCH = TRACK_PITCH_M; // spacing between parallel track centres (m)
const RAIL_HALF = 0.075; // half-width of a drawn rail (m)

/** A single rail: a thin top ribbon + two vertical webs along a run of points. */
export function addRail(acc: Mesh3, pts: Pt[], lateral: number): void {
  addRibbon(acc, pts, lateral, RAIL_HALF, RAIL_WEB);
}

/** The value nearest `target` (the first of equals); null for none. */
function closestTo(values: readonly number[], target: number): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (best === null || Math.abs(v - target) < Math.abs(best - target)) {
      best = v;
    }
  }
  return best;
}

/** A draped area's triangle is split while the ground under it strays
 *  from its plane by more than DRAPE_TOLERANCE_M (m), down to DRAPE_M:
 *  the ground under a yard is not flat between its outline's corners. The
 *  tolerance is coarse on purpose — the class raster paints the yard on
 *  the ground under it anyway — so a tile's yards stay ~5·10⁴ triangles. */
const DRAPE_M = 6;
const DRAPE_TOLERANCE_M = 1;
/** How finely an area is draped: its triangles split down to `step` (m)
 *  while the surface strays from them by more than `tolerance` (m). */
interface Drape {
  step: number;
  tolerance: number;
  /** where the surface is smooth enough for `fine` instead (world x, z) */
  fineAt?: (x: number, z: number) => boolean;
  fine?: { step: number; tolerance: number };
}
const GROUND_DRAPE: Drape = { step: DRAPE_M, tolerance: DRAPE_TOLERANCE_M };
/** On the beds the surface is the tracks' profiles — smooth, its only
 *  creases where two beds meet: draped to the centimetres the sleepers
 *  stand over it. */
const BED_DRAPE = { step: 1, tolerance: 0.02 };
/** A triangle longer than this (m) is split whatever its probes say: four
 *  probes can miss a passage under a deck. */
const DRAPE_PROBE_M = 48;

/** Draped triangles per step (build-steps.ts). */
const DRAPE_RUN = 512;

interface XZ {
  x: number;
  z: number;
}

/** A ring's points, its edges split to at most `step` apart. */
function densified(pts: readonly XZ[], step: number): XZ[] {
  const out: XZ[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k += 1) {
      out.push({
        x: a.x + ((b.x - a.x) * k) / n,
        z: a.z + ((b.z - a.z) * k) / n,
      });
    }
  }
  return out;
}

/**
 * An area draped on the ground (+ `raise`): its outline and holes
 * triangulated, each triangle split in four while the ground under it
 * strays from its plane (`DRAPE_TOLERANCE_M`, down to `DRAPE_M`), each
 * corner on the ground under it — then a fascia `drop` deep along the
 * outline, its top on the ground every DRAPE_M. Triangles whose middle
 * `skip`s (a rail deck: the tracks ride it, no ballast under them) are
 * left out, and so is their fascia. (Draped at the outline's corners
 * alone, a yard across an underpass spanned the passage with sloped
 * sheets from the embankment down to the street — the passage read as
 * closed.)
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
function* addDrapedArea(
  acc: Mesh3,
  rings: Ring2[],
  raise: number,
  drop: number,
  ctx: RailContext,
  skip: (x: number, z: number) => boolean,
  how: Drape = GROUND_DRAPE
): Steps<void> {
  const [outer, ...holes] = rings.map((r) => r.pts);
  if (!outer || outer.length < 3) {
    return;
  }
  const heights = new Map<number, number | null>();
  const yAt = (x: number, z: number): number | null => {
    // a 1/64 m lattice: shared corners and midpoints are sampled once
    const key = Math.round(x * 64) * 2 ** 26 + Math.round(z * 64) + 2 ** 25;
    let y = heights.get(key);
    if (y === undefined) {
      const e = worldToEpsg(x, z, ctx.offset);
      const g = ctx.heightAt(e.x, e.y);
      y = g === null ? null : g + raise;
      heights.set(key, y);
    }
    return y;
  };
  const mid = (p: XZ, q: XZ): XZ => ({
    x: (p.x + q.x) / 2,
    z: (p.z + q.z) / 2,
  });
  const centre = (a: XZ, b: XZ, c: XZ): XZ => ({
    x: (a.x + b.x + c.x) / 3,
    z: (a.z + b.z + c.z) / 3,
  });
  const limits = (a: XZ, b: XZ, c: XZ) => {
    const m = centre(a, b, c);
    return how.fine && how.fineAt?.(m.x, m.z) ? how.fine : how;
  };
  const flat = (a: XZ, b: XZ, c: XZ, tolerance: number): boolean => {
    const ya = yAt(a.x, a.z);
    const yb = yAt(b.x, b.z);
    const yc = yAt(c.x, c.z);
    if (ya === null || yb === null || yc === null) {
      return true;
    }
    // the plane through the corners against the ground at the edge
    // midpoints and the centre
    const probes: [XZ, number][] = [
      [mid(a, b), (ya + yb) / 2],
      [mid(b, c), (yb + yc) / 2],
      [mid(c, a), (yc + ya) / 2],
      [centre(a, b, c), (ya + yb + yc) / 3],
    ];
    return probes.every(([p, plane]) => {
      const y = yAt(p.x, p.z);
      return y === null || Math.abs(y - plane) <= tolerance;
    });
  };
  const emit = (a: XZ, b: XZ, c: XZ) => {
    if (skip((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) {
      return;
    }
    const ya = yAt(a.x, a.z);
    const yb = yAt(b.x, b.z);
    const yc = yAt(c.x, c.z);
    if (ya !== null && yb !== null && yc !== null) {
      pushTri(acc, a.x, ya, a.z, b.x, yb, b.z, c.x, yc, c.z, 0, 1, 0);
    }
  };
  // each triangle split into four until it is short or flat enough —
  // depth first, as a recursion would, on a stack of its own so that the
  // drape can pause between triangles (a 1 m drape over a yard is a
  // hundred thousand of them)
  const stack: XZ[] = [];
  function* drape(a0: XZ, b0: XZ, c0: XZ): Steps<void> {
    stack.push(a0, b0, c0);
    let n = 0;
    while (stack.length > 0) {
      const c = stack.pop();
      const b = stack.pop();
      const a = stack.pop();
      if (!(a && b && c)) {
        break;
      }
      n += 1;
      if (n % DRAPE_RUN === 0) {
        yield;
      }
      const longest = Math.max(
        Math.hypot(b.x - a.x, b.z - a.z),
        Math.hypot(c.x - b.x, c.z - b.z),
        Math.hypot(a.x - c.x, a.z - c.z)
      );
      const { step, tolerance } = limits(a, b, c);
      if (
        longest <= step ||
        (longest <= DRAPE_PROBE_M && flat(a, b, c, tolerance))
      ) {
        emit(a, b, c);
        continue;
      }
      const ab = mid(a, b);
      const bc = mid(b, c);
      const ca = mid(c, a);
      // last in, first out: the first of the four goes on last
      stack.push(ab, bc, ca, ca, bc, c, ab, b, bc, a, ab, ca);
    }
  }
  const all = [outer, ...holes].flat();
  const tris = ShapeUtils.triangulateShape(
    outer.map((p) => new Vector2(p.x, p.z)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.z)))
  );
  for (const [ia, ib, ic] of tris) {
    yield* drape(all[ia], all[ib], all[ic]);
  }
  // the fascia along the outline and round the holes, facing out of the
  // area, its top on the ground every DRAPE_M
  for (const [k, raw] of [outer, ...holes].entries()) {
    const ring = densified(raw, Math.min((how.fine ?? how).step * 4, DRAPE_M));
    const winding = (ringWinding(ring) * (k === 0 ? 1 : -1)) as 1 | -1;
    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      const yp = yAt(p.x, p.z);
      const yq = yAt(q.x, q.z);
      if (
        yp === null ||
        yq === null ||
        skip((p.x + q.x) / 2, (p.z + q.z) / 2)
      ) {
        continue;
      }
      const [nx, nz] = outward(ring, i, winding);
      quad(
        acc,
        [p.x, yp, p.z],
        [q.x, yq, q.z],
        [q.x, yq - drop, q.z],
        [p.x, yp - drop, p.z],
        [nx, 0, nz]
      );
    }
  }
}

/** Every polygon of an area as its rings (outer first, then its holes). */
function polygonsOf(
  geometry: AreaFeature["geometry"] | null | undefined
): [number, number][][][] {
  if (geometry?.type === "Polygon") {
    return geometry.coordinates.length > 0 ? [geometry.coordinates] : [];
  }
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.filter((poly) => poly.length > 0);
  }
  return [];
}

/**
 * One merged ballast surface from the dissolved railway-area polygons
 * (Polygon or MultiPolygon — a yard dissolved into several parts), draped
 * (`addDrapedArea`) on the beds its tracks lie on (`beds`: their profile,
 * lib/city/track-beds.ts — the ground the bake laid under them) or, off
 * every bed and without them, on the ground; left out on the rail decks,
 * where the tracks ride the deck, and where `buried` (a track the line
 * levels cut under a lid: its bed is not on the lid's top). Exported for
 * tests.
 */
export function buildBallast(
  features: AreaFeature[],
  ctx: RailContext,
  decks: DeckPoly[] = [],
  buried: (x: number, z: number) => boolean = () => false,
  beds?: BedIndex
): Mesh | null {
  return finished(ballastSteps(features, ctx, decks, buried, beds));
}

function* ballastSteps(
  features: AreaFeature[],
  ctx: RailContext,
  decks: DeckPoly[],
  buried: (x: number, z: number) => boolean,
  beds?: BedIndex
): Steps<Mesh | null> {
  const acc = mesh3();
  const skip = (x: number, z: number) =>
    decksAt(decks, x, z, RIDES.rail, "decks").length > 0 || buried(x, z);
  const surface = beds
    ? {
        ...ctx,
        heightAt: (x: number, y: number) =>
          beds.levelAt(x, y) ?? ctx.heightAt(x, y),
      }
    : ctx;
  // on the beds finely, off them as the ground
  const drape: Drape = beds
    ? {
        ...GROUND_DRAPE,
        fine: BED_DRAPE,
        fineAt: (x, z) => {
          const e = worldToEpsg(x, z, ctx.offset);
          return beds.levelAt(e.x, e.y) !== null;
        },
      }
    : GROUND_DRAPE;
  for (const f of features) {
    for (const rings of polygonsOf(f.geometry)) {
      yield* addDrapedArea(
        acc,
        rings.map((r) => ringToWorld(r, ctx.offset)),
        BALLAST_RAISE,
        BALLAST_DROP,
        surface,
        skip,
        drape
      );
    }
  }
  return yield* meshSteps(acc, COLORS.ballast, {
    cast: false,
    offsetUnits: -2,
    roughness: 1,
  });
}

/** A line on the ground rides an approach ramp up to its deck while the
 *  ramp stays this close above the ground (m) — not one passing over it,
 *  far above (a track under a deck's end). */
const APPROACH_RIDE_M = 1.5;

/** Whether a line's baked profile fits its `n` samples: the layer then
 *  draws it on the profile (`lineLevelsAt`) and its ballast on its bed. */
export function isProfiled(
  baked: { lz?: (number | null)[] },
  n: number
): boolean {
  return baked.lz?.length === n;
}

/**
 * The level of every sample of a line (lib/city/levels.ts). Where the
 * build step baked the line (scripts/line-levels.ts), its runs off the
 * ground (`lv`) give each sample's mode and its profile (`lz`,
 * lib/city/line-profile.ts) the height: the track lies on its grade and
 * vertical curves, the ground was laid under it (lib/city/track-beds.ts).
 * Else the line is solved over this piece alone (with what its source
 * says: `prefer`, `below`, `steep`), on the ground sample by sample, riding an
 * approach ramp close above it; on a deck it rides the deck top nearest
 * the run's line. Null where the ground is unknown and no level holds it
 * (the line breaks there).
 */
export function lineLevelsAt(
  pts: readonly Point2[],
  line: LevelLine,
  baked: { lv?: LevelRun[]; lz?: (number | null)[] } | undefined,
  ctx: GroundContext,
  decks: DeckPoly[],
  prefer?: "deck" | "ground",
  below?: boolean,
  steep = false
): (Level | null)[] {
  if (baked && isProfiled(baked, pts.length)) {
    return profiledLevels(pts, baked.lv ?? [], decodeProfile(baked.lz ?? []));
  }
  const runs = baked?.lv;
  const d: number[] = [];
  const ground: (number | null)[] = [];
  const under: number[][] = [];
  const ramps: number[][] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const [ex, ey] = pts[i];
    d.push(
      i === 0
        ? 0
        : d[i - 1] + Math.hypot(ex - pts[i - 1][0], ey - pts[i - 1][1])
    );
    ground.push(ctx.heightAt(ex, ey));
    const w = epsgToWorld(ex, ey, ctx.offset);
    under.push(decksAt(decks, w.x, w.z, RIDES[line], "decks", DECK_REACH_M));
    ramps.push(decksAt(decks, w.x, w.z, RIDES[line], "ramps"));
  }
  const solved = runs
    ? pts.map((_, i) => runLevelAt(runs, d, i))
    : lineLevels(
        pts.map((_, i) => ({
          d: d[i],
          ground: ground[i],
          decks: under[i],
          below,
        })),
        { grade: lineGrade(line, steep), prefer }
      ).map((l) => (l?.mode === "ground" ? null : l));
  return solved.map((level, i) => {
    if (level?.mode === "deck") {
      const near = closestTo(under[i], level.y);
      return { mode: "deck", y: near ?? level.y };
    }
    if (level) {
      return level;
    }
    const g = ground[i];
    if (g === null) {
      return null;
    }
    const ramp = ramps[i].find((y) => y - g < APPROACH_RIDE_M);
    return ramp === undefined
      ? { mode: "ground", y: g }
      : { mode: "deck", y: Math.max(ramp, g) };
  });
}

/** The levels of a baked line: each sample's mode from its run (the
 *  ground outside every run), its height the profile's. */
function profiledLevels(
  pts: readonly Point2[],
  runs: readonly LevelRun[],
  profile: readonly (number | null)[]
): (Level | null)[] {
  const d: number[] = [];
  for (let i = 0; i < pts.length; i += 1) {
    const [ex, ey] = pts[i];
    d.push(
      i === 0
        ? 0
        : d[i - 1] + Math.hypot(ex - pts[i - 1][0], ey - pts[i - 1][1])
    );
  }
  return profile.map((y, i) =>
    y === null ? null : { mode: runLevelAt(runs, d, i)?.mode ?? "ground", y }
  );
}

/** A span's deck reaches this far past its outermost track (m). */
const SPAN_SHOULDER_M = 0.9;

/** A rail line as the layer draws it, its levels solved once for the
 *  rails, the sleepers, the ballast's gaps, the platforms and the
 *  catenary. */
interface DrawnLine {
  /** distance along the line per sample (m) */
  d: number[];
  /** the samples (EPSG) */
  dense: Point2[];
  /** the gauge (m) */
  gauge: number;
  /** each sample's level; null where the line breaks or is buried */
  levels: (Level | null)[];
  /** the mapped catenary masts ([station, offset to the right], m: the
   *  scene's lateral, see `mastsAcross`) */
  masts: readonly (readonly [number, number])[];
  /** a contact line over it (`electrified` 1) */
  overhead: boolean;
  /** set in the paving: no ballast, no sleepers, the rail head flush */
  paved: boolean;
  /** its heights are the baked profile (`lz`): its ballast lies on it */
  profiled: boolean;
  /** the samples where the line runs buried (world x, z) */
  buried: XZ[];
  tracks: number;
  /** the samples in the world frame (y unset) */
  world: XZ[];
}

/** The file's mast offsets lie to the map's left of the line
 *  (rail_osm.py `masts`); a lateral here is along (−tz, tx), the map's
 *  right, the scene's z being −north. */
function mastsAcross(
  m: readonly (readonly [number, number])[]
): (readonly [number, number])[] {
  return m.map(([s, o]) => [s, -o] as const);
}

/** Each track's lateral from its line's centre (m, along (−tz, tx)). */
function trackOffsets(tracks: number): number[] {
  return Array.from(
    { length: tracks },
    (_, k) => (k - (tracks - 1) / 2) * TRACK_PITCH
  );
}

/** The rail head over the level a track runs on (m): the DGM holds the
 *  ballast's surface, and a rail deck's measured top the ballast run on
 *  across it; a track set in the paving shows its head flush with it. */
function railRaise(paved: boolean): number {
  return paved ? RAIL_PAVED_RAISE : RAIL_RAISE;
}

/**
 * The samples of the cuts the build opens as passages under a deck (their
 * share under a drawn deck at least PASSAGE_UNDER_DECK, as
 * scripts/line-levels.ts `sitePassages` decides): the track shows through
 * them. Any other cut deeper than BURIED_M runs under a lid — under a deck
 * too, where only a stretch of a longer cut passes (a tunnel's portal
 * under a station's bridges).
 */
function openedCuts(
  levels: readonly (Level | null)[],
  dense: readonly Point2[],
  ctx: RailContext,
  decks: DeckPoly[]
): boolean[] {
  const opened = levels.map(() => false);
  for (const [a, b] of modeRuns(levels, "cut")) {
    let covered = 0;
    for (let i = a; i <= b; i += 1) {
      const w = epsgToWorld(dense[i][0], dense[i][1], ctx.offset);
      if (decksAt(decks, w.x, w.z, undefined, "all", DECK_REACH_M).length) {
        covered += 1;
      }
    }
    if (covered >= PASSAGE_UNDER_DECK * (b - a + 1)) {
      opened.fill(true, a, b + 1);
    }
  }
  return opened;
}

/** Every line's samples and levels; a buried sample's level is null. */
function* drawnLines(
  features: RailFeature[],
  ctx: RailContext,
  decks: DeckPoly[]
): Steps<DrawnLine[]> {
  const out: DrawnLine[] = [];
  for (const f of features) {
    // a monorail's beam is no track (`monorails`)
    if (f.geometry?.type !== "LineString" || isMonorail(f)) {
      continue;
    }
    const p = f.properties ?? {};
    const dense = subdividePolyline(f.geometry.coordinates, SAMPLE_M);
    const levels = lineLevelsAt(
      dense,
      "rail",
      p,
      ctx,
      decks,
      railPrefer(f),
      (p.layer ?? 0) < 0,
      railSteep(f)
    );
    const d: number[] = [];
    const world: XZ[] = [];
    const buried: XZ[] = [];
    const opened = openedCuts(levels, dense, ctx, decks);
    for (let i = 0; i < dense.length; i += 1) {
      const [ex, ey] = dense[i];
      d.push(
        i === 0
          ? 0
          : d[i - 1] + Math.hypot(ex - dense[i - 1][0], ey - dense[i - 1][1])
      );
      const w = epsgToWorld(ex, ey, ctx.offset);
      world.push({ x: w.x, z: w.z });
      const level = levels[i];
      const g = ctx.heightAt(ex, ey);
      if (
        level?.mode === "cut" &&
        !opened[i] &&
        g !== null &&
        g - level.y > BURIED_M
      ) {
        buried.push(world[i]);
        levels[i] = null;
      }
    }
    out.push({
      d,
      dense,
      gauge: p.g ?? GAUGE,
      levels,
      masts: mastsAcross(p.m ?? []),
      overhead: p.electrified === 1,
      paved: p.paved === 1,
      profiled: isProfiled(p, dense.length),
      buried,
      tracks: Math.min(Math.max(p.tracks ?? 1, 1), 3),
      world,
    });
    yield;
  }
  return out;
}

/** How far past its bed's edge a yard's ballast takes the bed's level
 *  (m): half the gap pipeline/bake/rail.py closes between two beds
 *  (YARD_GAP_M). */
const BED_MARGIN_M = 2;

/**
 * The beds the baked lines lie on (lib/city/track-beds.ts): each stretch
 * on the ground at its profile, as the terrain bake laid the ground under
 * it. Undefined when no line is baked (the ballast drapes the ground).
 */
function ballastBeds(lines: readonly DrawnLine[]): BedIndex | undefined {
  const beds: Bed[] = [];
  for (const l of lines) {
    if (!l.profiled || l.paved) {
      continue;
    }
    const shape = {
      half: RAIL_BED_HALF_M + ((l.tracks - 1) * TRACK_PITCH) / 2,
      drop: 0,
    };
    let run: { coords: Point2[]; z: number[] } = { coords: [], z: [] };
    const flush = () => {
      if (run.coords.length >= 2) {
        beds.push({ ...run, ...shape });
      }
      run = { coords: [], z: [] };
    };
    for (let i = 0; i < l.levels.length; i += 1) {
      const level = l.levels[i];
      if (level?.mode !== "ground") {
        flush();
        continue;
      }
      run.coords.push(l.dense[i]);
      run.z.push(level.y);
    }
    flush();
  }
  if (beds.length === 0) {
    return undefined;
  }
  return new BedIndex(beds, BED_MARGIN_M);
}

/** Whether a point lies on the bed of a buried stretch (the bed's half
 *  width and a little more). */
function buriedTest(
  lines: readonly DrawnLine[]
): (x: number, z: number) => boolean {
  const pts: { half: number; x: number; z: number }[] = [];
  for (const l of lines) {
    const half = BED_HALF_M + ((l.tracks - 1) * TRACK_PITCH) / 2;
    for (const p of l.buried) {
      pts.push({ half, x: p.x, z: p.z });
    }
  }
  if (pts.length === 0) {
    return () => false;
  }
  const cell = 16;
  const grid = new Map<string, typeof pts>();
  for (const p of pts) {
    const k = `${Math.floor(p.x / cell)}:${Math.floor(p.z / cell)}`;
    const list = grid.get(k);
    if (list) {
      list.push(p);
    } else {
      grid.set(k, [p]);
    }
  }
  return (x, z) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const p of grid.get(`${cx + dx}:${cz + dz}`) ?? []) {
          // a sample every 4 m: within its half-step along, the bed across
          if (
            Math.hypot(p.x - x, p.z - z) <= Math.hypot(p.half, SAMPLE_M / 2)
          ) {
            return true;
          }
        }
      }
    }
    return false;
  };
}

/** The runs of consecutive indices where `has` holds: [first, last]. */
function runsWhere(n: number, has: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let first = -1;
  for (let i = 0; i <= n; i += 1) {
    if (i < n && has(i)) {
      if (first < 0) {
        first = i;
      }
    } else if (first >= 0) {
      if (i - 1 > first) {
        out.push([first, i - 1]);
      }
      first = -1;
    }
  }
  return out;
}

/** A rail deck the sleepers lie open on (a truss: no ballast bed). */
function openDecks(features: BridgeFeature[], ctx: RailContext): DeckPoly[] {
  return bridgeDecks(
    features.filter(
      (f) =>
        f.properties?.kind === "rail" &&
        (f.properties.structure ?? "").includes("truss")
    ),
    ctx.offset
  );
}

/** What the rails are built into. */
interface RailMeshes {
  catenary: CatenaryRun[];
  rail: Mesh3;
  sleepers: SleeperRibbons;
  spans: { stone: Mesh3; top: Mesh3 };
  /** every drawn sample, for the platforms beside the tracks */
  tracks: TrackSample[];
}

/** One line's rails, sleepers, span decks, platform samples and catenary
 *  runs into `out`. */
function addLine(
  out: RailMeshes,
  line: DrawnLine,
  ctx: RailContext,
  decks: { all: DeckPoly[]; open: DeckPoly[] }
): void {
  const { open } = decks;
  const raise = railRaise(line.paved);
  const head = line.levels.map((level, i): Pt | null =>
    level
      ? { x: line.world[i].x, y: level.y + raise, z: line.world[i].z }
      : null
  );
  const offsets = trackOffsets(line.tracks);
  for (const [a, b] of runsWhere(head.length, (i) => head[i] !== null)) {
    const run = head.slice(a, b + 1) as Pt[];
    const d = line.d.slice(a, b + 1);
    const opens = run.map(
      (p, k) =>
        line.levels[a + k]?.mode === "deck" &&
        decksAt(open, p.x, p.z, undefined, "decks").length > 0
    );
    const bed = run.map((p) => ({ ...p, y: p.y - raise + SLEEPER_TOP }));
    for (const lateral of offsets) {
      addRail(out.rail, run, lateral + line.gauge / 2);
      addRail(out.rail, run, lateral - line.gauge / 2);
      if (!line.paved) {
        addSleepers(out.sleepers, bed, d, lateral, opens);
      }
    }
    if (line.overhead) {
      out.catenary.push(...catenaryRuns(line, [a, b], run, offsets, decks.all));
    }
  }
  for (let i = 0; i < line.levels.length; i += 1) {
    const level = line.levels[i];
    if (level) {
      out.tracks.push({
        raised: level.mode === "deck" || level.mode === "span",
        x: line.world[i].x,
        y: level.y,
        z: line.world[i].z,
      });
    }
  }
  const half =
    ((line.tracks - 1) / 2) * TRACK_PITCH + line.gauge / 2 + SPAN_SHOULDER_M;
  for (const span of spanRuns(line.levels, head)) {
    // a line near a seam is in both tiles' files: the span's owner
    // draws its deck
    const pts = span.filter((p): p is Pt => p !== null);
    const centre = pts[Math.floor(pts.length / 2)];
    const e = centre ? worldToEpsg(centre.x, centre.z, ctx.offset) : null;
    if (e && (!ctx.owns || ctx.owns(e.x, e.y))) {
      addSpanDeck(
        out.spans.top,
        out.spans.stone,
        pts.map((p) => ({ ...p, y: p.y - raise + BALLAST_RAISE })),
        half,
        ctx
      );
    }
  }
}

/** The catenary runs of one stretch [a, b] of a line, one per track: the
 *  rail heads offset to each track, the structure a mast there stands on,
 *  the soffit of a bridge over it (a deck OVERPASS_M over the rail head,
 *  OVERPASS_DEPTH_M deep), the mapped masts on the track nearest each. */
function catenaryRuns(
  line: DrawnLine,
  [a, b]: [number, number],
  run: Pt[],
  offsets: number[],
  decks: DeckPoly[]
): CatenaryRun[] {
  const tan = tangentsXZ(run);
  const deck = line.levels
    .slice(a, b + 1)
    .map((l) => (l && l.mode !== "ground" && l.mode !== "cut" ? l.y : null));
  const over = run.map((p) => {
    const tops = decksAt(decks, p.x, p.z, undefined, "decks").filter(
      (y) => y > p.y + OVERPASS_M
    );
    return tops.length > 0 ? Math.min(...tops) - OVERPASS_DEPTH_M : null;
  });
  const d = line.d.slice(a, b + 1);
  return offsets.map((lateral) => ({
    d,
    deck,
    over,
    mapped: line.masts
      .filter(([, o]) => closestTo(offsets, o) === lateral)
      .map(([s, o]) => [s, o - lateral] as const),
    pts: run.map((p, i) => ({
      x: p.x - tan[i].y * lateral,
      y: p.y,
      z: p.z + tan[i].x * lateral,
    })),
  }));
}

/** Steel rails: one pair per track, on the level their line runs on
 *  (`lineLevelsAt`): the ground, a rail deck, a span (with its deck);
 *  the sleepers under them; the catenary over the contact lines.
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
function* buildRails(
  lines: readonly DrawnLine[],
  ctx: RailContext,
  decks: { all: DeckPoly[]; open: DeckPoly[] },
  out: RailMeshes
): Steps<Mesh[]> {
  for (const line of lines) {
    addLine(out, line, ctx, decks);
    yield;
  }
  const meshes: Mesh[] = [];
  const rails = yield* meshSteps(out.rail, COLORS.rail, {
    cast: false,
    offsetUnits: -1,
    roughness: 0.5,
  });
  if (rails) {
    meshes.push(rails);
  }
  const sleepers = sleeperMesh(out.sleepers);
  if (sleepers) {
    meshes.push(sleepers);
  }
  return meshes;
}

/** A few samples of the ground inside a ring (world), a grid of at most
 *  ~64 points. */
function groundInside(ring: Ring2, ctx: RailContext): number[] {
  let minX = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const p of ring.pts) {
    minX = Math.min(minX, p.x);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxZ = Math.max(maxZ, p.z);
  }
  const step = Math.max(2, Math.max(maxX - minX, maxZ - minZ) / 8);
  const out: number[] = [];
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      if (pointInRing(ring.pts, x, z)) {
        const e = worldToEpsg(x, z, ctx.offset);
        const g = ctx.heightAt(e.x, e.y);
        if (g !== null) {
          out.push(g);
        }
      }
    }
  }
  return out;
}

/** A platform's height above the rail top (m) and the trains it serves,
 *  from the bake (pipeline/bake/rail.py `platforms`). */
function platformOf(f: AreaFeature): { h?: number; kind?: string } {
  const h = f.properties?.h;
  const k = f.properties?.k;
  return {
    h: typeof h === "number" ? h : undefined,
    kind: typeof k === "string" ? k : undefined,
  };
}

/**
 * Station platforms on the level of the track beside them, their height
 * over its rail head (lib/city/platform-level.ts): slabs from the polygons,
 * a slim ribbon for a platform OSM maps as a line.
 */
function buildPlatforms(
  features: AreaFeature[],
  ctx: RailContext,
  index: TrackIndex
): Mesh | null {
  const acc = mesh3();
  for (const f of features) {
    const g = f.geometry;
    const kind = platformOf(f);
    if (g?.type === "Polygon" || g?.type === "MultiPolygon") {
      for (const outer of outerRings(g)) {
        const ring = ringToWorld(outer, ctx.offset);
        const placed = platformTops(
          {
            ...kind,
            ground: ring.pts.map((p) => {
              const e = worldToEpsg(p.x, p.z, ctx.offset);
              return ctx.heightAt(e.x, e.y);
            }),
            inside: groundInside(ring, ctx),
            ring: ring.pts,
          },
          index,
          RAIL_RAISE
        );
        if (placed) {
          addFootprint(acc, ring, placed.top, placed.depth);
        }
      }
    } else if (g?.type === "LineString") {
      const run: Pt[] = [];
      for (const [ex, ey] of subdividePolyline(g.coordinates, SAMPLE_M)) {
        const ground = ctx.heightAt(ex, ey);
        const w = epsgToWorld(ex, ey, ctx.offset);
        const placed =
          ground === null
            ? null
            : platformTops(
                { ...kind, ground: [ground], inside: [], ring: [w] },
                index,
                RAIL_RAISE
              );
        if (placed) {
          run.push({ x: w.x, y: placed.top[0], z: w.z });
        }
      }
      addRail(acc, run, 0); // a thin slab ribbon for line-mapped platforms
    }
  }
  const mesh = meshFrom(acc, COLORS.platform, { cast: true });
  if (mesh) {
    mesh.name = "rail-platforms";
  }
  return mesh;
}

/** The monorails' beams and supports (monorail-beam.ts), in painted
 *  steel; null where the tile has none.
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
function* monorailsMesh(
  features: readonly RailFeature[],
  ctx: RailContext
): Steps<Mesh | null> {
  const acc = mesh3();
  let any = false;
  for (const f of features) {
    any = addMonorail(acc, f, ctx) || any;
  }
  if (!any) {
    return null;
  }
  const mesh = yield* meshSteps(acc, COLORS.steel, { cast: true });
  if (mesh) {
    mesh.name = "rail-monorail";
  }
  return mesh;
}

/**
 * Builds the WHOLE tile block's rails, bridges, ballast and platforms (one
 * call, cross-tile heightAt) as stylized geometry on the Y-up scene. Bridges
 * build first so the rails can ride their decks; the rails' levels next,
 * so the ballast leaves out where a track runs buried and the platforms
 * stand on their track's level; the catenary over the contact lines and
 * the monorails' beams last.
 * Empty inputs yield an empty group; the group is freed with the scene
 * (disposeObject3D).
 */
export function buildRail(features: RailFeatures, ctx: RailContext): Group {
  return finished(railSteps(features, ctx));
}

/** `buildRail` in steps: per bridge, line and draped triangle run
 *  (build-steps.ts).
 * @yields {void} once per slice boundary, so the build can be spread over frames (build-steps.ts)
 */
export function* railSteps(
  features: RailFeatures,
  ctx: RailContext
): Steps<Group> {
  const group = new Group();
  group.name = "rail";

  const decks = buildDeckTable(features.bridges, ctx);
  yield;
  const bridgeMeshes = yield* buildBridges(features.bridges, ctx, decks);
  // what the inquiry probe raycasts for a bridge (bridge-ask.ts)
  for (const mesh of bridgeMeshes) {
    mesh.userData.bridge = true;
  }
  // add() with no arguments logs a three error, so guard the spread.
  if (bridgeMeshes.length > 0) {
    group.add(...bridgeMeshes);
  }
  const lines = yield* drawnLines(features.rails, ctx, decks);
  const out: RailMeshes = {
    catenary: [],
    rail: mesh3(),
    sleepers: sleeperRibbons(),
    spans: { top: mesh3(), stone: mesh3() },
    tracks: [],
  };
  const rails = yield* buildRails(
    lines,
    ctx,
    { all: decks, open: openDecks(features.bridges, ctx) },
    out
  );
  // the rails first (a test reads them as the group's first child when no
  // bridge is drawn), then the ballast under them
  if (rails.length > 0) {
    group.add(...rails);
  }
  const ballast = yield* ballastSteps(
    features.ballast,
    ctx,
    decks,
    buriedTest(lines),
    ballastBeds(lines)
  );
  if (ballast) {
    group.add(ballast);
  }
  const spanTop = yield* meshSteps(out.spans.top, COLORS.deckRail, {
    cast: true,
    material: deckMaterial("rail", COLORS.deckRail),
  });
  const spanStone = yield* meshSteps(out.spans.stone, COLORS.deckStone, {
    cast: true,
    material: stoneMaterial(COLORS.deckStone),
  });
  yield;
  const platforms = buildPlatforms(
    features.platforms,
    ctx,
    new TrackIndex(out.tracks)
  );
  yield;
  const catenary = catenaryParts(mesh3());
  addCatenary(catenary, out.catenary, ctx);
  const masts = yield* meshSteps(catenary.steel, COLORS.mast, {
    cast: true,
    roughness: 0.7,
  });
  if (masts) {
    masts.name = "rail-catenary-masts";
  }
  const monorails = yield* monorailsMesh(features.rails, ctx);
  for (const m of [
    spanTop,
    spanStone,
    platforms,
    masts,
    catenaryWires(catenary),
    monorails,
  ]) {
    if (m) {
      group.add(m);
    }
  }
  return group;
}
