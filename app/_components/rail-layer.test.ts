import { expect, test } from "bun:test";
import { Box3, type Mesh, MeshStandardNodeMaterial } from "three/webgpu";
import type {
  AreaFeature,
  BridgeFeature,
  RailFeature,
} from "@/lib/city/features";
import { deckMaterial, stoneMaterial } from "./bridge-surface";
import {
  approaches,
  buildBallast,
  buildDeckTable,
  buildRail,
  COLORS,
  type RailContext,
} from "./rail-layer";
import { axisFrame } from "@/lib/city/bridge";
import { deckLift, ringToWorld } from "@/lib/city/decks";

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
  for (let i = 0; pos && i < pos.count; i += 3) {
    const xs = [0, 1, 2].map((k) => pos.getX(i + k));
    const mx = (xs[0] + xs[1] + xs[2]) / 3;
    const top = Math.max(...[0, 1, 2].map((k) => pos.getY(i + k)));
    if (mx > 44 && mx < 56 && top > 113) {
      overStreet++;
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

test("a track over the gap the DGM leaves beside a bridge spans it on a deck of its own", () => {
  // an embankment at 117.5 with a 40 m gap down to the street at 111.5 —
  // a bridge with no deck outline in the data
  const gap: RailContext = {
    offset: { cx: 0, cy: 0 },
    heightAt: (x) => (x > 80 && x < 120 ? 111.5 : 117.5),
  };
  const track: RailFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [0, 0],
        [200, 0],
      ],
    },
    properties: { tracks: 1 },
  };
  const built = buildRail(
    { rails: [track], bridges: [], ballast: [], platforms: [] },
    gap
  );
  // the rails (built first: no bridges, no ballast) never dip into the gap
  const rails = new Box3().setFromObject(built.children[0]);
  expect(rails.min.y).toBeGreaterThan(117.5);
  // and a deck stands under them, at their level, on piers down to the
  // street
  expect(built.children.length).toBeGreaterThan(1);
  const deck = new Box3();
  for (const c of built.children.slice(1)) {
    deck.union(new Box3().setFromObject(c));
  }
  expect(deck.min.x).toBeLessThan(85);
  expect(deck.max.x).toBeGreaterThan(115);
  expect(deck.max.y).toBeGreaterThan(117.5);
  expect(deck.min.y).toBeLessThan(111.5);
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
/** A bridge's stone: its fascia, ashlar parapets, piers and masonry. */
const stoneOf = (bridge: BridgeFeature): Mesh =>
  buildRail({ ...empty, bridges: [bridge] }, ctx).getObjectByName(
    "bridge-stone"
  ) as Mesh;
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
  // a rib that rises nowhere draws nothing (and, like any rib, no railing)
  const flat = rise.map(() => 0);
  expect(
    trianglesOf(deck({ structure: "suspension", ribs: [{ offset: 6, rise }] }))
  ).toBeGreaterThan(
    trianglesOf(
      deck({ structure: "suspension", ribs: [{ offset: 6, rise: flat }] })
    )
  );
  expect(plain).toBeGreaterThan(0);
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
  const pierCount = (b: BridgeFeature) => triangleCount(stoneOf(b));
  expect(pierCount(deck({ fairway: 0.5, span: 120 }))).toBeLessThan(
    pierCount(deck({}))
  );
});

test("no parapet wall runs across the roadway at the abutments", () => {
  for (const b of [deck({}), deck({ structure: "arch" })]) {
    expect(acrossEnds(b)).toBe(0);
  }
});

