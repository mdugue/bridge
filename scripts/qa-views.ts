/**
 * The committed QA views (plan 048 part B): one Snapshot per reference
 * view the GPU checklist (docs/plans/019-gpu-verification.md) and the open
 * device checks of the plans name, written to `qa/views/<name>.json`, and
 * `qa/views/README.md` — each view with what it checks and its link
 * (`/dresden?snap=…`, lib/city/snapshot.ts), to open on a GPU or a phone.
 * The shot harness (e2e/snapshot-shot.spec.ts) renders them as
 * `shots/qa-<name>.png`.
 *
 * The poses are written from the data, not captured on a GPU: a place in
 * EPSG:25833 (from sites/dresden.ts, the baked monuments, furniture, trees,
 * bridges and riverside, the LoD2 footprints), a height above the DGM1
 * ground there, and a heading and pitch — given, or aimed at a target. The
 * scene frame (`pos`) is the spawn tile's recentre offset, as every tile's.
 * When a GPU shows a view framed badly, find the better pose in the
 * running viewer (*Kopieren* gives its `epsg`, heading and pitch), put it
 * in the table below and write the files again; the name stays.
 *
 *   bun scripts/qa-views.ts            # write qa/views/
 *   bun scripts/qa-views.ts --check    # say which files differ, write none
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nodePath from "node:path";
import { MODEL_PRESETS } from "../lib/city/model-view";
import type { ModelPresetId } from "../lib/city/model-view";
import { EYE_HEIGHT, RAD2DEG } from "../lib/city/pose";
import { TILE_KM, tileIdOf } from "../lib/city/site";
import type { Site } from "../lib/city/site";
import { LOOK_DEFAULTS } from "../lib/city/look-controls";
import { decodeLook, encodeSnapshot, snapshotHref } from "../lib/city/snapshot";
import type {
  CameraStateJson,
  Snapshot,
  SnapshotLook,
} from "../lib/city/snapshot";
import { cityMeshSourceFiles, dgmSourceFiles } from "../lib/city/tile";
import type { CityJsonDocument } from "../lib/city/types";
import { siteById } from "../sites";
import { cityFrame } from "./city-lod2";
import type { Dgm } from "./bake-tiles";
import { readDgmFile } from "./dgm-cache";

/** Where the views and their index live. */
export const QA_VIEWS_DIR = nodePath.join(process.cwd(), "qa", "views");
export const QA_VIEWS_SITE = "dresden";

interface Xy {
  x: number;
  y: number;
}

/** A pose: a place, a height above the ground there, and where it looks. */
type Pose = {
  at: Xy;
  /** metres above the DGM1 ground at `at` (walk: eye height) */
  above: number;
  mode: "fly" | "walk";
  fov: number;
} & (
  | { headingDeg: number; pitchDeg: number }
  /** aimed at a point this high above its own ground */
  | { target: Xy; targetAbove: number }
);

interface QaView {
  name: string;
  /** the plans and checklist sections it serves */
  plans: string[];
  /** what to look at there (one or two sentences) */
  checks: string;
  /** the page query the check asks for, if any (`?safety=3`) */
  query?: string;
  pose: Pose;
  /** local time with its offset; the sun's instant */
  date: string;
  look?: SnapshotLook;
  /** Modell: the preset, its pivot (a place on the ground), scale, turn */
  model?: { preset: ModelPresetId; pivot: Xy; scale: number; turnDeg: number };
}

const walk = (at: Xy, headingDeg: number, pitchDeg = 2, fov = 62): Pose => ({
  at,
  above: EYE_HEIGHT,
  mode: "walk",
  fov,
  headingDeg,
  pitchDeg,
});
const walkAt = (at: Xy, target: Xy, targetAbove: number, fov = 62): Pose => ({
  at,
  above: EYE_HEIGHT,
  mode: "walk",
  fov,
  target,
  targetAbove,
});
const flyAt = (
  at: Xy,
  above: number,
  target: Xy,
  targetAbove = 0,
  fov = 55
): Pose => ({ at, above, mode: "fly", fov, target, targetAbove });
const fly = (
  at: Xy,
  above: number,
  headingDeg: number,
  pitchDeg: number,
  fov = 55
): Pose => ({ at, above, mode: "fly", fov, headingDeg, pitchDeg });

