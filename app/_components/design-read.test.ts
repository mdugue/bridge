import { describe, expect, test } from "bun:test";
import { Document, WebIO } from "@gltf-transform/core";
import {
  DesignError,
  designFile,
  partOfVertex,
  readDesign,
} from "./design-read";

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

describe("an OBJ", () => {
  test("an object in two materials keeps both, a missing library is named", async () => {
    const obj = [
      "mtllib haus.mtl fehlt.mtl",
      "v 0 0 0",
      "v 10 0 0",
      "v 10 0 -10",
      "v 0 0 -10",
      "v 0 5 0",
      "o haus",
      "usemtl ziegel",
      "f 1 2 3",
      "usemtl glas",
      "f 1 3 4",
      "f 1 2 5",
    ].join("\n");
    const mtl = [
      "newmtl ziegel",
      "Kd 0.6 0.2 0.1",
      "newmtl glas",
      "Kd 0.2 0.4 0.6",
    ].join("\n");
    const model = await readDesign(
      [new File([obj], "haus.obj"), new File([mtl], "haus.mtl")],
      25_833,
      "mobile"
    );
    // brick (red) one triangle, glass (blue) two
    const red = model.looks.findIndex((l) => l.color.r > l.color.b);
    const blue = model.looks.findIndex((l) => l.color.b > l.color.r);
    expect(red).not.toBe(-1);
    expect(blue).not.toBe(-1);
    const count = (i: number) =>
      model.geometry.groups
        .filter((g) => g.materialIndex === i)
        .reduce((n, g) => n + g.count / 3, 0);
    expect(count(red)).toBe(1);
    expect(count(blue)).toBe(2);
    expect(model.note).toContain("fehlt.mtl");
    // a question finds the object by its triangles
    const parts = model.geometry.groups.map((g) =>
      partOfVertex(model.parts, model.geometry.index?.getX(g.start) ?? 0)
    );
    expect(parts.map((p) => model.parts.info[p].name)).toEqual([
      "haus",
      "haus",
    ]);
    expect(
      parts
        .map((p) => model.parts.info[p].material)
        .sort((a, b) => String(a).localeCompare(String(b)))
    ).toEqual(["glas", "ziegel"]);
  });
});
