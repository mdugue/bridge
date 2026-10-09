import { expect, test } from "bun:test";
import { bootingPose, startOf } from "./boot-start";
import type { CameraState } from "./pose";
import type { ViewpointGeometry } from "./site";

const offset = { cx: 3000, cy: 0 };
const tiles = [
  { id: "spawn", bounds: [2000, 0, 4000, 2000] as const },
  { id: "east", bounds: [4000, 0, 6000, 2000] as const },
];
const view = (x: number, over: Partial<ViewpointGeometry> = {}) =>
  ({
    aboveGround: 1.7,
    epsg: { x, y: 1000 },
    fov: 60,
    headingDeg: 90,
    mode: "walk",
    pitchDeg: 0,
    ...over,
  }) satisfies ViewpointGeometry;
const camera: CameraState = {
  epsg: { x: 5000, y: 1000 },
  fov: 55,
  headingDeg: 180,
  mode: "walk",
  pitchDeg: 5,
  pos: { x: 2000, y: 121.7, z: -1000 },
};

test("a camera wins over a picked place, each only on a tile", () => {
  expect(startOf({}, tiles)).toEqual({ spawn: tiles[0] });
  expect(startOf({ initialView: view(4500) }, tiles)).toEqual({
    picked: view(4500),
    spawn: tiles[1],
  });
  expect(
    startOf({ initialCamera: camera, initialView: view(2500) }, tiles)
  ).toEqual({ restored: camera, spawn: tiles[1] });
  // off every tile: the spawn's
  expect(startOf({ initialView: view(9000) }, tiles)).toEqual({
    spawn: tiles[0],
  });
});

test("the spawn boots on its own vantage", () => {
  expect(bootingPose({}, view(3000), 250, offset)).toEqual({
    view: view(3000),
  });
});

test("a recovered camera keeps its height and looks down onto its tile", () => {
  expect(bootingPose({ restored: camera }, view(3000), 250, offset)).toEqual({
    camera: { ...camera, pitchDeg: -90 },
  });
});

test("a picked place boots above its tile's top, looking down, in the air", () => {
  // A walk spot: its height over a ground not yet known would put the
  // camera below the tile's box, out of any view of it.
  const pose = bootingPose(
    { picked: view(4500, { pitchDeg: 10 }) },
    view(3000),
    340,
    offset
  );
  expect(pose).toEqual({
    camera: {
      epsg: { x: 4500, y: 1000 },
      fov: 60,
      headingDeg: 90,
      mode: "fly",
      pitchDeg: -90,
      pos: { x: 1500, y: 341.7, z: -1000 },
    },
  });
  // above the top by its height over the ground
  const overlook = bootingPose(
    { picked: view(4500, { aboveGround: 45, mode: "fly", pitchDeg: -30 }) },
    view(3000),
    340,
    offset
  );
  expect("camera" in overlook && overlook.camera.pos.y).toBe(385);
});

test("without its tile's top a picked place boots on its own vantage", () => {
  expect(
    bootingPose({ picked: view(4500) }, view(3000), undefined, offset)
  ).toEqual({ view: view(4500) });
});