/** `distance` m back from `target` against `headingDeg` (the camera's spot). */
const behind = (target: Xy, headingDeg: number, distance: number): Xy => {
  const h = headingDeg / RAD2DEG;
  return {
    x: target.x - Math.sin(h) * distance,
    y: target.y - Math.cos(h) * distance,
  };
};

// Places, EPSG:25833 (sources in the comments).
/** sites/dresden.ts */
const FRAUENKIRCHE = { x: 411_795, y: 5_656_346 };
/** the riverside's landing stage below the Brühlsche Terrasse (its bank) */
const TERRACE_BANK = { x: 412_020, y: 5_656_536 };
/** an advertising column on Albertstraße, nine lamps and sixteen trees in 50 m */
const ALBERT_COLUMN = { x: 412_126.31, y: 5_657_490.53 };
/** the Artesischer Brunnen on the Albertplatz (the spawn tile's monuments) */
const ARTESIAN_FOUNTAIN = { x: 412_215.45, y: 5_657_674.65 };
/** the ferry line at the Terrassenufer (riverside, spawn tile) */
const FERRY = { x: 412_474.72, y: 5_656_694.91 };
/** the Albertbrücke's midspan (bridge axis, an arch) */
const ALBERTBRUECKE = { x: 412_716, y: 5_656_919 };
/** a group of cone crowns (cadastre archetype conifer, 15 m) */
const CONE_TREE = { x: 412_049.9, y: 5_657_486 };
/** a round crown (cadastre, 22 m, 13 m wide) */
const ROUND_TREE = { x: 412_002.4, y: 5_657_368.3 };
/** the Palais im Großen Garten (its LoD2 footprint ends at ≈ N 5 654 733) */
const PALAIS = { x: 413_262, y: 5_654_761 };
/** two football pitches at the Großer Garten's north-west corner (sport table) */
const PITCHES = { x: 412_229, y: 5_655_113 };
/** an allotment colony in Löbtau (cultivated, 33408_5654) */
const COLONY = { x: 408_366, y: 5_654_707 };
/** where four tiles meet (33410/33412 × 5656/5658) */
const CORNER = { x: 412_000, y: 5_658_000 };
/** Antonstraße crosses the tile seam at E 412 000 */
const SEAM_STREET = { x: 411_960, y: 5_657_749 };
const SEAM_STREET_AHEAD = { x: 412_037, y: 5_657_722 };
/** the Albertplatz's junction with the Antonstraße (crossings, kerbs) */
const ALBERTPLATZ_JUNCTION = { x: 412_187, y: 5_657_664 };
/** Modell's pivot: the Elbe below the Brühlsche Terrasse */
const TERRACE_RIVER = { x: 411_900, y: 5_656_650 };
const SPAWN_CENTRE = { x: 413_000, y: 5_657_000 };

/** sites/dresden.ts's start, "altstadt" */
const START: Pose = fly({ x: 412_200, y: 5_656_800 }, 40, 235, -1.5, 46);
/** sites/dresden.ts's "neumarkt" */
const NEUMARKT: Pose = walk({ x: 411_730, y: 5_656_240 }, 32, 10, 66);
/** sites/dresden.ts's "elbe-promenade" (Neustädter Elbufer) */
const ELBUFER: Pose = walk({ x: 412_420, y: 5_656_915 }, 243, 1);
/** sites/dresden.ts's "rooftops" */
const ROOFTOPS: Pose = fly({ x: 412_734, y: 5_657_637 }, 31, 347, -6, 62);
const OBLIQUE_400: Pose = flyAt(
  behind(FRAUENKIRCHE, 315, 693),
  400,
  FRAUENKIRCHE
);
const STREET_CROSSINGS: Pose = flyAt(
  behind(ALBERTPLATZ_JUNCTION, 30, 55),
  25,
  ALBERTPLATZ_JUNCTION
);
const LAMP_STREET: Pose = walkAt(
  { x: 412_131, y: 5_657_455 },
  ALBERT_COLUMN,
  2.5
);
const FOUNTAIN_SQUARE: Pose = flyAt(
  behind(ARTESIAN_FOUNTAIN, 30, 45),
  30,
  ARTESIAN_FOUNTAIN
);
const MODELL_RIVER = (preset: ModelPresetId, turnDeg: number) => ({
  preset,
  pivot: TERRACE_RIVER,
  scale: 2500,
  turnDeg,
});

