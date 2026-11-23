import { expect, test } from "bun:test";
import {
  BoxGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  Points,
  PointsNodeMaterial,
  Scene,
} from "three/webgpu";
import { positionLocal, uniform, vec3 } from "three/tsl";
import { createPaperScene, PAPER_GROUND, paperGroundOn } from "./paper-scene";

/** Records what three would draw, through the object function a swap sets. */
function fakeRenderer() {
  const drawn: unknown[] = [];
  let fn: ((...args: never[]) => void) | null = null;
  return {
    drawn,
    getRenderObjectFunction: () => fn,
    renderObject: (...args: unknown[]) => {
      drawn.push(args[4]);
    },
    setRenderObjectFunction: (f: typeof fn) => {
      fn = f;
    },
  } as unknown as Parameters<typeof createPaperScene>[2] & {
    drawn: unknown[];
  };
}

/** Draws `mesh` as three's render list would, with its own material. */
function drawThrough(
  renderer: ReturnType<typeof fakeRenderer>,
  mesh: Mesh
): void {
  const draw = renderer.getRenderObjectFunction() ?? renderer.renderObject;
  (draw as (...args: unknown[]) => void)(
    mesh,
    null,
    null,
    mesh.geometry,
    mesh.material,
    null
  );
}

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
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
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
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  paper.begin()();
  expect(w.sheet.visible).toBe(false);
});

test("swapped runs its callback under the swap and restores after", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  const seen = paper.swapped(w.solid, () => w.scene.overrideMaterial !== null);
  expect(seen).toBe(true);
  expect(w.scene.overrideMaterial).toBeNull();
});

test("swapped holds the object's position node on the paper throughout", () => {
  // compileAsync makes the render object and starts its build after three
  // has put the override's own position node back: an instanced set built
  // without its node drew every instance at its origin in Papier.
  const w = world();
  const placed = positionLocal.add(vec3(100, 0, 0));
  w.solid.material.positionNode = placed;
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  const during = paper.swapped(
    w.solid,
    () => (w.scene.overrideMaterial as MeshStandardNodeMaterial).positionNode
  );
  expect(during).toBe(placed);
  // the next Papier frame starts from the paper's own (none)
  const restore = paper.begin();
  expect(
    (w.scene.overrideMaterial as MeshStandardNodeMaterial).positionNode
  ).toBeNull();
  restore();
});

test("only what wears the paper material is compiled for it", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  expect(paper.drawsAsPaper(w.solid)).toBe(true);
  expect(paper.drawsAsPaper(w.sheet)).toBe(false);
  expect(paper.drawsAsPaper(w.sprites)).toBe(false);
  // the ground draws itself as paper: its own program, not the override's
  expect(paper.drawsAsPaper(w.ground)).toBe(false);
});

test("Strich draws the white model on its own ground, on a white sheet", () => {
  const w = world();
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  const restore = paper.begin("line");
  expect(w.scene.overrideMaterial).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(paperGroundOn.value).toBe(PAPER_GROUND.line);
  expect((w.scene.background as Color).getHex()).toBe(0xff_ff_ff);
  expect(w.solid.visible).toBe(true);
  expect(w.sheet.visible).toBe(false);
  restore();
  expect(paperGroundOn.value).toBe(0);
});

test("the Schwarzplan draws only the buildings, black, and the white ground", () => {
  const w = world();
  const clay = new MeshStandardNodeMaterial();
  clay.userData.figure = true;
  const building = new Mesh(new BoxGeometry(), clay);
  w.scene.add(building);
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  const restore = paper.begin("figure");
  const figure = w.scene.overrideMaterial as MeshBasicNodeMaterial;
  expect(figure).toBeInstanceOf(MeshBasicNodeMaterial);
  expect(figure.color.getHex()).toBeLessThan(0x20_20_20);
  expect(paperGroundOn.value).toBe(PAPER_GROUND.figure);
  // a tree, a wall, a bench: not in a figure-ground plan
  expect(w.solid.visible).toBe(false);
  expect(w.sheet.visible).toBe(false);
  expect(w.sprites.visible).toBe(false);
  expect(building.visible).toBe(true);
  expect(w.ground.visible).toBe(true);
  expect(paper.drawsAsPaper(building, "figure")).toBe(true);
  expect(paper.drawsAsPaper(w.solid, "figure")).toBe(false);
  restore();
  expect(w.solid.visible).toBe(true);
  expect(w.scene.overrideMaterial).toBeNull();
});

