import { expect, test } from "bun:test";
import {
  buildName,
  CENSUS_HIGH_EYE,
  CENSUS_LOW_EYE,
  censusBuild,
  censusFlight,
  censusLedger,
  compileWaits,
  distinctBuilds,
  keyFamily,
  pipelineFigures,
} from "./ledger-census";
import type { CensusBuild, CensusFlightReading } from "./ledger-census";

const build = (patch: Partial<CensusBuild> = {}): CensusBuild => ({
  key: "lamp-post",
  draw: "Mesh",
  layout: "normal,position",
  receiveShadow: true,
  camera: "perspective",
  vertexBuffers: 2,
  attributes: 2,
  interStage: 6,
  spare: 10,
  breaches: [],
  unmatched: 0,
  ...patch,
});

const tile = (id: string, e: number, n: number) => ({
  id,
  bounds: [e, n, e + 2000, n + 2000] as [number, number, number, number],
});

const moment = (framedOther: number, programs: number) => ({
  framedOther,
  framedShadow: 1,
  programs,
  timings: {},
});

test("a material key's family is what comes before its first value", () => {
  expect(keyFamily("bridge-deck:road:ffeedd")).toBe("bridge-deck");
  expect(keyFamily("bridge-stone:c0c0c0")).toBe("bridge-stone");
  expect(keyFamily("terrain|ndvi|surface|2000|2000")).toBe("terrain");
  expect(keyFamily("wire-16777215-1")).toBe("wire");
  expect(keyFamily("tram-car:lvb")).toBe("tram-car");
  // a dash before a letter is part of the name
  expect(keyFamily("lamp-post")).toBe("lamp-post");
  expect(keyFamily("clay|double|niches")).toBe("clay");
});

test("a build is named by key, draw, layout, shadow receipt and camera; one per name", () => {
  expect(buildName(build())).toBe(
    "lamp-post [Mesh: normal,position] shadowed perspective"
  );
  expect(buildName(build({ receiveShadow: false, camera: "parallel" }))).toBe(
    "lamp-post [Mesh: normal,position] parallel"
  );
  const rows = [
    build({ key: "b" }),
    build({ key: "a" }),
    build({ key: "b" }),
    build({ key: "b", camera: "parallel" }),
  ];
  expect(distinctBuilds(rows).map((b) => b.key)).toEqual(["a", "b", "b"]);
});

test("a budget row keeps what the census counts", () => {
  expect(
    censusBuild({
      key: "clay|niches",
      draw: "Mesh",
      layout: "facade,featureId,normal,position",
      receiveShadow: true,
      camera: "perspective",
      vertexBuffers: 4,
      budget: { attributes: 4, interStageOut: 13 },
      spare: { interStage: 2 },
      breaches: [],
      unmatched: ["x"],
    })
  ).toEqual({
    key: "clay|niches",
    draw: "Mesh",
    layout: "facade,featureId,normal,position",
    receiveShadow: true,
    camera: "perspective",
    vertexBuffers: 4,
    attributes: 4,
    interStage: 13,
    spare: 2,
    breaches: [],
    unmatched: 1,
  });
});

test("the gated rows: one per build, the four counts", () => {
  const figures = pipelineFigures([build(), build()]);
  expect(Object.keys(figures.builds)).toEqual([
    "lamp-post [Mesh: normal,position] shadowed perspective",
  ]);
  expect(Object.values(figures.builds)[0]).toEqual({
    vertexBuffers: 2,
    attributes: 2,
    interStage: 6,
    spare: 10,
  });
});

