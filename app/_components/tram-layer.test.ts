import { expect, test } from "bun:test";
import type { TramFeature } from "@/lib/city/features";
import type { GroundContext } from "@/lib/city/ground-clamp";
import type { Instances } from "./instancing";
import { buildTramStops, TRAM_LOOKS } from "./tram-layer";

const ctx: GroundContext = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

test("the wires are one scene-wide ribbon material: transparent, no depth", () => {
  const material = TRAM_LOOKS["tram-wires"].material();
  expect(material.isNodeMaterial).toBe(true);
  expect(TRAM_LOOKS["tram-wires"].material()).toBe(material);
  expect(material.userData.shared).toBe(true);
  expect(material.transparent).toBe(true);
  expect(material.depthWrite).toBe(false);
  // the ribbon is widened in the position slot, its coverage in opacity
  expect(material.positionNode).not.toBeNull();
  expect(material.opacityNode).not.toBeNull();
  expect(TRAM_LOOKS["tram-wires"].cast).toBe(false);
});

test("the masts cast; the tracks lie on the ground and do not", () => {
  const mast = TRAM_LOOKS["tram-masts"];
  expect(mast.cast).toBe(true);
  // the instanced material it was, which draws a merged mesh as it is
  expect(mast.material().positionNode).not.toBeNull();
  for (const name of [
    "tram-rails",
    "tram-street-rails",
    "tram-grass",
    "tram-ballast",
  ] as const) {
    expect(TRAM_LOOKS[name].cast).toBe(false);
    expect(TRAM_LOOKS[name].material().polygonOffset).toBe(true);
  }
});

test("a tram stop stands the furniture layer's stop sign", () => {
  const stop: TramFeature = {
    geometry: { type: "Point", coordinates: [10, 3] },
    properties: { k: "stop", a: 180, name: "Albertplatz" },
  };
  expect(buildTramStops([], ctx)).toBeNull();
  const group = buildTramStops([stop], ctx);
  expect(group?.name).toBe("tram");
  const [sign] = (group?.children ?? []) as Instances[];
  expect(sign.name).toBe("furniture-stop");
  expect(sign.drawCount).toBe(1);
});