test("what only the plan draws shows in the Schwarzplan's frames alone", () => {
  const w = world();
  const planMaterial = new MeshBasicNodeMaterial();
  planMaterial.userData.figure = true;
  const plan = new Mesh(new BoxGeometry(), planMaterial);
  plan.visible = false;
  plan.userData.planOnly = true;
  w.scene.add(plan);
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  const papier = paper.begin("paper");
  expect(plan.visible).toBe(false);
  papier();
  const figure = paper.begin("figure");
  expect(plan.visible).toBe(true);
  // the plan's circles wear the figure's black, the solid is not drawn
  expect(paper.drawsAsPaper(plan, "figure")).toBe(true);
  expect(w.solid.visible).toBe(false);
  figure();
  expect(plan.visible).toBe(false);
});

test("a data mark's glass draws itself through every swap", () => {
  const w = world();
  const glass = new MeshBasicNodeMaterial({ transparent: true });
  glass.userData.paperOwn = true;
  const mark = new Mesh(new BoxGeometry(), glass);
  w.scene.add(mark);
  const paper = createPaperScene(w.scene, w.fog, fakeRenderer());
  for (const kind of ["paper", "line", "ink", "figure"] as const) {
    const restore = paper.begin(kind);
    // shown, in its own material: a see-through sheet that is not the
    // marks' stays hidden
    expect(mark.visible).toBe(true);
    expect(glass.allowOverride).toBe(false);
    expect(w.sheet.visible).toBe(false);
    restore();
    expect(glass.allowOverride).toBe(true);
  }
});

function ribbonWorld() {
  const w = world();
  const fence = new MeshStandardNodeMaterial({ side: DoubleSide });
  const wall = new MeshStandardNodeMaterial({ side: DoubleSide });
  const crown = new MeshStandardNodeMaterial();
  crown.maskNode = uniform(1).greaterThan(0.5);
  const fenceMesh = new Mesh(new BoxGeometry(), fence);
  const wallMesh = new Mesh(new BoxGeometry(), wall);
  const crownMesh = new Mesh(new BoxGeometry(), crown);
  w.scene.add(fenceMesh, wallMesh, crownMesh);
  const renderer = fakeRenderer();
  const paper = createPaperScene(w.scene, w.fog, renderer);
  return {
    ...w,
    crown,
    crownMesh,
    fence,
    fenceMesh,
    paper,
    renderer,
    wallMesh,
  };
}

test("a double-sided mesh draws a stand-in with its side", () => {
  const w = ribbonWorld();
  const restore = w.paper.begin();
  drawThrough(w.renderer, w.fenceMesh);
  drawThrough(w.renderer, w.wallMesh);
  drawThrough(w.renderer, w.crownMesh);
  drawThrough(w.renderer, w.solid);
  const [fence, wall, crown, solid] = w.renderer
    .drawn as MeshStandardNodeMaterial[];
  expect(fence.side).toBe(DoubleSide);
  expect(fence.allowOverride).toBe(false);
  expect(fence.colorNode).toBe(
    (w.scene.overrideMaterial as MeshStandardNodeMaterial).colorNode
  );
  // one per side and position, not one per mesh
  expect(wall).toBe(fence);
  // the card draws a bare crown whole: the pen would outline every gap
  expect(crown).toBe(w.crown);
  expect(solid).toBe(w.solid.material);
  restore();
  expect(w.renderer.getRenderObjectFunction()).toBeNull();
  // the mesh never changed its material: its slots stay readable
  expect(w.fenceMesh.material).toBe(w.fence);
});

test("the object function a frame found is what it draws through and restores", () => {
  const w = ribbonWorld();
  const seen: unknown[] = [];
  const outer = (...args: unknown[]) => {
    seen.push(args[4]);
  };
  w.renderer.setRenderObjectFunction(outer);
  const restore = w.paper.begin();
  drawThrough(w.renderer, w.fenceMesh);
  expect(seen[0]).not.toBe(w.fence);
  restore();
  expect(w.renderer.getRenderObjectFunction()).toBe(outer as never);
});

