/**
 * The census of builds (plan 094 phase 2), for the ledger: what
 * `e2e/ledger.spec.ts` read over a scripted flight of each built site in
 * the whole-site profile (`?scene=lite&block=1`, the data layers on) and
 * once in Modell, turned into `qa/ledger.json`'s `census` section
 * (recorded, never compared: streaming decides what lands when), and the
 * lite spawn's builds against WebGPU's limits, `browser.pipelines`
 * (gated: a function of the tree, read twice the same). Pure: the spec
 * hands over the rows `getPipelineBudget` gave and the counters of
 * `getRenderInfo` and `getTimings`; scripts/ledger-browser.ts calls the
 * functions here.
 */
import type { TimingFigure } from "./ledger-browser";
import type { TerrainBounds } from "./terrain-geometry";

/** One build as the census keeps it: a `getPipelineBudget` row without
 *  its WGSL. */
export interface CensusBuild {
  attributes: number;
  breaches: string[];
  camera: "parallel" | "perspective";
  draw: string;
  /** the user-defined variables the vertex stage writes */
  interStage: number;
  key: string;
  layout: string;
  receiveShadow: boolean;
  /** the fewer of the two stages' spare variables */
  spare: number;
  /** attributes the vertex stage names that the geometry lacks */
  unmatched: number;
  vertexBuffers: number;
}

/** A `getPipelineBudget` row, as far as the census reads it
 *  (app/_components/pipeline-budget.ts `PipelineBudgetRow`). */
export interface BudgetRowShape {
  breaches: readonly string[];
  budget: { attributes: number; interStageOut: number };
  camera: "parallel" | "perspective";
  draw: string;
  key: string;
  layout: string;
  receiveShadow: boolean;
  spare: { interStage: number };
  unmatched: readonly string[];
  vertexBuffers: number;
}

/** A budget row as the census keeps it. */
export const censusBuild = (row: BudgetRowShape): CensusBuild => ({
  key: row.key,
  draw: row.draw,
  layout: row.layout,
  receiveShadow: row.receiveShadow,
  camera: row.camera,
  vertexBuffers: row.vertexBuffers,
  attributes: row.budget.attributes,
  interStage: row.budget.interStageOut,
  spare: row.spare.interStage,
  breaches: [...row.breaches],
  unmatched: row.unmatched.length,
});

/** The scene's counters at one moment. */
export interface CensusMoment {
  framedOther: number;
  framedShadow: number;
  /** three's `info.memory.programs` */
  programs: number;
  /** `getTimings()` then */
  timings: Record<string, TimingFigure>;
}

/** One stop of the flight. */
export interface CensusStop {
  /** representatives whose tile left during the read */
  left: number;
  name: string;
  /** programs the read itself made (`info.memory.programs` around it): a
   *  representative never drawn nor compiled before */
  probeBuilt: number;
  rows: number;
  /** the stream and the compiles fell quiet before the stop's cap */
  settled: boolean;
  /** representatives still in the scene the read had no text for (a
   *  material array, a cut held): not held to the limits */
  unread: number;
  /** how long the stop took to settle (ms) */
  waitedMs: number;
}

/** One flight as the spec read it. */
export interface CensusFlightReading {
  /** every distinct build met at any stop */
  builds: CensusBuild[];
  /** once the data layers were on and the design loaded, settled at the
   *  spawn: where the flight's own window starts (absent for Modell, whose
   *  window starts at `ready`, the moment before `M`) */
  dressed?: CensusMoment;
  end: CensusMoment;
  /** console and page errors met, each once */
  errors: string[];
  /** the data layers switched on, the designs loaded */
  extras: string[];
  ready: CensusMoment;
  site: string;
  stops: CensusStop[];
  tiles: number;
}

/** What the census read: a flight for each site, and Modell once. */
export interface CensusReading {
  flights: CensusFlightReading[];
  modell?: CensusFlightReading;
}

/* ------------------------------------------------------------ the flight */

