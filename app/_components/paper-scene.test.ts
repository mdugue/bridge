import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Points,
  PointsNodeMaterial,
  Scene,
} from "three/webgpu";
import { uniform } from "three/tsl";
import { createPaperScene, paperGroundOn } from "./paper-scene";

function world() {
  const scene = new Scene();
  const solid = new Mesh(new BoxGeometry(), new MeshStandardNodeMaterial());
  const sheet = new Mesh(
    new BoxGeometry(),
    new MeshBasicNodeMaterial({ transparent: true })
  );
  const sprites = new Points(new BoxGeometry(), new PointsNodeMaterial());
  const groundMaterial = new MeshStandardNodeMaterial();
  groundMaterial.userData.paperOwn = true;
  const ground = new Mesh(new BoxGeometry(), groundMaterial);
  scene.add(solid, sheet, sprites, ground);
  const fog = uniform(new Color(0x11_22_33));
  return { scene, solid, sheet, sprites, ground, groundMaterial, fog };
}

test("a Papier frame draws the scene in paper and restores it exactly", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog);
  const fogBefore = w.fog.value.getHex();
  const restore = paper.begin();
  expect(w.scene.overrideMaterial).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(
    (w.scene.overrideMaterial as MeshStandardNodeMaterial).flatShading
  ).toBe(true);
  // what the paper cannot stand in for is hidden for the frame
  expect(w.sheet.visible).toBe(false);
  expect(w.sprites.visible).toBe(false);
  expect(w.solid.visible).toBe(true);
  // the ground papers itself under the shared uniform
  expect(w.groundMaterial.allowOverride).toBe(false);
  expect(paperGroundOn.value).toBe(1);
  expect(w.fog.value.getHex()).not.toBe(fogBefore);
  restore();
  expect(w.scene.overrideMaterial).toBeNull();
  expect(w.scene.background).toBeNull();
  expect(w.sheet.visible).toBe(true);
  expect(w.sprites.visible).toBe(true);
  expect(w.groundMaterial.allowOverride).toBe(true);
  expect(paperGroundOn.value).toBe(0);
  expect(w.fog.value.getHex()).toBe(fogBefore);
});

test("an object hidden before the frame stays hidden after it", () => {
  const w = world();
  w.sheet.visible = false;
  const paper = createPaperScene(w.scene, w.fog);
  paper.begin()();
  expect(w.sheet.visible).toBe(false);
});

test("swapped runs its callback under the swap and restores after", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog);
  const seen = paper.swapped(() => w.scene.overrideMaterial !== null);
  expect(seen).toBe(true);
  expect(w.scene.overrideMaterial).toBeNull();
});

test("only what wears the paper material is compiled for it", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog);
  expect(paper.drawsAsPaper(w.solid)).toBe(true);
  expect(paper.drawsAsPaper(w.sheet)).toBe(false);
  expect(paper.drawsAsPaper(w.sprites)).toBe(false);
  // the ground draws itself as paper: its own program, not the override's
  expect(paper.drawsAsPaper(w.ground)).toBe(false);
});
