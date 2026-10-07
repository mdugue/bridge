import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { moreSets } from "./ask-more";
import { hitsInSets, nearestInSets } from "./ask-solids";
import type {
  CanopyFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  LowVegFeature,
  RiversideFeature,
  TramFeature,
  VegRowFeature,
} from "./features";
import { epsgToWorld } from "./ground-clamp";
import { samplePolyline } from "./polyline";
import { type CardCredits } from "./card-lines";
import { inquiryCard } from "./inquiry";
import type { FeatureInquiry } from "./inquiry-features";

/** Dresden's credits (sites/providers.ts) as the HUD hands them over. */
const DRESDEN: CardCredits = {
  dlm: true,
  provider: "Quelle: GeoSN, dl-de/by-2-0",
};

const TILE = "33412_5656_2_sn";
const read = <F>(kind: string) =>
  (
    JSON.parse(
      readFileSync(
        join(
          import.meta.dir,
          "..",
          "..",
          "data",
          "dresden",
          "dlm",
          `${kind}_${TILE}.geojson`
        ),
        "utf8"
      )
    ) as FeatureCollection<F>
  ).features ?? [];

const offset = { cx: 412000, cy: 5656000 };
const ctx = { offset, tile: TILE, heightAt: () => 110 };
const down = { x: 0, y: -1, z: 0 };

const features = {
  canopy: read<CanopyFeature>("canopy"),
  scan: read<CanopyFeature>("canopyx"),
  rows: read<VegRowFeature>("vegrows"),
  hedges: read<LowVegFeature>("lowveg"),
  lamps: read<LampFeature>("lamps"),
  furniture: read<FurnitureFeature>("furniture"),
  trams: read<TramFeature>("tram"),
  river: read<RiversideFeature>("riverside"),
};
const sets = moreSets(features, ctx);

/** What a ray straight down at EPSG (x, y) meets first. */
const askDown = (x: number, y: number): FeatureInquiry | undefined => {
  const w = epsgToWorld(x, y, offset);
  return nearestInSets({ x: w.x, y: 200, z: w.z }, down, sets, 1000)?.target;
};

test("a surface-model crown answers with its measured height", () => {
  const f = features.canopy[100];
  const [x, y] = f.geometry.coordinates;
  const asked = askDown(x, y);
  expect(asked?.kind).toBe("canopy");
  if (asked?.kind === "canopy") {
    expect(asked.source).toBe("dom");
    expect(asked.height).toBe(f.properties?.h);
  }
});

test("a crown a register's tree stands on is left to the register", () => {
  const f = features.canopy[100];
  const [x, y] = f.geometry.coordinates;
  const vetoed = moreSets(features, ctx, (vx, vy) => vx !== x || vy !== y);
  const w = epsgToWorld(x, y, offset);
  const hits = hitsInSets({ x: w.x, y: 200, z: w.z }, down, vetoed, 1000);
  expect(
    hits.some(
      (h) =>
        h.target.kind === "canopy" &&
        h.target.position[0] === Math.round(x * 10) / 10 &&
        h.target.position[1] === Math.round(y * 10) / 10
    )
  ).toBe(false);
});

test("lamps, furniture and tram stops are each askable at their point", () => {
  const lamp = features.lamps[0].geometry.coordinates;
  expect(askDown(lamp[0], lamp[1])?.kind).toBe("lamp");
  const bench = features.furniture.find(
    (f) => f.properties?.k === "bench" && f.geometry.type === "Point"
  );
  const at = bench?.geometry.coordinates as [number, number];
  const asked = askDown(at[0], at[1]);
  expect(asked?.kind).toBe("furniture");
  expect(asked && inquiryCard(asked, null, DRESDEN).title).toBe("Bank");
  const stop = features.trams.find(
    (f) => f.properties?.k === "stop" && f.properties.name
  );
  if (stop?.geometry.type === "Point") {
    const [sx, sy] = stop.geometry.coordinates;
    const s = askDown(sx, sy);
    expect(s?.kind).toBe("stop");
    expect(s && inquiryCard(s, null, DRESDEN).title).toBe(
      stop.properties?.name ?? ""
    );
  }
});

test("a hedge is one thing along its whole line", () => {
  const hedge = features.hedges.find((f) => f.geometry.coordinates.length > 3);
  const along = samplePolyline(hedge?.geometry.coordinates ?? [], 2);
  const [a, b] = [along[0], along.at(-1)] as [number, number][];
  // a crown may stand over the hedge: the hedge is among the hits
  const hedgeAt = ([x, y]: [number, number]) =>
    hitsInSets({ ...epsgToWorld(x, y, offset), y: 200 }, down, sets, 1000).find(
      (h) => h.target.kind === "hedge"
    )?.target;
  const first = hedgeAt(a);
  const last = hedgeAt(b);
  expect(first?.kind).toBe("hedge");
  expect(last?.kind).toBe("hedge");
  expect(first?.position).toEqual(last?.position);
});

test("a landing stage on the river answers with its kind", () => {
  const pier = features.river.find(
    (f) =>
      f.geometry.type === "Polygon" &&
      (f.properties?.k === "pier" || f.properties?.k === "pontoon")
  );
  if (pier?.geometry.type !== "Polygon") {
    return;
  }
  const ring = pier.geometry.coordinates[0];
  const x = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const y = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const hits = hitsInSets(
    { ...epsgToWorld(x, y, offset), y: 200 },
    down,
    sets,
    1000
  );
  expect(hits.some((h) => h.target.kind === "landing")).toBe(true);
});
