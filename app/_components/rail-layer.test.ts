import { expect, test } from "bun:test";
import { Box3, MeshStandardNodeMaterial } from "three/webgpu";
import type { Mesh } from "three/webgpu";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import { buildBallast, buildRail } from "./rail-layer";
import type { RailContext } from "./rail-layer";

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

test("a yard across an underpass follows the ground, not its corners", () => {
  // the embankment at 117 m, a street at 111 m through it (x 40–60); the
  // yard's outline has corners down in the street
  const underpass: RailContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x > 40 && x < 60 ? 111 : 117),
  };
  const yard: AreaFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [45, 0],
          [55, 0],
          [100, 0],
          [100, 30],
          [55, 30],
          [45, 30],
          [0, 30],
          [0, 0],
        ],
      ],
    },
    properties: {},
  };
  const mesh = buildBallast([yard], underpass);
  const pos = mesh?.geometry.getAttribute("position");
  expect(pos?.count ?? 0).toBeGreaterThan(0);
  let overStreet = 0;
  if (pos) {
    for (let i = 0; i < pos.count; i += 3) {
      const xs = [0, 1, 2].map((k) => pos.getX(i + k));
      const mx = (xs[0] + xs[1] + xs[2]) / 3;
      const top = Math.max(...[0, 1, 2].map((k) => pos.getY(i + k)));
      if (mx > 44 && mx < 56 && top > 113) {
        overStreet += 1;
      }
    }
  }
  // no sheet stands over the street, closing the passage
  expect(overStreet).toBe(0);
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

test("buildRail: empty inputs yield an empty group, a track, its sleepers and a platform each a mesh", () => {
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
  expect(built.children.map((c) => c.name)).toContain("rail-sleepers");
  expect(built.children).toHaveLength(3);
  for (const child of built.children) {
    expect(triangleCount(child as Mesh)).toBeGreaterThan(0);
  }
});

test("a null geometry is skipped, not thrown", () => {
  const feature: AreaFeature = { geometry: null, properties: null };
  expect(buildBallast([feature, polygon], ctx)).not.toBeNull();
  expect(buildBallast([feature], ctx)).toBeNull();
});

test("the materials are scene-wide lit node materials, one per look", () => {
  const a = buildBallast([polygon], ctx);
  const b = buildBallast([multiPolygon], ctx);
  expect(a?.material).toBeInstanceOf(MeshStandardNodeMaterial);
  // the same colour and finish on two builds is one shared material
  expect(a?.material).toBe(b?.material as MeshStandardNodeMaterial);
  const material = a?.material as MeshStandardNodeMaterial;
  expect(material.userData.shared).toBe(true);
  expect(material.polygonOffset).toBe(true);
  expect(material.polygonOffsetUnits).toBe(-2);
  expect(material.fog).toBe(true);
  expect(a?.castShadow).toBe(false);
});

const along = (electrified: number): RailFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [400, 0],
    ],
  },
  properties: { electrified, tracks: 1 },
});

const names = (f: RailFeature) =>
  buildRail(
    { rails: [f], bridges: [], ballast: [], platforms: [] },
    ctx
  ).children.map((c) => c.name);

test("a track with a contact line carries a catenary, one on a third rail none", () => {
  expect(names(along(1))).toContain("rail-catenary");
  expect(names(along(1))).toContain("rail-catenary-masts");
  expect(names(along(2))).not.toContain("rail-catenary");
  expect(names(along(0))).not.toContain("rail-catenary-masts");
});

test("a track the source puts below a long lid is not drawn on it", () => {
  // the DGM's lid 6 m over the trench for 300 m, the way mapped layer −1
  const lid: RailContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x >= 200 && x <= 500 ? 116 : 110),
  };
  const trench: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [700, 0],
      ],
    },
    properties: { layer: -1, tracks: 1 },
  };
  const built = buildRail(
    { rails: [trench], bridges: [], ballast: [], platforms: [] },
    lid
  );
  const rails = built.children[0] as Mesh;
  const box = new Box3().setFromObject(rails);
  expect(box.max.y).toBeLessThan(113);
});