const JULY = "2026-07-15";
const JANUARY = "2027-01-15";

/** The catalogue, grouped by the check that asked for each view first. */
export const QA_VIEWS: readonly QaView[] = [
  // Plan 019's reference views (its Setup table)
  {
    name: "shore-eye",
    plans: ["019 B", "019 K (031)", "070 step 4"],
    checks:
      "The Elbe bank below the Brühlsche Terrasse at eye level, late morning: the class colours at the shore, the water's soft edge, the landing stage.",
    pose: walk(TERRACE_BANK, 285),
    date: `${JULY}T11:00:00+02:00`,
  },
  {
    name: "meadow-eye",
    plans: ["019 B", "019 K (025)"],
    checks:
      "The Großer Garten's lawn towards the Palais at eye level, early evening: the meadow's tint and mottle, crowns and their shadows.",
    pose: walkAt({ x: 413_340, y: 5_654_620 }, PALAIS, 3),
    date: "2026-06-20T17:30:00+02:00",
  },
  {
    name: "seam-eye",
    plans: ["019 D", "019 K", "019 M", "071"],
    checks:
      "Antonstraße across the tile seam at E 412 000, at eye level with the sun behind: nothing steps, gaps or changes at the seam (ground, kerbs, markings, shadows); the neighbour's shadows from the shadow camera's coarse stream (64 px phone, 128 px desktop).",
    pose: walkAt(SEAM_STREET, SEAM_STREET_AHEAD, EYE_HEIGHT),
    date: `${JULY}T17:30:00+02:00`,
  },
  {
    name: "seam-fly",
    plans: ["019 D", "019 E", "019 M"],
    checks:
      "200 m above the four-tile corner (E 412 000 / N 5 658 000) at −35°: the far crown tier's switch, the coarse/fine hand-over at the corner, the shadow rings from the air, no seam between them.",
    pose: flyAt(behind(CORNER, 45, 286), 200, CORNER),
    date: `${JULY}T15:00:00+02:00`,
  },
  {
    name: "oblique-400",
    plans: ["019 D", "019 H"],
    checks:
      "400 m up, oblique over the Altstadt towards the Frauenkirche: LOD switches, the shadow frustum's reach, the horizon's shade past it; a frame-time and memory reading.",
    pose: OBLIQUE_400,
    date: `${JULY}T15:00:00+02:00`,
  },
  {
    name: "low-sun",
    plans: ["019 E"],
    checks:
      "The Neumarkt on 21 December at 09:00, the sun a few degrees up: long shadows without acne, peter-panning or a staircase.",
    pose: NEUMARKT,
    date: "2026-12-21T09:00:00+01:00",
  },
  {
    name: "roof-close",
    plans: ["019 C"],
    checks:
      "Neustadt roofs from about 30 m above them at 13:00: no quantisation steps, cracks or wobble in the roofs and facades.",
    pose: fly(ROOFTOPS.at, 50, 347, -30, 62),
    date: "2026-06-20T13:00:00+02:00",
  },
  {
    name: "night-street",
    plans: ["019 K (027)", "019 G"],
    checks:
      "Hauptstraße in the Neustadt at eye level, 21:00 in September: lamps, shop glow, the trees in lamp light (and in Film noir: `night-street-noir`).",
    pose: walk({ x: 411_930, y: 5_657_250 }, 34, 3),
    date: "2026-09-20T21:00:00+02:00",
  },
  {
    name: "night-street-noir",
    plans: ["019 G"],
    checks: "The night street in Film noir: ink and tone bands by lamp light.",
    pose: walk({ x: 411_930, y: 5_657_250 }, 34, 3),
    date: "2026-09-20T21:00:00+02:00",
    look: { style: "noir" },
  },
  // Plan 019 section M (the phone crash fixes)
  {
    name: "street-crossings",
    plans: ["019 M (FXAA)", "077 step 0"],
    checks:
      "The Albertplatz's junction with the Antonstraße from 25 m, afternoon sun: crossings, stop lines, kerbs and paving on the fine level; on a phone FXAA against the desktop's SMAA — softer is fine, crawling is not.",
    pose: STREET_CROSSINGS,
    date: "2026-08-20T16:00:00+02:00",
    look: { style: "pastel" },
  },
  {
    name: "street-crossings-comic",
    plans: ["019 M (FXAA)"],
    checks:
      "The same junction in Comic: the ink lines and roof edges under FXAA (phone) against SMAA (desktop).",
    pose: STREET_CROSSINGS,
    date: "2026-08-20T16:00:00+02:00",
    look: { style: "comic" },
  },
  {
    name: "ao-wall-foot",
    plans: ["019 M (AO in one byte)", "019 F"],
    checks:
      "The Palais im Großen Garten's south wall from its lawn at a low October sun: the contact shadow's gradient at the wall's foot shows no banding beyond one step; sky view and GTAO together read as soft light, not dirt.",
    pose: walkAt({ x: 413_262, y: 5_654_700 }, PALAIS, 4),
    date: "2026-10-15T16:30:00+02:00",
  },
  {
    name: "pitches-200",
    plans: ["019 M (coarse level)", "070 step 3"],
    checks:
      "200 m over the football pitches at the Großer Garten's north-west corner (on a phone): beyond the fine level the pitches show their land-cover class and gain their lines as the fine level arrives — no flash of a wrong colour.",
    pose: flyAt(behind(PITCHES, 30, 250), 200, PITCHES),
    date: "2026-06-20T14:00:00+02:00",
  },
  {
    name: "oblique-400-paper",
    plans: ["019 M (dropped CPU copies)"],
    checks:
      "`oblique-400` in Papier once a few tiles have loaded: no missing geometry, no WebGPU validation error (an empty vertex buffer).",
    pose: OBLIQUE_400,
    date: `${JULY}T15:00:00+02:00`,
    look: { style: "paper" },
  },
  {
    name: "oblique-400-line",
    plans: ["019 M (dropped CPU copies)", "019 N (Modell)"],
    checks: "`oblique-400` in Strich: as `oblique-400-paper`.",
    pose: OBLIQUE_400,
    date: `${JULY}T15:00:00+02:00`,
    look: { style: "line" },
  },
  {
    name: "oblique-400-figure",
    plans: ["019 M (dropped CPU copies)"],
    checks: "`oblique-400` in Schwarzplan: as `oblique-400-paper`.",
    pose: OBLIQUE_400,
    date: `${JULY}T15:00:00+02:00`,
    look: { style: "figure" },
  },
  // Plan 019 section N (left by plans closed on 2026-11-04)
  {
    name: "modell-iso-low",
    plans: ["019 N (Modell)"],
    checks:
      "Modell, Isometrie over the Elbe at the Brühlsche Terrasse, low October sun: the specular and halo terms, the water's glitter — none flat, blown or missing against `modell-fly-low`.",
    pose: fly(TERRACE_RIVER, 300, 45, -35),
    date: "2026-10-15T17:45:00+02:00",
    model: MODELL_RIVER("iso", 45),
  },
  {
    name: "modell-iso-high",
    plans: ["019 N (Modell)"],
    checks: "As `modell-iso-low` at a high June sun.",
    pose: fly(TERRACE_RIVER, 300, 45, -35),
    date: "2026-06-21T13:30:00+02:00",
    model: MODELL_RIVER("iso", 45),
  },
  {
    name: "modell-plan-low",
    plans: ["019 N (Modell)"],
    checks: "Modell, Lageplan over the same reach at the low sun.",
    pose: fly(TERRACE_RIVER, 300, 0, -60),
    date: "2026-10-15T17:45:00+02:00",
    model: MODELL_RIVER("plan", 0),
  },
  {
    name: "modell-plan-high",
    plans: ["019 N (Modell)"],
    checks: "Modell, Lageplan at the high sun.",
    pose: fly(TERRACE_RIVER, 300, 0, -60),
    date: "2026-06-21T13:30:00+02:00",
    model: MODELL_RIVER("plan", 0),
  },
  {
    name: "modell-iso-line",
    plans: ["019 N (Modell)"],
    checks: "Modell, Isometrie in Strich at the high sun: the washes.",
    pose: fly(TERRACE_RIVER, 300, 45, -35),
    date: "2026-06-21T13:30:00+02:00",
    look: { style: "line" },
    model: MODELL_RIVER("iso", 45),
  },
  {
    name: "modell-fly-low",
    plans: ["019 N (Modell)"],
    checks:
      "The Modell views' reference: the same reach in Fliegen at the low sun (the pose Modell leaves to).",
    pose: fly(TERRACE_RIVER, 300, 45, -35),
    date: "2026-10-15T17:45:00+02:00",
  },
  {
    name: "frozen-start",
    plans: ["019 N (073)"],
    checks:
      "The start view in the afternoon: the fixed look table against production.",
    pose: START,
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "neumarkt-dusk",
    plans: ["019 N (073)"],
    checks:
      "The Neumarkt at dusk: the clay's windows and facade reading, the glow, against production.",
    pose: NEUMARKT,
    date: "2026-10-15T18:45:00+02:00",
  },
  {
    name: "elbufer-evening",
    plans: ["019 N (073)", "070 step 4"],
    checks:
      "The Neustädter Elbufer at eye level in the June evening sun, the path along the meadow at a grazing angle: the ground detail and the meadow's edge — no blockier class boundary (070's half-resolution splat).",
    pose: ELBUFER,
    date: "2026-06-20T20:00:00+02:00",
  },
  // Plans 069–084
  {
    name: "night-boot",
    plans: ["069 step 2"],
    checks:
      "Open the link cold (cache disabled): the boot with a night view applied before it — `boot:light-to-veil`, `boot:first-shadow-frame` (none by night), the veil to loaded.",
    pose: START,
    date: `${JULY}T23:30:00+02:00`,
  },
  {
    name: "park-50",
    plans: ["070 step 4"],
    checks:
      "The Großer Garten from 50 m: the class boundaries of paths and lawns in the desktop's half-resolution fine splat.",
    pose: fly({ x: 413_050, y: 5_654_600 }, 50, 60, -20),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "coarse-300",
    plans: ["070 step 5"],
    query: "?safety=3",
    checks:
      "On a phone at `?safety=3` (the coarse level from ≈ 300 m): the Elbwiesen and the shore 300 m ahead in the 1024² coarse raster — acceptable, or keep 2048² for a phone's coarse level.",
    pose: fly({ x: 412_750, y: 5_657_250 }, 40, 225, -6, 62),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "rooftops",
    plans: ["071"],
    checks:
      'The "Über den Dächern" vantage: roof edges and facade lines at the desktop\'s 1.5× pixel ratio — acceptable aliasing.',
    pose: ROOFTOPS,
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "site-edge",
    plans: ["076"],
    checks:
      "250 m over the site's east edge looking out: the ground plate beyond the last tile, no hole; on a phone, `heldMB` and frame time on the way out.",
    pose: fly({ x: 417_700, y: 5_656_800 }, 250, 80, -30),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "across-400",
    plans: ["076", "077 step 0"],
    checks:
      "400 m up across the city to the west: the far buildings at LoD1, the coarse crowns from the start, the coarse level, the sky view and the horizon past the shadow frustum.",
    pose: fly({ x: 413_800, y: 5_657_300 }, 400, 250, -12),
    date: "2026-08-20T16:00:00+02:00",
  },
  {
    name: "sports-ground",
    plans: ["077 step 0"],
    checks:
      "The pitches at the Großer Garten's north-west corner from 60 m: their lines on a desktop's fine level.",
    pose: flyAt(behind(PITCHES, 30, 120), 60, PITCHES),
    date: "2026-08-20T16:00:00+02:00",
  },
  {
    name: "colony",
    plans: ["077 step 0"],
    checks: "An allotment colony in Löbtau from 50 m: the faint beds.",
    pose: flyAt(behind(COLONY, 45, 120), 50, COLONY),
    date: "2026-08-20T16:00:00+02:00",
  },
  {
    name: "elbwiesen",
    plans: ["077 step 0"],
    checks:
      "The Neustädter Elbwiesen from 40 m along the river: NDVI, the water, the class raster's shoreline.",
    pose: fly({ x: 412_300, y: 5_656_850 }, 40, 260, -12),
    date: "2026-08-20T16:00:00+02:00",
  },
  ...(
    [
      ["lamps-july-day", `${JULY}T14:00:00+02:00`],
      ["lamps-july-dusk", `${JULY}T21:40:00+02:00`],
      ["lamps-july-night", `${JULY}T23:30:00+02:00`],
      ["lamps-january-day", `${JANUARY}T13:00:00+01:00`],
      ["lamps-january-night", `${JANUARY}T20:00:00+01:00`],
    ] as const
  ).map(([name, date]): QaView => ({
    name,
    plans: ["078"],
    checks:
      "Albertstraße at eye level towards an advertising column, lamps and street trees: halos and pools on at dusk and after, off by day; the lit column; autumn and bare crowns and their thin winter shadow. Identical before and after plan 078.",
    pose: LAMP_STREET,
    date,
  })),
  ...(
    [
      ["fountain-july-day", `${JULY}T14:00:00+02:00`],
      ["fountain-july-night", `${JULY}T23:30:00+02:00`],
      ["fountain-january-day", `${JANUARY}T13:00:00+01:00`],
    ] as const
  ).map(([name, date]): QaView => ({
    name,
    plans: ["078"],
    checks:
      "The Artesischer Brunnen on the Albertplatz from 30 m: jets and basin at night, drained in January. Identical before and after plan 078.",
    pose: FOUNTAIN_SQUARE,
    date,
  })),
  {
    name: "river-night",
    plans: ["078"],
    checks:
      "The Elbe at the Terrassenufer's ferry line from 150 m on a July night: mist, wakes and fences at their night value.",
    pose: flyAt(behind(FERRY, 250, 250), 150, FERRY),
    date: `${JULY}T23:30:00+02:00`,
  },
  {
    name: "modell-night",
    plans: ["078"],
    checks:
      "Modell far out (1 : 20 000, 5 m/px: only coarse levels) on a July night: mist, wakes and fences at their night value — may differ from before plan 078 (its finding 2). A phone stops at 1 : 10 000.",
    pose: fly(SPAWN_CENTRE, 300, 45, -40),
    date: `${JULY}T23:30:00+02:00`,
    model: { preset: "iso", pivot: SPAWN_CENTRE, scale: 20_000, turnDeg: 45 },
  },
  {
    name: "modell-comic",
    plans: ["079"],
    query: "?trail=1",
    checks:
      "Modell and Comic for the recovery checks: after a forced loss at level 1 the page comes back in both, at level 2 without either (the link itself is gated the same way).",
    pose: fly(TERRACE_RIVER, 300, 45, -35),
    date: "2026-06-20T15:00:00+02:00",
    look: { style: "comic" },
    model: MODELL_RIVER("iso", 45),
  },
  {
    name: "ask-cone-tree",
    plans: ["080 step 6", "019 M (outline)"],
    checks:
      "A cone crown under the crosshair: ask it (click the centre) — the outline is a cone, not an ellipsoid.",
    pose: walkAt({ x: CONE_TREE.x, y: 5_657_455 }, CONE_TREE, 8),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "ask-round-crown",
    plans: ["080 step 6", "019 M (outline)"],
    checks: "A round crown under the crosshair: ask it — an ellipsoid outline.",
    pose: walkAt({ x: ROUND_TREE.x, y: 5_657_340 }, ROUND_TREE, 13),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "ask-bridge",
    plans: ["080 step 6", "019 M (outline)"],
    checks:
      "The Albertbrücke from the side, its deck under the crosshair: ask it — the outline follows the deck and its piers.",
    pose: flyAt(behind(ALBERTBRUECKE, 57, 150), 50, ALBERTBRUECKE, 12),
    date: "2026-06-20T15:00:00+02:00",
  },
  {
    name: "traffic-albertstrasse",
    plans: ["083 finding 4", "019 M (outline)"],
    checks:
      "Albertstraße from 50 m on a weekday morning with *Kfz-Verkehr* on: on a desktop GPU how long the bodies hold the compile lane after the switch-on; ask a flow for the outline.",
    pose: flyAt({ x: 412_160, y: 5_657_150 }, 50, { x: 412_130, y: 5_657_350 }),
    date: "2026-11-04T08:00:00+01:00",
    look: { trafficLayer: true },
  },
  {
    name: "ask-frauenkirche",
    plans: ["084"],
    checks:
      "The Neumarkt with the Frauenkirche ahead: the start for the device checks of *Frag die Stadt* (reading aloud, Hörmodus, dictation) — ask about the church.",
    pose: NEUMARKT,
    date: "2026-06-20T12:00:00+02:00",
  },
];

