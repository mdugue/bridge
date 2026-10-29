import { describe, expect, test } from "bun:test";
import { Document, WebIO } from "@gltf-transform/core";
import { DesignError, designFile, readDesign } from "./design-read";

/** A glb of one 20 × 10 × 6 m box (x east, y up, z south) under a node at
 *  `at`, in two materials (its top and its sides). */
async function boxGlb(at: [number, number, number], scale = 1): Promise<File> {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const top = [0, 6, 0, 0, 6, 10, 20, 6, 10, 0, 6, 0, 20, 6, 10, 20, 6, 0];
  const side = [0, 0, 10, 20, 0, 10, 20, 6, 10, 0, 0, 10, 20, 6, 10, 0, 6, 10];
  const scene = doc.createScene();
  const node = doc
    .createNode("design")
    .setTranslation(at)
    .setScale([scale, scale, scale]);
  scene.addChild(node);
  for (const [name, positions, color] of [
    ["top", top, [1, 0, 0, 1]],
    ["side", side, [0, 0, 1, 1]],
  ] as const) {
    const accessor = doc
      .createAccessor()
      .setType("VEC3")
      .setArray(new Float32Array(positions))
      .setBuffer(buffer);
    const material = doc.createMaterial(name).setBaseColorFactor([...color]);
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", accessor)
      .setMaterial(material);
    node.addChild(
      doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim))
    );
  }
  const glb = await new WebIO().writeBinary(doc);
  return new File([glb], "haus.glb");
}

describe("reading a design", () => {
  test("a selection's design is its glTF", () => {
    const glb = new File([], "a.glb");
    const json = new File([], "a.lage.json");
    expect(designFile([json, glb])).toBe(glb);
    expect(designFile([json])).toBeNull();
  });

  test("a design in UTM is moved to its anchor in doubles and found", async () => {
    const model = await readDesign(
      [await boxGlb([412_500.25, 110, -5_656_600.5])],
      25_833,
      "mobile"
    );
    expect(model.georef?.east).toBeCloseTo(412_510.25, 6);
    expect(model.georef?.north).toBeCloseTo(5_656_595.5, 6);
    expect(model.georef?.base).toBe(110);
    const position = model.geometry.getAttribute("position");
    // the box about its anchor: x −10…10, y 0…6, z −5…5, to the millimetre
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < position.count; i++) {
      minX = Math.min(minX, position.getX(i));
      maxX = Math.max(maxX, position.getX(i));
      minY = Math.min(minY, position.getY(i));
    }
    expect(minX).toBeCloseTo(-10, 3);
    expect(maxX).toBeCloseTo(10, 3);
    expect(minY).toBeCloseTo(0, 3);
    // a group per material, normals where the file had none
    expect(model.geometry.groups.length).toBe(2);
    expect(model.looks.length).toBe(2);
    const normal = model.geometry.getAttribute("normal");
    expect(
      Math.hypot(normal.getX(0), normal.getY(0), normal.getZ(0))
    ).toBeCloseTo(1, 5);
    expect(model.weight.triangles).toBe(4);
  });

  test("a mirrored node keeps its faces outward", async () => {
    const model = await readDesign(
      [await boxGlb([0, 0, 0], -1)],
      25_833,
      "mobile"
    );
    const n = model.geometry.getAttribute("normal");
    // mirrored through the origin, the top is the box's bottom now: its
    // face points down, out of the box (wound back, not inside out)
    expect(n.getY(0)).toBeLessThan(0);
    expect(model.georef).toBeNull();
  });

  test("no glTF among the files is refused in words", async () => {
    const refused = await readDesign(
      [new File(["{}"], "lage.json")],
      25_833,
      "mobile"
    ).then(
      () => null,
      (error: unknown) => error
    );
    expect(refused).toBeInstanceOf(DesignError);
  });
});
