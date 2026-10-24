import { expect, test } from "bun:test";
import type {
  BufferGeometry,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import type { BridgeFeature, TramFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import { CONTACT_WIRE_M, RAIL_TOP_M } from "@/lib/city/tram";
import type { Instances } from "./instancing";
import { deckLift } from "@/lib/city/decks";
import { buildDeckTable } from "./rail-layer";
import { buildTram, lawnHalves } from "./tram-layer";

const ctx: GroundContext = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

const track = (
  bed: "ballast" | "grass" | "street",
  extra: Partial<NonNullable<TramFeature["properties"]>> = {}
): TramFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [60, 0],
    ],
  },
  properties: { k: "track", bed, s: [30], ...extra },
});

const named = (group: ReturnType<typeof buildTram>, name: string) =>
  group.children.filter((c) => c.name === name) as Mesh[];

const maxY = (g: BufferGeometry): number => {
  g.computeBoundingBox();
  return g.boundingBox?.max.y ?? Number.NaN;
};

test("no features, an empty group", () => {
  const group = buildTram([], [], ctx);
  expect(group.name).toBe("tram");
  expect(group.children).toHaveLength(0);
});

test("a street track is flush rails with its wire 5.6 m up", () => {
  const group = buildTram([track("street")], [], ctx);
  const tracks = named(group, "tram-track");
  expect(tracks.length).toBe(1); // rail heads, no groove, no bed strip
  for (const m of tracks) {
    expect(maxY(m.geometry)).toBeCloseTo(100 + RAIL_TOP_M.street, 5);
    expect(m.castShadow).toBe(false);
  }
  const [wires] = named(group, "tram-wires");
  expect(wires.castShadow).toBe(false);
  expect(maxY(wires.geometry)).toBeCloseTo(
    100 + RAIL_TOP_M.street + CONTACT_WIRE_M,
    5
  );
});

test("the wires are one scene-wide ribbon material: transparent, no depth", () => {
  const a = named(buildTram([track("street")], [], ctx), "tram-wires")[0];
  const b = named(buildTram([track("grass")], [], ctx), "tram-wires")[0];
  const material = a.material as MeshBasicNodeMaterial;
  expect(material.isNodeMaterial).toBe(true);
  expect(b.material).toBe(material);
  expect(material.userData.shared).toBe(true);
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  // the ribbon is widened in the position slot, its coverage in opacity
  expect(material.positionNode).not.toBeNull();
  expect(material.opacityNode).not.toBeNull();
  for (const name of ["wireDir", "wireSide", "wireHalf"]) {
    expect(a.geometry.hasAttribute(name)).toBe(true);
  }
});

test("a lawn track has rails and a meadow strip under them", () => {
  const group = buildTram([track("grass")], [], ctx);
  expect(named(group, "tram-track").length).toBe(2); // rails + lawn
});

test("masts stand instanced and cast; a span hangs over the wire it crosses", () => {
  const mast = (x: number, y: number): TramFeature => ({
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { k: "mast" },
  });
  const span: TramFeature = {
    geometry: {
      type: "LineString",
      coordinates: [
        [30, -8],
        [30, 8],
      ],
    },
    properties: { k: "span", x: [0.5] },
  };
  const group = buildTram(
    [track("street"), mast(30, -8), mast(30, 8), span],
    [],
    ctx
  );
  const [masts] = group.children.filter(
    (c) => c.name === "tram-masts"
  ) as Instances<MeshStandardNodeMaterial>[];
  expect(masts.isInstances).toBe(true);
  expect(masts.drawCount).toBe(2);
  expect(masts.castShadow).toBe(true);
  // the set applies its instance transform in the position slot
  expect(masts.material.positionNode).not.toBeNull();
  const [wires] = named(group, "tram-wires");
  // the span's anchors are 7 m up the masts
  expect(maxY(wires.geometry)).toBeCloseTo(107, 5);
});

test("a track the OSM way puts on a bridge rides the deck, along its ramp", () => {
  const deck: BridgeFeature = {
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, -5],
          [60, -5],
          [60, 5],
          [0, 5],
          [0, -5],
        ],
      ],
    },
    properties: { kind: "road", deck: [104, 108, 108, 104, 104] },
  };
  const decks = buildDeckTable([deck], { offset: ctx.offset });
  // world z = −y: the lift is read in the Y-up frame
  expect(deckLift(decks, 30, 0)).toBeCloseTo(106, 5);
  expect(deckLift(decks, 30, 0, ["rail"])).toBeNull();
  const on = buildTram([track("street", { bridge: 1 })], [deck], ctx);
  const off = buildTram([track("street")], [deck], ctx);
  const top = (g: ReturnType<typeof buildTram>) =>
    maxY(named(g, "tram-track")[0].geometry);
  expect(top(on)).toBeGreaterThan(107);
  expect(top(off)).toBeCloseTo(100 + RAIL_TOP_M.street, 5);
});

