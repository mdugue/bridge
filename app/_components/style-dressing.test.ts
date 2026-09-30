import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Group,
  InstancedBufferAttribute,
  Matrix4,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Scene,
} from "three/webgpu";
import { Instances, isInstances } from "./instancing";
import { createStyleDressing } from "./style-dressing";
import { disposeObject3D } from "./three-utils";

function world() {
  const scene = new Scene();
  const tile = new Group();
  scene.add(tile);
  const crownMaterial = new MeshStandardNodeMaterial();
  const crowns = new Instances(new BoxGeometry(), crownMaterial, 4);
  crowns.setMatrixAt(0, new Matrix4().makeTranslation(10, 0, 0));
  crowns.drawCount = 2;
  crowns.computeBoundingSphere();
  crowns.userData.styleCrown = "mid";
  crowns.geometry.setAttribute(
    "aBare",
    new InstancedBufferAttribute(new Float32Array(4), 1)
  );
  const farCrowns = new Instances(new BoxGeometry(), crownMaterial, 4);
  farCrowns.userData.styleCrown = "far";
  farCrowns.visible = false;
  const heads = new Instances(
    new BoxGeometry(),
    new MeshBasicNodeMaterial(),
    3
  );
  heads.userData.styleLampHeads = { height: 5 };
  tile.add(crowns, farCrowns, heads);
  return { scene, tile, crowns, farCrowns, heads };
}

const styledOf = (tile: Group, name: string) =>
  tile.children.find((c) => c.name === name) as Instances | undefined;

test("a styled frame shows the style's crowns in place of the scene's", () => {
  const w = world();
  w.crowns.name = "crowns";
  const dressing = createStyleDressing(w.scene);
  const restore = dressing.begin({ crowns: "comic", lampCones: false });
  const styled = styledOf(w.tile, "crowns-comic");
  expect(styled).toBeDefined();
  expect(w.crowns.visible).toBe(false);
  expect(styled?.visible).toBe(true);
  // same buffers and material (one build), same count, the season rides along
  expect(styled?.instanceMatrix).toBe(w.crowns.instanceMatrix);
  expect(styled?.material).toBe(w.crowns.material);
  expect(styled?.drawCount).toBe(2);
  expect(styled?.geometry.getAttribute("aBare")).toBe(
    w.crowns.geometry.getAttribute("aBare")
  );
  // a tier its level of detail hides stays hidden
  expect(w.farCrowns.visible).toBe(false);
  restore();
  expect(w.crowns.visible).toBe(true);
  expect(styled?.visible).toBe(false);
  expect(w.farCrowns.visible).toBe(false);
});

test("noir's lamp cones share the heads' matrices and show for its frames", () => {
  const w = world();
  const dressing = createStyleDressing(w.scene);
  const restore = dressing.begin({ crowns: null, lampCones: true });
  const cone = styledOf(w.tile, "style-lamp-cones");
  expect(cone && isInstances(cone)).toBe(true);
  expect(cone?.instanceMatrix).toBe(w.heads.instanceMatrix);
  expect(cone?.visible).toBe(true);
  expect(cone?.castShadow).toBe(false);
  restore();
  expect(cone?.visible).toBe(false);
});

test("prepare builds the dressing hidden, once", () => {
  const w = world();
  const dressing = createStyleDressing(w.scene);
  const made = dressing.prepare({ crowns: "paper", lampCones: true });
  // one styled set per tagged crown set, one cone set per heads set
  expect(made).toHaveLength(3);
  expect(made.every((o) => !o.visible)).toBe(true);
  expect(w.crowns.visible).toBe(true);
  expect(dressing.prepare({ crowns: "paper", lampCones: true })).toHaveLength(
    0
  );
});

test("a tile's release leaves the cones' material to the other tiles", () => {
  const w = world();
  const other = new Group();
  const heads = new Instances(
    new BoxGeometry(),
    new MeshBasicNodeMaterial(),
    3
  );
  heads.userData.styleLampHeads = { height: 5 };
  other.add(heads);
  w.scene.add(other);
  const dressing = createStyleDressing(w.scene);
  dressing.prepare({ crowns: null, lampCones: true });
  const cone = styledOf(w.tile, "style-lamp-cones");
  const material = cone?.material as MeshBasicNodeMaterial;
  expect(styledOf(other, "style-lamp-cones")?.material).toBe(material);
  let disposed = false;
  material.addEventListener("dispose", () => {
    disposed = true;
  });
  // what the dressing plugin does with a released tile
  disposeObject3D(w.tile);
  expect(disposed).toBe(false);
});
