import { expect, test } from "bun:test";
import { Box3, type Mesh } from "three";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import { buildBallast, buildRail, type RailContext } from "./rail-layer";

const ctx: RailContext = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
};

const square = (x: number, y: number, s = 10): [number, number][] => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

const polygon: AreaFeature = {
  geometry: { type: "Polygon", coordinates: [square(0, 0)] },
  properties: {},
};

const multiPolygon: AreaFeature = {
  geometry: {
    type: "MultiPolygon",
    coordinates: [[square(100, 0)], [square(200, 0)]],
  },
  properties: {},
};

const triangleCount = (mesh: Mesh | null): number => {
  if (!mesh) {
    return 0;
  }
  const index = mesh.geometry.getIndex();
  const n = index ? index.count : mesh.geometry.getAttribute("position").count;
  return n / 3;
};

test("a Polygon ballast area builds a slab", () => {
  const mesh = buildBallast([polygon], ctx);
  expect(mesh).not.toBeNull();
  expect(triangleCount(mesh)).toBeGreaterThan(0);
});

test("MultiPolygon ballast contributes every part", () => {
  const single = triangleCount(buildBallast([polygon], ctx));
  const multi = triangleCount(buildBallast([polygon, multiPolygon], ctx));
  // Two extra squares → roughly three times the geometry of one.
  expect(multi).toBeGreaterThan(single);
  expect(multi).toBe(single * 3);
});

test("null properties are tolerated", () => {
  const feature: AreaFeature = {
    geometry: { type: "Polygon", coordinates: [square(0, 0)] },
    properties: null,
  };
  expect(buildBallast([feature], ctx)).not.toBeNull();
});

test("buildRail: empty inputs yield an empty group, a track and a platform each a mesh", () => {
  const empty = buildRail(
    { rails: [], bridges: [], ballast: [], platforms: [] },
    ctx
  );
  expect(empty.name).toBe("rail");
  expect(empty.children).toHaveLength(0);

  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [40, 0],
      ],
    },
    properties: { tracks: 2 },
  };
  const built = buildRail(
    { rails: [track], bridges: [], ballast: [], platforms: [polygon] },
    ctx
  );
  expect(built.children).toHaveLength(2);
  for (const child of built.children) {
    expect(triangleCount(child as Mesh)).toBeGreaterThan(0);
  }
});

test("a null geometry is skipped, not thrown", () => {
  const feature: AreaFeature = { geometry: null, properties: null };
  expect(buildBallast([feature, polygon], ctx)).not.toBeNull();
  expect(buildBallast([feature], ctx)).toBeNull();
});

/** A 200 m road deck along x at 120 m over ground at 100 m. */
function deck(
  props: Partial<NonNullable<BridgeFeature["properties"]>>
): BridgeFeature {
  const ring: [number, number][] = [
    [0, -6],
    [200, -6],
    [200, 6],
    [0, 6],
    [0, -6],
  ];
  return {
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      kind: "road",
      deck: [120, 120, 120, 120, 120],
      axis: [
        [0, 0],
        [200, 0],
      ],
      line: Array.from({ length: 101 }, () => 120),
      ...props,
    },
  };
}

const empty = { rails: [], ballast: [], platforms: [] };
const trianglesOf = (bridge: BridgeFeature, c: RailContext = ctx) =>
  buildRail({ ...empty, bridges: [bridge] }, c).children.reduce(
    (t, m) => t + triangleCount(m as Mesh),
    0
  );

test("a measured truss becomes an open frame with towers", () => {
  // two pylons 24 m up at 60 m and 140 m, the chord sagging between them
  const rise = Array.from({ length: 101 }, (_, i) => {
    const s = i * 2;
    return Math.max(
      2,
      24 - Math.min(Math.abs(s - 60), Math.abs(s - 140)) * 0.5
    );
  });
  const plain = trianglesOf(deck({ structure: "suspension" }));
  const truss = buildRail(
    {
      ...empty,
      bridges: [
        deck({
          structure: "suspension",
          ribs: [
            { offset: 6, rise },
            { offset: -6, rise },
          ],
        }),
      ],
    },
    ctx
  );
  // deck + stone + the steel
  expect(truss.children).toHaveLength(3);
  const steel = truss.children.at(-1) as Mesh;
  const box = new Box3().setFromObject(steel);
  // the chord is the measured rib, smoothed: just under the 24 m peak
  expect(box.max.y).toBeGreaterThan(142);
  expect(box.max.y).toBeLessThan(144.5);
  expect(
    trianglesOf(deck({ structure: "suspension", ribs: [{ offset: 6, rise }] }))
  ).toBeGreaterThan(plain);
});

test("an arch rib reaches down to its springing", () => {
  // 120 m arch, crown 128 m, springing at the ground (100 m)
  const arch = (s: number) => 128 - 28 * ((s - 100) / 60) ** 2;
  const rise = Array.from({ length: 101 }, (_, i) =>
    Math.max(0, arch(i * 2) - 120)
  );
  const built = buildRail(
    {
      ...empty,
      bridges: [deck({ structure: "arch", ribs: [{ offset: 6, rise }] })],
    },
    ctx
  );
  const steel = built.children.at(-1) as Mesh;
  const box = new Box3().setFromObject(steel);
  expect(box.min.y).toBeLessThan(102);
  // the crown plus half the band
  expect(box.max.y).toBeCloseTo(128.6, 0);
});

test("a deck across a seam is drawn by its owner only", () => {
  const bridge = deck({});
  expect(trianglesOf(bridge, { ...ctx, owns: () => false })).toBe(0);
  expect(trianglesOf(bridge, { ...ctx, owns: () => true })).toBeGreaterThan(0);
});

test("the fairway stays free of piers", () => {
  const pierCount = (b: BridgeFeature) => {
    const built = buildRail({ ...empty, bridges: [b] }, ctx);
    const stone = built.children.at(-1) as Mesh;
    return triangleCount(stone);
  };
  expect(pierCount(deck({ fairway: 0.5, span: 120 }))).toBeLessThan(
    pierCount(deck({}))
  );
});

test("no parapet wall runs across the roadway at the abutments", () => {
  const built = buildRail({ ...empty, bridges: [deck({})] }, ctx);
  const stone = built.children.at(-1) as Mesh;
  const pos = stone.geometry.getAttribute("position");
  let across = 0;
  for (let i = 0; i < pos.count; i++) {
    // the deck runs along x from 0 to 200, 12 m wide: an end wall would
    // stand at x = 0 or 200 across the middle of the road
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (
      (Math.abs(x) < 0.01 || Math.abs(x - 200) < 0.01) &&
      Math.abs(z) < 4 &&
      pos.getY(i) > 120
    ) {
      across++;
    }
  }
  expect(across).toBe(0);
});