/** The DGM1 ground under a place, from the committed tiles (decoded once). */
function groundReader(site: Site) {
  const TILE_M = TILE_KM * 1000;
  const tiles = new Map<string, Promise<Dgm>>();
  return async (p: Xy): Promise<number> => {
    const tile = tileIdOf(site, {
      e: Math.floor(p.x / TILE_M) * (TILE_M / 1000),
      n: Math.floor(p.y / TILE_M) * (TILE_M / 1000),
    });
    const src = dgmSourceFiles(site, tile);
    let pending = tiles.get(tile);
    if (!pending) {
      pending = readDgmFile(src.tif, src.tfw, "native");
      tiles.set(tile, pending);
    }
    const dgm = await pending;
    const [minX, minY, maxX, maxY] = dgm.bounds;
    const col = Math.min(
      dgm.n - 1,
      Math.floor(((p.x - minX) / (maxX - minX)) * dgm.n)
    );
    const row = Math.min(
      dgm.n - 1,
      Math.floor(((maxY - p.y) / (maxY - minY)) * dgm.n)
    );
    const z = dgm.elevations[row * dgm.n + col];
    if (!Number.isFinite(z)) {
      throw new Error(`no DGM ground at ${p.x}, ${p.y}`);
    }
    return z;
  };
}

