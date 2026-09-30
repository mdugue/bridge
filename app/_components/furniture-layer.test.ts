import { expect, test } from "bun:test";
import type { MeshStandardNodeMaterial } from "three/webgpu";
import type { FurnitureFeature } from "@/lib/city/features";
import { buildFurniture, setClockTime } from "./furniture-layer";
import { type Instances, isInstances } from "./instancing";

const ctx = { offset: { cx: 0, cy: 0 }, heightAt: () => 100 };

const at = (
  properties: FurnitureFeature["properties"],
  x = 0
): FurnitureFeature => ({
  geometry: { type: "Point", coordinates: [x, 0] },
  properties,
});

test("the street's signs and fixtures each build an instanced model", () => {
  const group = buildFurniture(
    [
      at({ k: "column" }),
      at({ k: "column", lit: true }, 5),
      at({ k: "signal", a: 90 }, 10),
      at({ k: "hydrant" }, 15),
      at({ k: "hydrantsign", a: 0 }, 20),
      at({ k: "clock", a: 0 }, 25),
      at({ k: "wallclock", a: 180 }, 30),
      at({ k: "water", a: 0 }, 35),
      at({ k: "stop", a: 0 }, 40),
    ],
    ctx
  );
  const names = group.children.map((c) => c.name).toSorted();
  expect(names).toEqual(
    [
      "furniture-clock",
      "furniture-clock-hands",
      "furniture-column",
      "furniture-columnLit",
      "furniture-hydrant",
      "furniture-hydrantSign",
      "furniture-signal",
      "furniture-stop",
      "furniture-wallClock",
      "furniture-wallClock-hands",
      "furniture-water",
    ].toSorted()
  );
  for (const child of group.children as Instances<MeshStandardNodeMaterial>[]) {
    expect(isInstances(child)).toBe(true);
    // the hands never cast: the shadow map is not redrawn every minute
    expect(child.castShadow).toBe(!child.name.endsWith("-hands"));
    expect(child.drawCount).toBe(1);
    // every set applies its instance transform on the vertex
    expect(child.material.positionNode).not.toBeNull();
  }
});

test("every tile wears the scene's node materials", () => {
  const build = () =>
    buildFurniture(
      [at({ k: "column" }), at({ k: "column", lit: true }, 5)],
      ctx
    );
  const byName = (g: ReturnType<typeof build>, name: string) =>
    g.getObjectByName(name) as Instances<MeshStandardNodeMaterial>;
  const [a, b] = [build(), build()];
  const matte = byName(a, "furniture-column").material;
  const glow = byName(a, "furniture-columnLit").material;
  expect(matte.isNodeMaterial).toBe(true);
  expect(matte.userData.shared).toBe(true);
  expect(byName(b, "furniture-column").material).toBe(matte);
  expect(byName(b, "furniture-columnLit").material).toBe(glow);
  // the lit column glows; the plain one does not
  expect(glow.emissiveNode).not.toBeNull();
  expect(matte.emissiveNode).toBeNull();
});

test("a playground's slab is a flush, polygon-offset plain mesh", () => {
  const ring: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];
  const group = buildFurniture(
    [
      {
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { k: "playground" },
      },
    ],
    ctx
  );
  const slab = group.getObjectByName("furniture-playgrounds");
  expect(slab).toBeDefined();
  expect(isInstances(slab)).toBe(false);
  const material = (slab as Instances<MeshStandardNodeMaterial>).material;
  expect(material.polygonOffset).toBe(true);
  expect(material.vertexColors).toBe(true);
});

test("the clock hands move on the minute only", () => {
  const t = new Date(2026, 5, 15, 14, 30, 5);
  setClockTime(t);
  expect(setClockTime(new Date(2026, 5, 15, 14, 30, 50))).toBe(false);
  expect(setClockTime(new Date(2026, 5, 15, 14, 31, 0))).toBe(true);
  // 2:31 and 14:31 read the same on a dial
  expect(setClockTime(new Date(2026, 5, 15, 2, 31, 0))).toBe(false);
});