test("the flight: an overview, then the spawn and the tiles farthest from those seen", () => {
  const poses = censusFlight({
    ground: [100, 140],
    offset: { cx: 1000, cy: 1000 },
    tiles: [
      tile("spawn", 2000, 2000),
      tile("near", 4000, 2000),
      tile("far", 10_000, 10_000),
      tile("west", 0, 8000),
      tile("mid", 6000, 6000),
      tile("next", 2000, 4000),
    ],
  });
  expect(poses.map((p) => p.name)).toEqual([
    "overview",
    "spawn",
    "far",
    "west",
    "mid",
  ]);
  // the spawn's centre (3000, 3000) in the scene's frame, from the south
  expect(poses[1]?.target).toEqual({ x: 2000, y: 120, z: -2000 });
  expect(poses[1]?.pos).toEqual({
    x: 2000,
    y: 120 + CENSUS_LOW_EYE,
    z: -2000 + CENSUS_LOW_EYE,
  });
  // the overview over the middle of the tiles' extent (6000, 7000)
  expect(poses[0]?.target).toEqual({ x: 5000, y: 120, z: -6000 });
  expect(poses[0]?.pos.y).toBe(120 + CENSUS_HIGH_EYE);
  // a site of one tile: the overview and the spawn
  expect(
    censusFlight({
      offset: { cx: 0, cy: 0 },
      tiles: [tile("only", 0, 0)],
    }).map((p) => p.name)
  ).toEqual(["overview", "only"]);
});

test("the compile waits over the flight: counts and totals subtracted, the larger maximum kept", () => {
  expect(
    compileWaits(
      {
        "compile:call": { count: 10, totalMs: 100, maxMs: 30 },
        "tile:compile": { count: 2, totalMs: 50, maxMs: 40 },
      },
      {
        "compile:call": { count: 14, totalMs: 180, maxMs: 50 },
        "tile:compile": { count: 2, totalMs: 50, maxMs: 40 },
        "dressing:compile": { count: 3, totalMs: 30.04, maxMs: 20 },
        "traffic:queue-wait": { count: 1, totalMs: 5, maxMs: 5 },
        "boot:frame": { count: 9, totalMs: 900, maxMs: 300 },
      }
    )
  ).toEqual({
    "compile:call": { count: 4, totalMs: 80, meanMs: 20, maxMs: 50 },
    "dressing:compile": { count: 3, totalMs: 30, meanMs: 10, maxMs: 20 },
    "traffic:queue-wait": { count: 1, totalMs: 5, meanMs: 5, maxMs: 5 },
  });
});

test("a flight's figures: families made from data, the tightest builds, the counters", () => {
  const flight: CensusFlightReading = {
    site: "x",
    tiles: 2,
    extras: ["trafficLayer"],
    ready: moment(3, 100),
    end: moment(5, 140),
    errors: [],
    stops: [
      {
        name: "overview",
        settled: true,
        waitedMs: 1,
        rows: 4,
        left: 0,
        probeBuilt: 0,
      },
    ],
    builds: [
      build({ key: "clay|niches", spare: 2, vertexBuffers: 4 }),
      build({ key: "bridge-stone:a", spare: 7 }),
      build({ key: "bridge-stone:b", spare: 7 }),
      build({ key: "traffic", vertexBuffers: 8, attributes: 9 }),
      build({ key: "bad", breaches: ["vertexBuffers"], vertexBuffers: 9 }),
    ],
  };
  const ledger = censusLedger({ flights: [flight] }, "m", "2026-11-16");
  const figures = ledger.sites.x;
  expect(figures?.builds).toEqual({
    distinct: 5,
    keys: 5,
    families: { "bridge-stone": 2 },
  });
  expect(figures?.framedBuilds).toEqual({
    ready: { other: 3, shadow: 1 },
    end: { other: 5, shadow: 1 },
  });
  expect(figures?.programs).toEqual({ ready: 100, end: 140 });
  expect(figures?.limits.breaches).toEqual([
    "bad [Mesh: normal,position] shadowed perspective: vertexBuffers",
  ]);
  // the clay is left out of the variables' tightest (the limits test
  // holds it)
  expect(figures?.limits.tightest.interStage.left).toBe(7);
  expect(figures?.limits.tightest.vertexBuffers).toEqual({
    left: -1,
    builds: ["bad [Mesh: normal,position] shadowed perspective"],
  });
  expect(ledger.modell).toBeUndefined();
});