/** To the centimetre (or hundredth of a degree), never −0. */
const cm = (v: number) => Math.round(v * 100) / 100 + 0;

/** The view as a Snapshot in the site's frame. */
async function snapshotOf(
  view: QaView,
  offset: { cx: number; cy: number },
  groundAt: (p: Xy) => Promise<number>
): Promise<Snapshot> {
  const { pose } = view;
  const ground = await groundAt(pose.at);
  const y = ground + pose.above;
  let headingDeg: number;
  let pitchDeg: number;
  if ("target" in pose) {
    const tz = (await groundAt(pose.target)) + pose.targetAbove;
    const dx = pose.target.x - pose.at.x;
    const dy = pose.target.y - pose.at.y;
    headingDeg = (Math.atan2(dx, dy) * RAD2DEG + 360) % 360;
    pitchDeg = Math.atan2(tz - y, Math.hypot(dx, dy)) * RAD2DEG;
  } else {
    ({ headingDeg, pitchDeg } = pose);
  }
  const camera: CameraStateJson = {
    pos: {
      x: cm(pose.at.x - offset.cx),
      y: cm(y),
      z: cm(-(pose.at.y - offset.cy)),
    },
    epsg: { x: cm(pose.at.x), y: cm(pose.at.y) },
    fov: pose.fov,
    headingDeg: cm(headingDeg),
    pitchDeg: cm(pitchDeg),
    mode: pose.mode,
  };
  if (view.model) {
    const preset = MODEL_PRESETS.find((p) => p.id === view.model?.preset);
    const { pivot } = view.model;
    camera.model = {
      pivot: {
        x: cm(pivot.x - offset.cx),
        y: cm(await groundAt(pivot)),
        z: cm(-(pivot.y - offset.cy)),
      },
      preset: view.model.preset,
      scale: view.model.scale,
      tiltDeg: preset?.tiltDeg ?? 90,
      turnDeg: view.model.turnDeg,
    };
  }
  // What *Kopieren* writes: the whole look, the defaults but for the
  // view's own keys — so a view opened after another keeps nothing of it.
  return encodeSnapshot(
    { ...LOOK_DEFAULTS, ...decodeLook(view.look) },
    camera,
    new Date(view.date)
  );
}

