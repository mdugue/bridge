import { expect, test } from "bun:test";
import type { Mesh } from "three";
import type { NameFeature } from "@/lib/city/features";
import { type AtlasCanvas, type AtlasContext, buildNames } from "./name-layer";

/** A canvas stand-in: 20 px per character, records what is drawn. */
function stubCanvas(drawn: string[]) {
  return (width: number, height: number): AtlasCanvas => {
    const g: AtlasContext = {
      fillStyle: "",
      font: "",
      lineJoin: "round",
      lineWidth: 1,
      strokeStyle: "",
      textBaseline: "alphabetic",
      measureText: (text) => ({ width: text.length * 20 }),
      fillText: (text) => drawn.push(text),
      strokeText: () => undefined,
    };
    return { width, height, getContext: () => g };
  };
}

const line = (y: number): NameFeature["geometry"] => ({
  type: "LineString",
  coordinates: [
    [0, y],
    [200, y],
  ],
});

test("labels are lettered once each into the atlas and laid on the ground", async () => {
  const drawn: string[] = [];
  const layer = await buildNames(
    [
      {
        geometry: line(0),
        properties: { k: "label", name: "Königstraße", c: "main" },
      },
      {
        geometry: line(50),
        properties: { k: "label", name: "Ritterstraße", c: "minor" },
      },
      { geometry: line(0), properties: { k: "way", name: "Königstraße" } },
    ],
    { offset: { cx: 0, cy: 0 }, heightAt: () => 110, canvas: stubCanvas(drawn) }
  );
  expect(drawn).toEqual(["Königstraße", "Ritterstraße"]);
  expect(layer.ways).toHaveLength(1);
  const [mesh] = layer.group.children as Mesh[];
  expect(mesh.name).toBe("names-lettering");
  expect(mesh.castShadow).toBe(false);
  mesh.geometry.computeBoundingBox();
  expect(mesh.geometry.boundingBox?.max.y).toBeCloseTo(110.2, 4);
  layer.dispose();
});

test("no labels, no lettering", async () => {
  const layer = await buildNames([], {
    offset: { cx: 0, cy: 0 },
    heightAt: () => 0,
    canvas: stubCanvas([]),
  });
  expect(layer.group.children).toHaveLength(0);
});