test("a tram stop stands the furniture layer's stop sign", () => {
  const stop: TramFeature = {
    geometry: { type: "Point", coordinates: [10, 3] },
    properties: { k: "stop", a: 180, name: "Albertplatz" },
  };
  const group = buildTram([track("street"), stop], [], ctx);
  const stops = group.children.find((c) => c.name === "tram-stops");
  const [sign] = (stops?.children ?? []) as Instances[];
  expect(sign.name).toBe("furniture-stop");
  expect(sign.drawCount).toBe(1);
});

/** A lawn track along y = `y` (projected), 60 m long. */
const lawnAt = (y: number): TramFeature => ({
  geometry: {
    type: "LineString",
    coordinates: [
      [0, y],
      [60, y],
    ],
  },
  properties: { k: "track", bed: "grass", s: [30] },
});

/** The lawn's extent across (world z = −y) and its area. */
const lawnSpan = (group: ReturnType<typeof buildTram>) => {
  const meshes = named(group, "tram-track");
  // the rails' strips are 0.15 m wide; the lawn is the widest
  const lawn = meshes
    .map((m) => {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox;
      return { m, w: b ? b.max.z - b.min.z : 0, b };
    })
    .sort((a, b) => b.w - a.w)[0];
  return lawn.b;
};

test("a double lawn track shares one lawn, its inner edges at the midpoint", () => {
  // axes 3.4 m apart: each strip reaches 1.7 m inward, 1.3 m outward
  const group = buildTram([lawnAt(0), lawnAt(3.4)], [], ctx);
  const b = lawnSpan(group);
  expect(b?.min.z).toBeCloseTo(-3.4 - 1.3, 3);
  expect(b?.max.z).toBeCloseTo(1.3, 3);
  const pos = named(group, "tram-track")
    .map((m) => m.geometry.getAttribute("position"))
    .find((p) => {
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getZ(i) + 1.7) < 0.02) {
          return true;
        }
      }
      return false;
    });
  // both strips reach the midpoint (z = −1.7), no road between them
  expect(pos).toBeDefined();
});

test("a lawn track's next piece, end to end, is no neighbour", () => {
  // one track split into two ways at x 30, its points every 2 m
  const run = (x0: number) => ({
    d: Array.from({ length: 16 }, (_, k) => k * 2),
    pts: Array.from({ length: 16 }, (_, k) => ({
      x: x0 + k * 2,
      y: 100,
      z: 0,
    })),
  });
  const halves = lawnHalves([run(0), run(32)]);
  expect(halves).toHaveLength(2);
  for (const h of halves) {
    expect(h.left.every((w) => w === 1.3)).toBe(true);
    expect(h.right.every((w) => w === 1.3)).toBe(true);
    expect(h.sharedLeft.concat(h.sharedRight).some(Boolean)).toBe(false);
  }
});

test("lawn tracks further apart than 4.5 m keep their own strips", () => {
  const [a, b] = lawnHalves([
    {
      d: [0, 60],
      pts: [
        { x: 0, y: 100, z: 0 },
        { x: 60, y: 100, z: 0 },
      ],
    },
    {
      d: [0, 60],
      pts: [
        { x: 0, y: 100, z: -6 },
        { x: 60, y: 100, z: -6 },
      ],
    },
  ]);
  expect(a.left).toEqual([1.3, 1.3]);
  expect(a.right).toEqual([1.3, 1.3]);
  expect(b.sharedLeft.concat(b.sharedRight)).toEqual([
    false,
    false,
    false,
    false,
  ]);
  const [c, d] = lawnHalves([
    {
      d: [0, 60],
      pts: [
        { x: 0, y: 100, z: 0 },
        { x: 60, y: 100, z: 0 },
      ],
    },
    {
      d: [0, 60],
      pts: [
        { x: 60, y: 100, z: -4 },
        { x: 0, y: 100, z: -4 },
      ],
    },
  ]);
  // the strips meet at z = −2 whichever way each runs (here each finds the
  // other on its right, the side −n of the ribbons' normal (−tz, tx))
  expect(c.right[0]).toBeCloseTo(1.99, 5);
  expect(c.left[0]).toBe(1.3);
  expect(c.sharedRight).toEqual([true, true]);
  expect(d.right[0]).toBeCloseTo(1.99, 5);
});

test("a pole the bake placed stands like a mapped mast", () => {
  const pole = (x: number, y: number): TramFeature => ({
    geometry: { type: "Point", coordinates: [x, y] },
    properties: { k: "pole" },
  });
  const group = buildTram(
    [
      track("street"),
      pole(30, -8),
      { ...pole(30, 8), properties: { k: "pole", lamp: 1 } },
    ],
    [],
    ctx
  );
  const [masts] = group.children.filter(
    (c) => c.name === "tram-masts"
  ) as Instances[];
  expect(masts.drawCount).toBe(2);
});