/** The README: every view, what it checks and its link. */
export function qaViewsIndex(
  views: readonly QaView[],
  snapshots: ReadonlyMap<string, Snapshot>
): string {
  const lines = [
    "# QA views",
    "",
    "Written by `bun scripts/qa-views.ts` (plan 048): edit the table there,",
    "never these files. Each view is a Snapshot (`<name>.json`, ADR 0018);",
    "`bun run shots` renders them as `shots/qa-<name>.png` (one view:",
    "`bun run shots -- --grep qa-<name>`). The link opens the view: put the",
    "origin of the preview or production in front (`https://…/dresden?snap=…`);",
    "a check's own knobs are already in its link, before `snap`. The",
    "sidebar's *Erweitert › Snapshot › Anwenden* takes the JSON instead.",
    "",
  ];
  for (const view of views) {
    const snap = snapshots.get(view.name);
    if (!snap) {
      continue;
    }
    lines.push(
      `## ${view.name}`,
      "",
      view.checks,
      "",
      `For: ${view.plans.join(", ")}.${view.query ? ` Open with \`${view.query}\`.` : ""}`,
      "",
      "```text",
      snapshotHref(`/${QA_VIEWS_SITE}${view.query ?? ""}`, snap),
      "```",
      ""
    );
  }
  return lines.join("\n");
}