/** Vertices of a bridge's parapet or railing standing across its ends. */
function acrossEnds(b: BridgeFeature): number {
  const built = buildRail({ ...empty, bridges: [b] }, ctx);
  let across = 0;
  for (const name of ["bridge-stone", "bridge-steel"]) {
    const mesh = built.getObjectByName(name) as Mesh | undefined;
    const pos = mesh?.geometry.getAttribute("position");
    for (let i = 0; pos && i < pos.count; i++) {
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
  }
  return across;
}

test("a masonry bridge's walls hang from the deck's own edges", () => {
  // 200 m over a river at 100 m, deck 120 m, 12 m wide, the axis given
  // corner to corner the way the old bake wrote it would put walls off it
  const stone = stoneOf(deck({ structure: "arch" }));
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
  const built = buildRail({ ...empty, bridges: [bridge] }, ctx);
  let sides = 0;
  // (the railing's posts and rail face every way: they are not its sides)
  for (const child of built.children.filter((c) => c.name !== "bridge-steel")) {
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
  for (const child of buildRail({ ...empty, bridges: [b] }, ctx).children) {
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
  // the deck's underside: a beam on piers 25 m apart is 1.25 m deep
  const soffit = vertices(deck({})).filter(
    (v) => v.ny < -0.99 && Math.abs(v.y - 118.75) < 0.01
  );
  expect(soffit.length).toBeGreaterThan(0);
  // a masonry bridge's vaults face down between springing and crown
  const vault = vertices(deck({ structure: "arch" })).filter(
    (v) => v.ny < -0.5 && v.y > 101 && v.y < 118
  );
  expect(vault.length).toBeGreaterThan(0);
});

test("a railway viaduct stands on paired columns at its edges, a river on piers", () => {
  // 200 m of rail deck over land, no fairway: columns under both edges
  const columns = (b: BridgeFeature) =>
    vertices(b).filter((v) => v.y < 110 && Math.abs(v.ny) < 0.1);
  const viaduct = columns(deck({ kind: "rail" }));
  expect(viaduct.length).toBeGreaterThan(0);
  for (const v of viaduct) {
    expect(Math.abs(Math.abs(v.z) - 5.4)).toBeLessThanOrEqual(0.31);
  }
  // a road deck keeps its piers on the axis
  for (const v of columns(deck({}))) {
    expect(Math.abs(v.z)).toBeLessThanOrEqual(0.66);
  }
  // over water the viaduct's piers stand on its axis too
  const river = columns(deck({ kind: "rail", water: [[60, 140]] })).filter(
    (v) => v.x > 62 && v.x < 138
  );
  expect(river.length).toBeGreaterThan(0);
  for (const v of river) {
    expect(Math.abs(v.z)).toBeLessThanOrEqual(0.66);
  }
  // a viaduct's girder is shallow; a baked fairway depth only caps one
  const soffit = (b: BridgeFeature) =>
    Math.max(
      ...vertices(b)
        .filter((v) => v.ny < -0.99 && v.y < 120)
        .map((v) => v.y)
    );
  expect(soffit(deck({ kind: "rail" }))).toBeCloseTo(119.2, 4);
  expect(soffit(deck({ fairway: 0.5, depth: 5 }))).toBeGreaterThan(118);
  expect(soffit(deck({ depth: 0.9 }))).toBeCloseTo(119.1, 4);
});

test("a masonry bridge's piers stand where DOM1 saw them, a seventh of their span thick", () => {
  const piers = [40, 80, 120, 160];
  const stone = stoneOf(deck({ structure: "arch", piers }));
  const pos = stone.geometry.getAttribute("position");
  const xs = new Set<number>();
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 100.01) {
      xs.add(Math.round(pos.getX(i) * 100) / 100);
    }
  }
  // the piers' feet: 40 m arches between them, the piers 40/7 m thick
  const half = 40 / 7 / 2;
  expect([...xs].sort((a, b) => a - b)).toEqual(
    piers
      .flatMap((x) => [x - half, x + half])
      .map((x) => Math.round(x * 100) / 100)
  );
});

test("a frame on the deck's edge stands in for the parapet", () => {
  const rise = Array.from({ length: 101 }, (_, i) =>
    i > 20 && i < 80 ? 8 : 0
  );
  // a beam bridge's railing tops out 1.1 m over the deck, a masonry
  // bridge's ashlar wall at 0.85 m
  const parapet = (b: BridgeFeature, top = 121.1) =>
    vertices(b).filter((v) => Math.abs(v.y - top) < 0.01).length;
  expect(parapet(deck({}))).toBeGreaterThan(0);
  expect(parapet(deck({}), 120.85)).toBe(0);
  expect(parapet(deck({ structure: "arch" }), 120.85)).toBeGreaterThan(0);
  expect(parapet(deck({ structure: "arch" }))).toBe(0);
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
  for (const child of buildRail({ ...empty, bridges: [b] }, ctx).children) {
    const nrm = (child as Mesh).geometry.getAttribute("normal");
    for (let i = 0; i < nrm.count; i++) {
      expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeGreaterThan(
        0.5
      );
    }
  }
});

test("a deck end above the ground gets an approach down to it", () => {
  // 40 m along x, 10 m wide, its top 101 m over flat ground at 100 m
  const ring = ringToWorld(
    square(0, -5, 10).map(([x, y]) => [x * 4, y]),
    {
      cx: 0,
      cy: 0,
    }
  );
  const topY = ring.pts.map(() => 101);
  const found = approaches(ring, topY, "road", undefined, ctx, []);
  expect(found.length).toBe(2);
  for (const a of found) {
    for (const c of a.columns) {
      const run = Math.hypot(c.land.x - c.x, c.land.z - c.z);
      // at 8 % a metre's drop lands 12 m out, at the ground
      expect(run).toBeCloseTo(12, 5);
      expect(c.land.y).toBeCloseTo(100.04, 5);
      // it runs away from the deck, along x
      expect(Math.abs(a.dir.x)).toBeCloseTo(1, 5);
      expect(c.land.x < 0 || c.land.x > 40).toBe(true);
    }
  }
  // flush with the ground: none
  const flush = ring.pts.map(() => 100.02);
  expect(approaches(ring, flush, "road", undefined, ctx, [])).toEqual([]);
  // an end continued by another deck: none there
  const next = ringToWorld(square(40, -5, 10), { cx: 0, cy: 0 });
  const other = buildDeckTable(
    [
      {
        geometry: { type: "Polygon", coordinates: [square(40, -5, 10)] },
        properties: { kind: "road", deck: next.pts.map(() => 101) },
      },
    ],
    { offset: ctx.offset }
  );
  expect(approaches(ring, topY, "road", undefined, ctx, other).length).toBe(1);
});

test("the lift table carries the approaches for what rides up to a deck", () => {
  const bridge: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [square(0, -5, 10).map(([x, y]) => [x * 4, y])],
    },
    properties: { kind: "road", deck: [101, 101, 101, 101, 101] },
  };
  const decks = buildDeckTable([bridge], ctx);
  // 6 m out from the west end (world x = −6), halfway down the approach
  expect(deckLift(decks, -6, 0, undefined, "ramps")).toBeCloseTo(100.52, 1);
  expect(deckLift(decks, -6, 0, undefined, "decks")).toBeNull();
  expect(deckLift(decks, 20, 0, undefined, "decks")).toBeCloseTo(101, 5);
  // without the ground, only the decks
  expect(buildDeckTable([bridge], { offset: ctx.offset }).length).toBe(1);
});