test("the Schwarzplan and a scene without ribbons set no object function", () => {
  const w = ribbonWorld();
  const restore = w.paper.begin("figure");
  expect(w.renderer.getRenderObjectFunction()).toBeNull();
  restore();
  const plain = world();
  const renderer = fakeRenderer();
  const paper = createPaperScene(plain.scene, plain.fog, renderer);
  const back = paper.begin();
  expect(renderer.getRenderObjectFunction()).toBeNull();
  back();
});

test("a stand-in leaves with the last mesh that wore it", () => {
  const w = ribbonWorld();
  w.paper.begin()();
  const restore = w.paper.begin();
  drawThrough(w.renderer, w.fenceMesh);
  restore();
  const standIn = w.renderer.drawn[0] as MeshStandardNodeMaterial;
  let freed = 0;
  standIn.addEventListener("dispose", () => {
    freed += 1;
  });
  w.scene.remove(w.fenceMesh, w.wallMesh);
  w.paper.sceneChanged();
  w.paper.begin()();
  expect(freed).toBe(1);
});

test("swapped compiles a ribbon's stand-in, and puts its material back", () => {
  const w = ribbonWorld();
  const during = w.paper.swapped(w.fenceMesh, () => w.fenceMesh.material);
  expect(during).not.toBe(w.fence);
  expect(during.side).toBe(DoubleSide);
  expect(during.allowOverride).toBe(false);
  expect(w.fenceMesh.material).toBe(w.fence);
  // a mesh the override draws faithfully compiles as it is
  expect(w.paper.swapped(w.solid, () => w.solid.material)).toBe(
    w.solid.material
  );
});

test("a landing tile's ribbon compiles its stand-in, and keeps it till it hangs", () => {
  const w = ribbonWorld();
  // not in the scene yet: its root hangs once it has compiled
  const landing = new Mesh(
    new BoxGeometry(),
    new MeshStandardNodeMaterial({ side: FrontSide })
  );
  const own = new MeshStandardNodeMaterial({ side: DoubleSide });
  own.positionNode = positionLocal.add(vec3(1, 0, 0));
  // a moving sheet's rest (flag-cloth.ts): its shadow is cast and looked
  // up there in the stand-in too
  own.castShadowPositionNode = positionLocal;
  own.receivedShadowPositionNode = positionLocal.add(vec3(0, 1, 0));
  landing.material = own;
  const compiled = w.paper.swapped(landing, () => landing.material);
  expect(compiled).not.toBe(own);
  expect(compiled.side).toBe(DoubleSide);
  expect(compiled.positionNode).toBe(own.positionNode);
  expect(compiled.castShadowPositionNode).toBe(own.castShadowPositionNode);
  expect(compiled.receivedShadowPositionNode).toBe(
    own.receivedShadowPositionNode
  );
  // another tile changes the scene before it hangs: the stand-in stays
  let freed = 0;
  compiled.addEventListener("dispose", () => {
    freed += 1;
  });
  w.paper.sceneChanged();
  w.paper.begin()();
  expect(freed).toBe(0);
  // it hangs: the frame draws the very stand-in it compiled
  w.scene.add(landing);
  w.paper.sceneChanged();
  const restore = w.paper.begin();
  drawThrough(w.renderer, landing);
  restore();
  expect(w.renderer.drawn.at(-1)).toBe(compiled);
  // the tile leaves and frees its material: its stand-in goes with it, even
  // with no Papier frame after
  w.scene.remove(landing);
  own.dispose();
  expect(freed).toBe(1);
});

test("a stand-in takes its source's cutout, not what a draw left on the card", () => {
  const w = ribbonWorld();
  // three leaves a drawn material's transparency on the override
  const card = w.paper.swapped(
    w.solid,
    () => w.scene.overrideMaterial as MeshStandardNodeMaterial
  );
  card.transparent = true;
  card.alphaTest = 0.7;
  const cut = new MeshStandardNodeMaterial({ side: DoubleSide });
  cut.alphaTest = 0.4;
  const panel = new Mesh(new BoxGeometry(), cut);
  const worn = w.paper.swapped(panel, () => panel.material);
  expect(worn.transparent).toBe(false);
  expect(worn.alphaTest).toBe(0.4);
  // and a cutout is its own stand-in, not the plain fence's
  const plain = w.paper.swapped(w.fenceMesh, () => w.fenceMesh.material);
  expect(plain).not.toBe(worn);
  expect(plain.alphaTest).toBe(0);
  card.transparent = false;
  card.alphaTest = 0;
});
