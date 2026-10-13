import { expect, test } from "bun:test";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  type MeshBasicNodeMaterial,
} from "three/webgpu";
import { LINE_NODES, type LineNode } from "@/lib/city/line-nodes";
import { dressLines, lineMeshes } from "./line-looks";
import { graphOf } from "./material-slots";
import { TRAM_LOOKS } from "./tram-layer";

/** A fine level's content as the glTF loader hands it over: a node per
 *  baked part, its custom attributes lower-cased. */
function content(names: readonly LineNode[]): Group {
  const root = new Group();
  root.add(new Mesh(new BufferGeometry()));
  root.children[0].name = "terrain";
  for (const name of names) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
    );
    if (name === "tram-wires") {
      geometry.setAttribute(
        "_wiredir",
        new Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3)
      );
      geometry.setAttribute(
        "_wireside",
        new Float32BufferAttribute([1, -1, 1], 1)
      );
      geometry.setAttribute(
        "_wirehalf",
        new Float32BufferAttribute([0.01, 0.01, 0.01], 1)
      );
    }
    const mesh = new Mesh(geometry);
    mesh.name = name;
    root.add(mesh);
  }
  return root;
}

const ALL = Object.keys(LINE_NODES) as LineNode[];

test("every baked node gets its layer's look, grouped by layer", () => {
  const lines = dressLines(content(ALL));
  expect(lineMeshes(lines)).toHaveLength(ALL.length);
  for (const layer of ["rail", "tram", "riverside"] as const) {
    for (const mesh of lines[layer]) {
      expect(LINE_NODES[mesh.name as LineNode]).toBe(layer);
    }
  }
  const [ferry] = lines.riverside.filter((m) => m.name === "riverside-ferry");
  expect(ferry.renderOrder).toBe(3);
  expect(ferry.castShadow).toBe(false);
  expect(ferry.receiveShadow).toBe(false);
  const [masts] = lines.tram.filter((m) => m.name === "tram-masts");
  expect(masts.castShadow).toBe(true);
});

test("each tile wears its own copy of the scene-wide material: one build", () => {
  // the tile renderer disposes every material in a tile's content when it
  // unloads: a scene-wide one there would be disposed for every tile
  const a = dressLines(content(["tram-wires"])).tram[0];
  const b = dressLines(content(["tram-wires"])).tram[0];
  const shared = TRAM_LOOKS["tram-wires"].material();
  const mine = a.material as MeshBasicNodeMaterial;
  expect(mine).not.toBe(shared);
  expect(mine).not.toBe(b.material);
  expect(mine.userData.shared).toBeUndefined();
  // the same nodes: three builds the copies alike, once
  expect(mine.positionNode).toBe(shared.positionNode);
  expect(mine.opacityNode).toBe(shared.opacityNode);
  expect(mine.transparent).toBe(true);
  expect(mine.customProgramCacheKey()).toBe(
    (b.material as MeshBasicNodeMaterial).customProgramCacheKey()
  );
  // and the pipeline anchors keep that build by its name
  expect(graphOf(mine)).toBe(`line:${shared.name}`);
});

test("the wires' attributes go by the names their material reads", () => {
  const [wires] = dressLines(content(["tram-wires"])).tram;
  for (const name of ["wireDir", "wireSide", "wireHalf"]) {
    expect(wires.geometry.hasAttribute(name)).toBe(true);
  }
  expect(wires.geometry.hasAttribute("_wiredir")).toBe(false);
});

test("a level without lines has none; the terrain is left alone", () => {
  const root = content([]);
  const lines = dressLines(root);
  expect(lineMeshes(lines)).toEqual([]);
  expect(lineMeshes(undefined)).toEqual([]);
});
