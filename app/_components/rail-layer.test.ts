import { expect, test } from "bun:test";
import { Box3, type Mesh, MeshStandardNodeMaterial } from "three/webgpu";
import type { BridgeFeature } from "@/lib/city/features";
import { deckMaterial, stoneMaterial } from "./bridge-surface";
import {
  buildBridgeLayer,
  COLORS,
  RAIL_LOOKS,
  type RailContext,
} from "./rail-layer";
import { axisFrame } from "@/lib/city/bridge";

/** What the bridges are built on (the layer adds the triangulation). */
type Ground = Omit<RailContext, "triangulate">;

const ctx: Ground = {
  offset: { cx: 0, cy: 0 },
  heightAt: () => 100,
};

const triangleCount = (mesh: Mesh | null): number => {
  if (!mesh) {
    return 0;
  }
  const index = mesh.geometry.getIndex();
  const n = index ? index.count : mesh.geometry.getAttribute("position").count;
  return n / 3;
};

test("no bridges, an empty group named for the layer", () => {
  const empty = buildBridgeLayer([], ctx);
  expect(empty.name).toBe("rail");
  expect(empty.children).toHaveLength(0);
});

test("the baked rails' looks are scene-wide lit node materials, one per look", () => {
  const ballast = RAIL_LOOKS["rail-ballast"].material();
  expect(ballast).toBeInstanceOf(MeshStandardNodeMaterial);
  // the same colour and finish asked twice is one shared material
  expect(RAIL_LOOKS["rail-ballast"].material()).toBe(ballast);
  const material = ballast;
  expect(material.userData.shared).toBe(true);
  expect(material.polygonOffset).toBe(true);
  expect(material.polygonOffsetUnits).toBe(-2);
  expect(material.fog).toBe(true);
  expect(RAIL_LOOKS["rail-ballast"].cast).toBe(false);
  expect(RAIL_LOOKS["rail-span-top"].material()).toBe(
    deckMaterial("rail", COLORS.deckRail)
  );
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

const trianglesOf = (bridge: BridgeFeature, c: Ground = ctx) =>
  buildBridgeLayer([bridge], c).children.reduce(
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
  const truss = buildBridgeLayer(
    [
      deck({
        structure: "suspension",
        ribs: [
          { offset: 6, rise },
          { offset: -6, rise },
        ],
      }),
    ],
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
  const built = buildBridgeLayer(
    [deck({ structure: "arch", ribs: [{ offset: 6, rise }] })],
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
    const built = buildBridgeLayer([b], ctx);
    const stone = built.children.at(-1) as Mesh;
    return triangleCount(stone);
  };
  expect(pierCount(deck({ fairway: 0.5, span: 120 }))).toBeLessThan(
    pierCount(deck({}))
  );
});

test("no parapet wall runs across the roadway at the abutments", () => {
  const built = buildBridgeLayer([deck({})], ctx);
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

test("a masonry bridge's walls hang from the deck's own edges", () => {
  // 200 m over a river at 100 m, deck 120 m, 12 m wide, the axis given
  // corner to corner the way the old bake wrote it would put walls off it
  const built = buildBridgeLayer([deck({ structure: "arch" })], ctx);
  const stone = built.children.at(-1) as Mesh;
  const pos = stone.geometry.getAttribute("position");
  let below = 0;
  for (let i = 0; i < pos.count; i++) {
    // nothing stands outside the deck's width...
    expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(6.01);
    if (pos.getY(i) < 110) {
      below++;
    }
  }
  // ...and the arches and piers reach down towards the water
  expect(below).toBeGreaterThan(0);
});

test("a curved deck's sides all face out, the inner edge too", () => {
  // a quarter ring, radius 94–106 m around the origin: its centroid lies
  // off the deck, in the hollow of the curve
  const arc = (r: number) =>
    Array.from({ length: 13 }, (_, k): [number, number] => {
      const a = (k / 12) * (Math.PI / 2);
      return [r * Math.cos(a), r * Math.sin(a)];
    });
  const ring = [...arc(106), ...arc(94).reverse()];
  ring.push(ring[0]);
  const bridge: BridgeFeature = {
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      kind: "road",
      deck: ring.map(() => 120),
      axis: arc(100),
      line: Array.from({ length: 79 }, () => 120),
    },
  };
  const built = buildBridgeLayer([bridge], ctx);
  let sides = 0;
  for (const child of built.children) {
    const geo = (child as Mesh).geometry;
    const pos = geo.getAttribute("position");
    const nrm = geo.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      // the deck's sides and parapets (the piers below are square columns)
      if (Math.abs(nrm.getY(i)) > 0.1 || pos.getY(i) < 119.5) {
        continue;
      }
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const radial = (nrm.getX(i) * x + nrm.getZ(i) * z) / r;
      if (Math.abs(radial) < 0.5) {
        continue; // an end face: along the curve, not across it
      }
      sides++;
      // outer edge faces away from the centre, inner edge towards it
      expect(Math.sign(radial)).toBe(r > 100 ? 1 : -1);
    }
  }
  expect(sides).toBeGreaterThan(0);
});

/** Every vertex of every mesh a bridge builds, with its normal. */
function vertices(b: BridgeFeature) {
  const out: { x: number; y: number; z: number; ny: number }[] = [];
  for (const child of buildBridgeLayer([b], ctx).children) {
    const geo = (child as Mesh).geometry;
    const pos = geo.getAttribute("position");
    const nrm = geo.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      out.push({
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
        ny: nrm.getY(i),
      });
    }
  }
  return out;
}

test("a deck is closed from below, and so is an arch", () => {
  // the deck's underside, 1.1 m under its top
  const soffit = vertices(deck({})).filter(
    (v) => v.ny < -0.99 && Math.abs(v.y - 118.9) < 0.01
  );
  expect(soffit.length).toBeGreaterThan(0);
  // a masonry bridge's vaults face down between springing and crown
  const vault = vertices(deck({ structure: "arch" })).filter(
    (v) => v.ny < -0.5 && v.y > 101 && v.y < 118
  );
  expect(vault.length).toBeGreaterThan(0);
});

test("a frame on the deck's edge stands in for the parapet", () => {
  const rise = Array.from({ length: 101 }, (_, i) =>
    i > 20 && i < 80 ? 8 : 0
  );
  const parapet = (b: BridgeFeature) =>
    vertices(b).filter((v) => Math.abs(v.y - 120.85) < 0.01).length;
  expect(parapet(deck({}))).toBeGreaterThan(0);
  const truss = deck({
    structure: "truss",
    ribs: [
      { offset: 6, rise },
      { offset: -6, rise },
    ],
  });
  expect(parapet(truss)).toBe(0);
  // and the frames stand on the deck, not beside it
  for (const v of vertices(truss)) {
    expect(Math.abs(v.z)).toBeLessThanOrEqual(6.01);
  }
});

test("no face of a bridge is left without a normal (it would shade black)", () => {
  // the baked axis runs on a little past the outline at both ends
  const b = deck({
    structure: "arch",
    axis: [
      [-1, 0],
      [201, 0],
    ],
  });
  for (const child of buildBridgeLayer([b], ctx).children) {
    const nrm = (child as Mesh).geometry.getAttribute("normal");
    for (let i = 0; i < nrm.count; i++) {
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeGreaterThan(
        0.5
      );
    }
  }
});

test("a deck's top is laid out by its frame; its stone is dressed", () => {
  const built = buildBridgeLayer([deck({})], ctx);
  const [top, stone] = built.children as Mesh[];
  expect(top.material).toBe(deckMaterial("road", COLORS.deckRoad));
  expect(stone.material).toBe(stoneMaterial(COLORS.deckStone));
  const pos = top.geometry.getAttribute("position");
  const frame = top.geometry.getAttribute("aDeck");
  expect(frame.itemSize).toBe(4);
  expect(frame.count).toBe(pos.count);
  for (let i = 0; i < frame.count; i++) {
    // the station runs along the axis (x here), the offset across it
    // (left of the axis is north: −z), the edges are the outline's
    expect(frame.getX(i)).toBeCloseTo(pos.getX(i), 6);
    expect(frame.getY(i)).toBeCloseTo(-pos.getZ(i), 6);
    expect(frame.getZ(i)).toBeCloseTo(6, 6);
    expect(frame.getW(i)).toBeCloseTo(-6, 6);
  }
  // an older file without an axis keeps its colour: no frame to lay out
  const plain = buildBridgeLayer(
    [deck({ axis: undefined, line: undefined })],
    ctx
  ).children[0] as Mesh;
  const zeros = plain.geometry.getAttribute("aDeck");
  for (let i = 0; i < zeros.count; i++) {
    expect(zeros.getZ(i) - zeros.getW(i)).toBe(0);
  }
});

test("a curved deck's frame holds inside every triangle, not only at its corners", () => {
  // a 12 m deck along an arc of 400 m radius, 300 m long, its axis and
  // outline sampled every 30 m as the bake's are (a few vertices, long
  // chords — the triangulation joins them across the arc)
  const R = 400;
  const at = (s: number, offset: number): [number, number] => {
    const a = s / R;
    return [(R - offset) * Math.sin(a), R - (R - offset) * Math.cos(a)];
  };
  const stations = Array.from({ length: 11 }, (_, i) => i * 30);
  const axis = stations.map((s) => at(s, 0));
  const left = stations.map((s) => at(s, 6));
  const right = stations.map((s) => at(s, -6)).reverse();
  const ring = [...left, ...right, left[0]];
  const bridge = deck({
    axis,
    deck: ring.map(() => 120),
    line: Array.from({ length: 160 }, () => 120),
  });
  bridge.geometry.coordinates = [ring];
  const top = buildBridgeLayer([bridge], ctx).children[0] as Mesh;
  const pos = top.geometry.getAttribute("position");
  const nrm = top.geometry.getAttribute("normal");
  const frame = top.geometry.getAttribute("aDeck");
  const frameAxis = axisFrame(axis);
  let worst = 0;
  for (let t = 0; t < pos.count; t += 3) {
    if (nrm.getY(t) < 0.9) {
      continue;
    }
    const at = (k: number) => [pos.getX(t + k), pos.getZ(t + k)];
    for (let k = 0; k < 3; k++) {
      const [ax, az] = at(k);
      const [bx, bz] = at((k + 1) % 3);
      // no edge of the top longer than the frame's step
      expect(Math.hypot(bx - ax, bz - az)).toBeLessThanOrEqual(6.001);
    }
    const x = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
    const z = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
    const o = (frame.getY(t) + frame.getY(t + 1) + frame.getY(t + 2)) / 3;
    worst = Math.max(
      worst,
      Math.abs(o - (frameAxis?.project(x, -z).offset ?? 0))
    );
  }
  expect(worst).toBeLessThan(0.3);
});