async function main(check: boolean): Promise<void> {
  const site = siteById(QA_VIEWS_SITE);
  if (!site) {
    throw new Error(`no site ${QA_VIEWS_SITE}`);
  }
  const spawn = tileIdOf(site, site.tiles[0]);
  const src = cityMeshSourceFiles(site, spawn);
  const { offset } = cityFrame(
    spawn,
    JSON.parse(readFileSync(src.city, "utf-8")) as CityJsonDocument
  );
  const groundAt = groundReader(site);
  const snapshots = new Map<string, Snapshot>();
  for (const view of QA_VIEWS) {
    if (snapshots.has(view.name)) {
      throw new Error(`two views named ${view.name}`);
    }
    snapshots.set(view.name, await snapshotOf(view, offset, groundAt));
  }
  const files = new Map<string, string>([
    ...[...snapshots].map(([name, snap]): [string, string] => [
      `${name}.json`,
      `${JSON.stringify(snap, null, 2)}\n`,
    ]),
    ["README.md", qaViewsIndex(QA_VIEWS, snapshots)],
  ]);
  mkdirSync(QA_VIEWS_DIR, { recursive: true });
  let stale = 0;
  for (const [file, text] of files) {
    const path = nodePath.join(QA_VIEWS_DIR, file);
    const same = existsSync(path) && readFileSync(path, "utf-8") === text;
    if (check) {
      if (!same) {
        stale += 1;
        process.stdout.write(`differs: qa/views/${file}\n`);
      }
    } else if (!same) {
      writeFileSync(path, text);
    }
  }
  process.stdout.write(
    check
      ? `${files.size - stale} of ${files.size} files as written\n`
      : `${snapshots.size} views in qa/views/\n`
  );
  if (stale > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main(process.argv.includes("--check"));
}