test("a deck's top is laid out by its frame; its stone is dressed", () => {
  const built = buildRail({ ...empty, bridges: [deck({})] }, ctx);
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
  const plain = buildRail(
    { ...empty, bridges: [deck({ axis: undefined, line: undefined })] },
    ctx
  ).children[0] as Mesh;
  const zeros = plain.geometry.getAttribute("aDeck");
  for (let i = 0; i < zeros.count; i++) {
    expect(zeros.getZ(i) - zeros.getW(i)).toBe(0);
  }
});

test("a deck's slab and parapets follow its measured line, not chords between its corners", () => {
  // a 200 m deck cambered 3 m over its span, with only its four corners:
  // the triangulation's faces join the abutments, so the middle of the
  // span was drawn at the corners' 120 m
  const line = Array.from(
    { length: 101 },
    (_, i) => 120 + 3 * Math.sin((Math.PI * i) / 100)
  );
  const lineAt = (x: number) => 120 + 3 * Math.sin((Math.PI * x) / 200);
  const [top, , steel] = buildRail({ ...empty, bridges: [deck({ line })] }, ctx)
    .children as Mesh[];
  const pos = top.geometry.getAttribute("position");
  const nrm = top.geometry.getAttribute("normal");
  let tops = 0;
  let soffits = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x < 0.01 || x > 199.99 || Math.abs(nrm.getY(i)) < 0.99) {
      continue; // an approach beyond the ends, or the fascia
    }
    const up = nrm.getY(i) > 0;
    expect(pos.getY(i)).toBeCloseTo(lineAt(x) - (up ? 0 : 1.25), 1);
    if (up) {
      tops++;
    } else {
      soffits++;
    }
  }
  expect(tops).toBeGreaterThan(0);
  expect(soffits).toBeGreaterThan(0);
  // the railing's top along the side, mid-span too
  const sp = steel.geometry.getAttribute("position");
  let railing = 0;
  for (let i = 0; i < sp.count; i++) {
    const x = sp.getX(i);
    if (Math.abs(x - 100) < 3 && Math.abs(Math.abs(sp.getZ(i)) - 5.85) < 0.05) {
      railing = Math.max(railing, sp.getY(i));
    }
  }
  expect(railing).toBeCloseTo(lineAt(100) + 1.1, 1);
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
  const top = buildRail({ ...empty, bridges: [bridge] }, ctx)
    .children[0] as Mesh;
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

test("a track with a contact line carries a catenary, one on a third rail none", () => {
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
  let near = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getX(i) - 200) < 1 && pos.getY(i) < 102) {
      // north is −z in the scene
      expect(pos.getZ(i)).toBeLessThan(-2);
      near++;
    }
  }
  expect(near).toBeGreaterThan(0);
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
  for (let i = 0; i < pos.count; i++) {
    // the grid's support at x 200 gives way (and its neighbours stay)
    expect(Math.abs(pos.getX(i) - 200)).toBeGreaterThan(10);
  }
  const wires = built.children.find((c) => c.name === "rail-catenary");
  const box = new Box3().setFromObject(wires as Mesh);
  expect(box.max.y).toBeGreaterThan(106);
});
