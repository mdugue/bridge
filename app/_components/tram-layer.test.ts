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
import { buildDeckTable, deckLift } from "./rail-layer";
import { buildTram } from "./tram-layer";

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
  const decks = buildDeckTable([deck], ctx.offset);
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
