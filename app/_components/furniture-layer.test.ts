import { expect, test } from "bun:test";
import type { MeshStandardNodeMaterial } from "three/webgpu";
import type { FurnitureFeature } from "@/lib/city/features";
import { Box3, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import { buildFurniture, showFurnitureNear } from "./furniture-layer";
import { isInstances } from "./instancing";
import type { Instances } from "./instancing";

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
      at({ k: "signal", a: 90, arm: true }, 45),
      at({ k: "pedsignal", a: 0 }, 50),
      at({ k: "bin", c: "red" }, 55),
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
      "furniture-signalArm",
      "furniture-pedSignal",
      "furniture-binRed",
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

const build = () =>
  buildFurniture([at({ k: "column" }), at({ k: "column", lit: true }, 5)], ctx);

test("every tile wears the scene's node materials", () => {
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
  const { material } = slab as Instances<MeshStandardNodeMaterial>;
  expect(material.polygonOffset).toBe(true);
  expect(material.vertexColors).toBe(true);
});

test("a piece on a bridge stands on its deck, not on the ground below", () => {
  const group = buildFurniture(
    [
      at({ k: "bench", a: 0 }),
      at({ k: "bench", a: 0, deck: 112.5 }, 5),
      at({ k: "bike", a: 0, n: 2, deck: 112.5 }, 10),
    ],
    ctx
  );
  const heights = (name: string) => {
    const set = group.getObjectByName(name) as Instances;
    const m = set.instanceMatrix.array;
    return Array.from({ length: set.drawCount }, (_, i) => m[i * 16 + 13]);
  };
  expect(heights("furniture-bench")).toEqual([100, 112.5]);
  expect(heights("furniture-hoop")).toEqual([112.5, 112.5]);
});

test("a model's pieces are one set per cell, and far cells are hidden", () => {
  // two benches 1.2 km apart: two cells (ctx's ground is the data frame,
  // EPSG x → scene x)
  const group = buildFurniture(
    [at({ k: "bench" }, 10), at({ k: "bench" }, 1210)],
    ctx
  );
  const benches = group.children.filter(
    (c) => c.userData.furnitureCell !== undefined
  );
  expect(benches.length).toBe(2);
  group.updateMatrixWorld(true);
  // how many cells flipped (each asks its shadow rings for a redraw)
  const flips = (eye: Vector3) => {
    let n = 0;
    showFurnitureNear(group, eye, () => {
      n += 1;
    });
    return n;
  };
  expect(flips(new Vector3(10, 101, 0))).toBe(1);
  expect(benches.map((b) => b.visible)).toEqual([true, false]);
  // nothing changed: no shadow redraw
  expect(flips(new Vector3(10, 101, 0))).toBe(0);
  expect(flips(new Vector3(1210, 101, 0))).toBe(2);
  expect(benches.map((b) => b.visible)).toEqual([false, true]);
  // Modell: every cell
  showFurnitureNear(group, null);
  expect(benches.map((b) => b.visible)).toEqual([true, true]);
});

test("a cell on the line does not flip with every step", () => {
  const group = buildFurniture([at({ k: "bench" }, 0)], ctx);
  group.updateMatrixWorld(true);
  const bench = group.children[0];
  // 380 m off: hidden while it was out, kept while it was in
  showFurnitureNear(group, new Vector3(1000, 100, 0));
  expect(bench.visible).toBe(false);
  showFurnitureNear(group, new Vector3(383, 100, 0));
  expect(bench.visible).toBe(false);
  showFurnitureNear(group, new Vector3(300, 100, 0));
  expect(bench.visible).toBe(true);
  showFurnitureNear(group, new Vector3(383, 100, 0));
  expect(bench.visible).toBe(true);
});

test("a clock's hands go with its cell", () => {
  const group = buildFurniture(
    [at({ k: "clock", a: 0 }, 0), at({ k: "clock", a: 0 }, 1200)],
    ctx
  );
  group.updateMatrixWorld(true);
  showFurnitureNear(group, new Vector3(0, 101, 0));
  const shown = group.children.filter((c) => c.visible).map((c) => c.name);
  expect(shown.toSorted()).toEqual([
    "furniture-clock",
    "furniture-clock-hands",
  ]);
});

const position = (set: Instances) => set.geometry.getAttribute("position");

test("a flagpole casts, its cloth flies in its design and casts at rest", () => {
  const group = buildFurniture(
    [
      at({ k: "flag" }),
      at({ k: "flag", c: "de", h: 10.5 }, 5),
      at({ k: "flag" }, 10),
    ],
    ctx
  );
  const byName = new Map(group.children.map((c) => [c.name, c]));
  const mast = byName.get("furniture-flag") as Instances;
  const plain = byName.get("furniture-flag-plain") as Instances;
  const german = byName.get("furniture-flag-de") as Instances;
  expect(mast.drawCount).toBe(3);
  expect(mast.castShadow).toBe(true);
  expect(plain.drawCount).toBe(2);
  expect(german.drawCount).toBe(1);
  for (const cloth of [plain, german]) {
    // the shadow pass draws the sheet at rest, never the wave
    expect(cloth.castShadow).toBe(true);
    const mat = cloth.material as MeshStandardNodeMaterial;
    expect(mat.castShadowPositionNode).not.toBeNull();
    // ...and the cloth looks its shadow up there, or the wave falls into it
    expect(mat.receivedShadowPositionNode).not.toBeNull();
    // the cloths show and hide with every mast of their cell
    expect(cloth.userData.furnitureCell).toEqual(mast.userData.furnitureCell);
  }
  // the cloth hangs at the mast's top, at its own size: a 10.5 m mast
  // lifts it, never stretches it
  const top = new Vector3();
  const scale = new Vector3();
  const m = new Matrix4();
  german.getMatrixAt(0, m);
  m.decompose(top, new Quaternion(), scale);
  expect(top.y).toBeCloseTo(110.5);
  expect(scale.y).toBeCloseTo(1);
  // one cloth per design for the tile: its cells' sets draw from it, and
  // it goes with the tile (another tile has its own)
  const two = buildFurniture(
    [at({ k: "flag" }), at({ k: "flag" }, 1200)],
    ctx
  ).children.filter((c) => c.name === "furniture-flag-plain") as Instances[];
  expect(two.length).toBe(2);
  expect(position(two[0])).toBe(position(two[1]));
  expect(position(two[0])).not.toBe(position(plain));
  expect(position(german)).not.toBe(position(plain));
});

test("a flagpole shows from further than a bench", () => {
  const group = buildFurniture([at({ k: "flag" }), at({ k: "bench" }, 5)], ctx);
  // the eye 600 m off: the bench's cell hides, the mast's and its cloth's
  // stay
  const changed = new Box3();
  showFurnitureNear(group, new Vector3(600, 110, 0), (box) => {
    changed.union(box);
  });
  // what changed is the bench's cell alone: the rings that can hold it
  // redraw, not every one
  expect(changed.min.x).toBeCloseTo(5 - 3);
  expect(changed.max.x).toBeCloseTo(5 + 3);
  const shown = group.children
    .filter((c) => c.userData.furnitureCell)
    .map((c) => [c.name, c.visible]);
  expect(Object.fromEntries(shown)).toEqual({
    "furniture-bench": false,
    "furniture-flag": true,
    "furniture-flag-plain": true,
  });
});
