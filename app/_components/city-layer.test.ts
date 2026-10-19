import { expect, test } from "bun:test";
import {
  BoxGeometry,
  BufferAttribute,
  Mesh,
  MeshBasicNodeMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
// three-mesh-bvh's wiring (computeBoundsTree, the accelerated raycast)
import "./collision";
import {
  type CityLayer,
  cityObjectsAlong,
  ensureCityBvh,
  nearestCityHit,
  nearestWithoutBvh,
} from "./city-layer";

type CountedLayer = CityLayer & { builds: number };

/** A building tile stand-in: one 10 m cube centred at x on the x axis
 *  (and one more at each of `also`, metres along x from it: one mesh, as
 *  a tile's houses are), counting the BVH builds it is asked for. */
function tile(
  name: string,
  x: number,
  bvh = false,
  also: readonly number[] = []
): CountedLayer {
  const geometry = mergeGeometries(
    [0, ...also].map((dx) => new BoxGeometry(10, 10, 10).translate(dx, 0, 0))
  );
  const vertices = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "featureId",
    new BufferAttribute(new Float32Array(vertices), 1)
  );
  const mesh = new Mesh(geometry, new MeshBasicNodeMaterial());
  mesh.position.set(x, 5, 0);
  mesh.updateMatrixWorld(true);
  const layer = {
    tile: name,
    mesh,
    table: {
      ensemble: new Uint32Array([0]),
      group: new Uint32Array([0]),
      root: new Uint32Array([0]),
    },
    builds: 0,
    hasBvh: () => Boolean(geometry.boundsTree),
    ensureBvh: () => {
      if (!geometry.boundsTree) {
        layer.builds++;
      }
      ensureCityBvh(mesh);
    },
  };
  if (bvh) {
    ensureCityBvh(mesh);
  }
  return layer as unknown as CountedLayer;
}

/** A ray from the origin at y = 5 along +x. */
function rayAlongX(far: number): Raycaster {
  const raycaster = new Raycaster(new Vector3(0, 5, 0), new Vector3(1, 0, 0));
  raycaster.far = far;
  raycaster.firstHitOnly = true;
  return raycaster;
}

test("a pick builds the tiles its ray reaches up to its first hit, and none past it", () => {
  const near = tile("near", 20);
  const far = tile("far", 200);
  const aside = tile("aside", 20);
  aside.mesh.position.z = 500;
  aside.mesh.updateMatrixWorld(true);
  const found = nearestCityHit(rayAlongX(1000), [far, aside, near], true);
  expect(found?.layer).toBe(near);
  expect(found?.hit.distance).toBeCloseTo(15, 5);
  expect([near.builds, far.builds, aside.builds]).toEqual([1, 0, 0]);
});

test("the autofocus asks only the tiles with a BVH, and builds none", () => {
  const near = tile("near", 20);
  const far = tile("far", 200, true);
  const found = nearestCityHit(rayAlongX(1000), [near, far], false);
  expect(found?.layer).toBe(far);
  expect(found?.hit.distance).toBeCloseTo(195, 5);
  expect(near.builds).toBe(0);
  expect(near.hasBvh()).toBe(false);
});

test("the probe's candidates: built up to the first hit, a built tile behind it still offered, nothing past the ground", () => {
  const camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  camera.position.set(0, 5, 0);
  camera.lookAt(1, 5, 0);
  camera.updateMatrixWorld(true);
  const near = tile("near", 20);
  const behind = tile("behind", 50);
  const built = tile("built", 80, true);
  const hits = cityObjectsAlong(camera, [built, behind, near]);
  expect(hits.map((h) => h.layer.tile)).toEqual(["near", "built"]);
  expect([near.builds, behind.builds]).toEqual([1, 0]);
  // the ground at 30 m: the built tile behind it is out of the question
  expect(
    cityObjectsAlong(camera, [built, behind, near], undefined, 30).map(
      (h) => h.layer.tile
    )
  ).toEqual(["near"]);
});

test("a ray from inside a tile's box asks that tile first: its nearer hit is not passed over for a neighbour's", () => {
  // the eye stands in the tile `here` (houses at -20, 10 and 60: its box
  // runs from -25 to 65); the neighbour's box begins at 25
  const here = tile("here", 10, false, [-30, 50]);
  const next = tile("next", 30, true);
  const found = nearestCityHit(rayAlongX(1000), [next, here], true);
  expect(found?.layer).toBe(here);
  expect(found?.hit.distance).toBeCloseTo(5, 5);
  // the probe builds the tile it stands in, and offers the built one
  // behind
  const camera = new PerspectiveCamera(55, 1, 0.1, 6000);
  camera.position.set(0, 5, 0);
  camera.lookAt(1, 5, 0);
  camera.updateMatrixWorld(true);
  const inside = tile("inside", 10, false, [-30, 50]);
  const hits = cityObjectsAlong(camera, [next, inside]);
  expect(hits.map((h) => h.layer.tile)).toEqual(["inside", "next"]);
  expect(inside.builds).toBe(1);
});

test("the tile built next in idle time is the nearest without a BVH within reach", () => {
  const near = tile("near", 20);
  const far = tile("far", 300);
  expect(nearestWithoutBvh([far, near], 0, 0, 400)).toBe(near);
  near.ensureBvh();
  expect(nearestWithoutBvh([far, near], 0, 0, 400)).toBe(far);
  expect(nearestWithoutBvh([far, near], 0, 0, 100)).toBeNull();
  // standing inside a tile's box is distance 0
  expect(nearestWithoutBvh([far], 300, 0, 0)).toBe(far);
});