/** A pose in the scene's frame (x east, y up, z south). */
export interface CensusPose {
  name: string;
  pos: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/** The parts of the tileset's extras the flight is planned from. */
export interface CensusSite {
  ground?: readonly number[];
  offset: { cx: number; cy: number };
  tiles: readonly { bounds: TerrainBounds; id: string }[];
}

/** How many tiles the flight comes down to, at most. */
export const CENSUS_LOW_STOPS = 4;
/** The low stops' eye: so far south of a tile's centre and so high (m). */
export const CENSUS_LOW_EYE = 300;
/** The overview's eye: so far south of the site's centre and so high (m),
 *  as the limits test's far flight (the far building level shows). */
export const CENSUS_HIGH_EYE = 2500;

const centreOf = (b: TerrainBounds) => ({
  e: (b[0] + b[2]) / 2,
  n: (b[1] + b[3]) / 2,
});

/** The Manhattan distance between two points (m). */
const distance = (a: { e: number; n: number }, b: { e: number; n: number }) =>
  Math.abs(a.e - b.e) + Math.abs(a.n - b.n);

/** Of `from` not yet in `seen`, the one farthest from all of `seen` (the
 *  first such on a tie). */
function farthest<T extends { e: number; n: number }>(
  from: readonly T[],
  seen: readonly T[]
): T | undefined {
  let best: T | undefined;
  let bestDistance = -1;
  for (const c of from) {
    if (seen.includes(c)) {
      continue;
    }
    const d = Math.min(...seen.map((s) => distance(c, s)));
    if (d > bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * The scripted flight over a site: an overview from far off over the
 * site's centre, then down to the spawn tile and to the tiles farthest
 * from those already seen (at most `CENSUS_LOW_STOPS` low stops), each
 * looked at obliquely from the south. Heights from the site's ground.
 */
export function censusFlight(site: CensusSite): CensusPose[] {
  const [low = 0, high = low] = site.ground ?? [];
  const ground = (low + high) / 2;
  const scene = (e: number, n: number) => ({
    x: e - site.offset.cx,
    z: -(n - site.offset.cy),
  });
  const centres = site.tiles.map((t) => ({ id: t.id, ...centreOf(t.bounds) }));
  const all = site.tiles.map((t) => t.bounds);
  const middle = centreOf([
    Math.min(...all.map((b) => b[0])),
    Math.min(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.max(...all.map((b) => b[3])),
  ]);
  const at = scene(middle.e, middle.n);
  const poses: CensusPose[] = [
    {
      name: "overview",
      pos: { x: at.x, y: ground + CENSUS_HIGH_EYE, z: at.z + CENSUS_HIGH_EYE },
      target: { x: at.x, y: ground, z: at.z },
    },
  ];
  const chosen: typeof centres = [];
  while (chosen.length < Math.min(CENSUS_LOW_STOPS, centres.length)) {
    const next = chosen.length === 0 ? centres[0] : farthest(centres, chosen);
    if (!next) {
      break;
    }
    chosen.push(next);
  }
  for (const c of chosen) {
    const p = scene(c.e, c.n);
    poses.push({
      name: c.id,
      pos: { x: p.x, y: ground + CENSUS_LOW_EYE, z: p.z + CENSUS_LOW_EYE },
      target: { x: p.x, y: ground, z: p.z },
    });
  }
  return poses;
}

/* ------------------------------------------------------- the ledger's part */

/** A build's name in the ledger: key, draw kind, layout, shadow receipt,
 *  camera. */
export const buildName = (b: CensusBuild): string =>
  `${b.key} [${b.draw}: ${b.layout}]${b.receiveShadow ? " shadowed" : ""} ${b.camera}`;

/**
 * The family of a material key: what comes before its first value — a
 * `:` or `|` (`bridge-deck:road:…`, `terrain|ndvi|…`), or a `-` before a
 * digit (`wire-16777215-1`). A family with more than one key is a set
 * made from data or from the tile's rasters.
 */
export function keyFamily(key: string): string {
  const stem = key.split(/[:|]/u)[0] ?? key;
  return /^(?<family>.+?)-\d/u.exec(stem)?.groups?.family ?? stem;
}

/** Whether `a` asks more of the limits than `b`: fewer spare variables,
 *  then more buffers, attributes, variables written, breaches. */
function tighter(a: CensusBuild, b: CensusBuild): boolean {
  const order: [number, number][] = [
    [b.spare, a.spare],
    [a.vertexBuffers, b.vertexBuffers],
    [a.attributes, b.attributes],
    [a.interStage, b.interStage],
    [a.breaches.length, b.breaches.length],
    [a.unmatched, b.unmatched],
  ];
  for (const [x, y] of order) {
    if (x !== y) {
      return x > y;
    }
  }
  return false;
}

/**
 * The distinct builds of `rows`, one per name, sorted. Two rows of one
 * name (two per-tile materials that share a name and a layout) keep the
 * one that asks most of the limits, whatever order they came in.
 */
export function distinctBuilds(rows: readonly CensusBuild[]): CensusBuild[] {
  const byName = new Map<string, CensusBuild>();
  for (const row of rows) {
    const name = buildName(row);
    const kept = byName.get(name);
    if (!kept || tighter(row, kept)) {
      byName.set(name, row);
    }
  }
  return [...byName.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
}

/** The gated limits row of one build. */
export interface PipelineFigure {
  attributes: number;
  interStage: number;
  spare: number;
  vertexBuffers: number;
}

export const PIPELINES_NOTE =
  "Every build the lite scene draws with at the spawn on the phone page (/dresden?scene=lite, isMobile; read once its tile cache has settled with no compile queued): its WGSL read through renderer.debug.getShaderAsync and counted by lib/city/wgsl-budget.ts (pipeline-budget.ts), named key [draw: layout] shadowed camera. vertexBuffers, attributes and interStage are what the build takes of WebGPU's 8, 16 and 16; spare is what a new varying still fits into. A row that moves is a layer coming nearer a limit (plan 094).";

/** What a build takes of the limits. */
const figureOf = (b: CensusBuild): PipelineFigure => ({
  vertexBuffers: b.vertexBuffers,
  attributes: b.attributes,
  interStage: b.interStage,
  spare: b.spare,
});

/** The lite spawn's builds as the ledger gates them. */
export function pipelineFigures(rows: readonly CensusBuild[]): {
  builds: Record<string, PipelineFigure>;
  note: string;
} {
  return {
    note: PIPELINES_NOTE,
    builds: Object.fromEntries(
      distinctBuilds(rows).map((b) => [buildName(b), figureOf(b)])
    ),
  };
}

/** The timing categories of a landing's compiles. */
export const COMPILE_TIMINGS = /(?:^compile:|:compile$|:queue-wait$)/u;

const tenth = (ms: number) => Math.round(ms * 10) / 10;

/** The compile categories' measures between two moments: counts and
 *  totals subtracted, the larger maximum kept (a maximum cannot be
 *  subtracted). */
export function compileWaits(
  ready: Readonly<Record<string, TimingFigure>>,
  end: Readonly<Record<string, TimingFigure>>
): Record<string, TimingFigure & { meanMs: number }> {
  return Object.fromEntries(
    Object.entries(end)
      .filter(([category]) => COMPILE_TIMINGS.test(category))
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([category, t]) => {
        const was = ready[category] ?? { count: 0, totalMs: 0, maxMs: 0 };
        const count = t.count - was.count;
        const totalMs = t.totalMs - was.totalMs;
        return [
          category,
          {
            count,
            totalMs: tenth(totalMs),
            meanMs: count > 0 ? tenth(totalMs / count) : 0,
            maxMs: tenth(t.maxMs),
          },
        ] as const;
      })
      .filter(([, t]) => t.count > 0)
  );
}

/** One flight's figures in the ledger. */
export interface CensusFigures {
  builds: {
    /** every build met, by name, with what it takes of the limits */
    rows: Record<string, PipelineFigure>;
    /** distinct builds: key × draw × layout × shadow receipt × camera */
    distinct: number;
    /** distinct material and graph keys */
    keys: number;
    /** each family with more than one key: how many it took */
    families: Record<string, number>;
  };
  /** the compiles over the flight (`compileWaits`), from `dressed` (else
   *  `ready`) to its end */
  compileWaits: Record<string, TimingFigure & { meanMs: number }>;
  errors: string[];
  extras: string[];
  /** in-frame node builds (`getRenderInfo().framedBuilds`) */
  framedBuilds: {
    dressed?: { other: number; shadow: number };
    end: { other: number; shadow: number };
    ready: { other: number; shadow: number };
  };
  limits: {
    /** builds past a limit, with the limits they cross */
    breaches: string[];
    /** the fewest spare variables, vertex buffers and attributes left,
     *  each with the builds at it */
    tightest: Record<
      "attributes" | "interStage" | "vertexBuffers",
      { left: number; builds: string[] }
    >;
    unmatched: string[];
  };
  programs: { dressed?: number; end: number; ready: number };
  stops: CensusStop[];
  tiles: number;
}

const LIMIT = { attributes: 16, interStage: 16, vertexBuffers: 8 } as const;

/** A moment's in-frame builds. */
const framed = (m: CensusMoment) => ({
  other: m.framedOther,
  shadow: m.framedShadow,
});

function tightest(
  builds: readonly CensusBuild[],
  left: (b: CensusBuild) => number
): { left: number; builds: string[] } {
  const least = Math.min(...builds.map(left));
  return {
    left: Number.isFinite(least) ? least : 0,
    builds: builds.filter((b) => left(b) === least).map(buildName),
  };
}

/** A flight's figures from what the spec read. */
export function flightFigures(flight: CensusFlightReading): CensusFigures {
  const { dressed } = flight;
  const builds = distinctBuilds(flight.builds);
  const keys = [...new Set(builds.map((b) => b.key))];
  const families = new Map<string, number>();
  for (const key of keys) {
    const family = keyFamily(key);
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  return {
    tiles: flight.tiles,
    extras: flight.extras,
    stops: flight.stops,
    builds: {
      rows: Object.fromEntries(builds.map((b) => [buildName(b), figureOf(b)])),
      distinct: builds.length,
      keys: keys.length,
      families: Object.fromEntries(
        [...families.entries()]
          .filter(([, n]) => n > 1)
          .toSorted(([a], [b]) => a.localeCompare(b))
      ),
    },
    framedBuilds: {
      ready: framed(flight.ready),
      ...(dressed ? { dressed: framed(dressed) } : {}),
      end: framed(flight.end),
    },
    programs: {
      ready: flight.ready.programs,
      ...(dressed ? { dressed: dressed.programs } : {}),
      end: flight.end.programs,
    },
    compileWaits: compileWaits(
      (dressed ?? flight.ready).timings,
      flight.end.timings
    ),
    limits: {
      breaches: builds
        .filter((b) => b.breaches.length > 0)
        .map((b) => `${buildName(b)}: ${b.breaches.join(", ")}`),
      unmatched: builds.filter((b) => b.unmatched > 0).map(buildName),
      tightest: {
        interStage: tightest(
          builds.filter((b) => keyFamily(b.key) !== "clay"),
          (b) => b.spare
        ),
        vertexBuffers: tightest(
          builds,
          (b) => LIMIT.vertexBuffers - b.vertexBuffers
        ),
        attributes: tightest(builds, (b) => LIMIT.attributes - b.attributes),
      },
    },
    errors: flight.errors,
  };
}

export const CENSUS_NOTE =
  "Recorded, never compared (plan 094 phase 2): what lands when depends on the machine's frame rate. Each built site in the whole-site profile (?scene=lite&block=1, 400×300) with its data layers on (Dresden's bike counts answered by the spec, a design block loaded there): ready, then an overview from 2.5 km and low oblique stops over up to four tiles spread over the site, each held until the stream and the compiles fall quiet (or its cap). ready is read at ready, dressed once the layers and the design are on and the spawn has settled again; the flight's window is dressed → end. At each stop getPipelineBudget reads every build the scene holds, which holds them to WebGPU's limits too (builds.rows, each build by name; unread per stop: what had no text; tightest.interStage excludes the clay, held by the limits test). SwiftShader's WGSL and limits only, no real GPU. framedBuilds are in-frame node builds, programs three's info.memory.programs, compileWaits the compile timings' measures over the window — compile:turn-wait is a compile's place in the queue (the probe's own reads take turns too), a landing tile's wait is tile:compile, capped at 3 s. modell: Dresden once more, entered with M after its flight, its window from the moment before M.";

/** The ledger's `census` section. */
export interface CensusLedger {
  machine: string;
  modell?: CensusFigures;
  note: string;
  read: string;
  sites: Record<string, CensusFigures>;
}

/** The census section from what the spec read. */
export function censusLedger(
  reading: CensusReading,
  machine: string,
  today: string
): CensusLedger {
  return {
    note: CENSUS_NOTE,
    machine,
    read: today,
    sites: Object.fromEntries(
      reading.flights
        .toSorted((a, b) => a.site.localeCompare(b.site))
        .map((f) => [f.site, flightFigures(f)])
    ),
    ...(reading.modell ? { modell: flightFigures(reading.modell) } : {}),
  };
}
