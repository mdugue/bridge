import { describe, expect, test } from "bun:test";
import {
  PerspectiveCamera,
  Vector3,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
} from "three/webgpu";
import {
  MODEL_PRESETS,
  MODEL_STANDOFF,
  type ModelView,
  modelCameraGeometry,
  modelRay,
  withPreset,
} from "@/lib/city/model-view";
import { ModelCamera } from "./model-camera";
import { setViewDirection, viewParallel, viewRay } from "./view-direction";
import { parallelDirection } from "./view-ray";

const VIEWPORT = { width: 1100, height: 700 };
const BASE: ModelView = {
  pivot: { x: -383.2, y: 116, z: -995.5 },
  preset: "iso",
  turnDeg: 30,
  tiltDeg: 35,
  metresPerPixel: 0.1,
  shear: 0,
  cut: false,
};

function cameraFor(view: ModelView, system: number): ModelCamera {
  const camera = new ModelCamera();
  camera.coordinateSystem = system as ModelCamera["coordinateSystem"];
  camera.setGeometry(modelCameraGeometry(view, VIEWPORT), MODEL_STANDOFF);
  return camera;
}

describe("a parallel camera's view direction", () => {
  for (const preset of MODEL_PRESETS) {
    for (const [name, system] of [
      ["WebGL", WebGLCoordinateSystem],
      ["WebGPU", WebGPUCoordinateSystem],
    ] as const) {
      test(`${preset.id} (${name} depth): the direction its rays run`, () => {
        const view = withPreset(BASE, preset.id);
        const want = modelRay(view, VIEWPORT, { x: 0.3, y: -0.2 }).direction;
        const got = parallelDirection(cameraFor(view, system), new Vector3());
        expect(got.x).toBeCloseTo(want.x, 6);
        expect(got.y).toBeCloseTo(want.y, 6);
        expect(got.z).toBeCloseTo(want.z, 6);
      });
    }
  }

  test("a Militärperspektive looks in at 45°, not down its forward", () => {
    const view = withPreset(BASE, "military");
    const got = parallelDirection(
      cameraFor(view, WebGLCoordinateSystem),
      new Vector3()
    );
    expect(got.y).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});

describe("setViewDirection", () => {
  test("a parallel camera hands the materials its one direction", () => {
    const view = withPreset(BASE, "military");
    setViewDirection(cameraFor(view, WebGLCoordinateSystem));
    const want = modelRay(view, VIEWPORT, { x: 0, y: 0 }).direction;
    expect(viewParallel.value).toBe(1);
    expect(viewRay.value.x).toBeCloseTo(want.x, 6);
    expect(viewRay.value.y).toBeCloseTo(want.y, 6);
    expect(viewRay.value.z).toBeCloseTo(want.z, 6);
  });

  test("a perspective camera, its place", () => {
    setViewDirection(new PerspectiveCamera());
    expect(viewParallel.value).toBe(0);
  });
});