test("a paved track has no sleepers", () => {
  const yard: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [40, 0],
      ],
    },
    properties: { paved: 1, tracks: 1 },
  };
  const built = buildRail(
    { rails: [yard], bridges: [], ballast: [], platforms: [] },
    ctx
  );
  expect(built.children.map((c) => c.name)).not.toContain("rail-sleepers");
});

test("a mapped catenary mast stands on the side of the track it is mapped on", () => {
  // the track runs east; OSM maps its mast 3.5 m to its left (north)
  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [400, 0],
      ],
    },
    properties: { electrified: 1, tracks: 1, m: [[200, 3.5]] },
  };
  const built = buildRail(
    { rails: [track], bridges: [], ballast: [], platforms: [] },
    ctx
  );
  const masts = built.children.find((c) => c.name === "rail-catenary-masts");
  const pos = (masts as Mesh).geometry.getAttribute("position");
  let nearCount = 0;
  const south: number[] = [];
  for (let i = 0; i < pos.count; i += 1) {
    if (Math.abs(pos.getX(i) - 200) < 1 && pos.getY(i) < 102) {
      // north is −z in the scene
      if (pos.getZ(i) >= -2) {
        south.push(pos.getZ(i));
      }
      nearCount += 1;
    }
  }
  expect(nearCount).toBeGreaterThan(0);
  expect(south).toEqual([]);
});

test("no catenary support stands under a bridge over the track", () => {
  // a road bridge 8 m over the track across x 190–210
  const road: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [190, -15],
          [210, -15],
          [210, 15],
          [190, 15],
          [190, -15],
        ],
      ],
    },
    properties: { deck: [108, 108, 108, 108, 108], kind: "road" },
  };
  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [400, 0],
      ],
    },
    properties: { electrified: 1, tracks: 1 },
  };
  const built = buildRail(
    { rails: [track], bridges: [road], ballast: [], platforms: [] },
    ctx
  );
  const masts = built.children.find((c) => c.name === "rail-catenary-masts");
  const pos = (masts as Mesh).geometry.getAttribute("position");
  // the grid's support at x 200 gives way, and its neighbours 50 m off
  // on either side of the bridge stay
  const xs = Array.from({ length: pos.count }, (_, i) => pos.getX(i));
  expect(xs.filter((x) => Math.abs(x - 200) <= 10)).toEqual([]);
  expect(xs.some((x) => Math.abs(x - 150) < 2)).toBe(true);
  expect(xs.some((x) => Math.abs(x - 250) < 2)).toBe(true);
  const wires = built.children.find((c) => c.name === "rail-catenary");
  const box = new Box3().setFromObject(wires as Mesh);
  expect(box.max.y).toBeGreaterThan(106);
});

test("a monorail is a beam on supports, no track", () => {
  // the beam's underside 6 m over the ground, then 20 m over a hollow
  const hollow: RailContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x > 20 && x < 60 ? 86 : 100),
  };
  const beam: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [80, 0],
      ],
    },
    properties: { mono: "hanging", tracks: 2, bz: [106, 106] },
  };
  const built = buildRail(
    { rails: [beam], bridges: [], ballast: [], platforms: [] },
    hollow
  );
  expect(built.children.map((c) => c.name)).toEqual(["rail-monorail"]);
  const box = new Box3().setFromObject(built.children[0]);
  // the girder's top over its underside, the feet in the hollow's floor
  expect(box.max.y).toBeGreaterThan(107);
  expect(box.min.y).toBeLessThan(86);
  expect(box.min.y).toBeGreaterThan(85);
  // the portals' legs stand either side of the cars' way
  expect(box.max.z - box.min.z).toBeGreaterThan(6);
});
