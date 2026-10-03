import { describe, expect, test } from "bun:test";
import {
  dollyFrame,
  DOLLY_END_FOV_DEG,
  enteringView,
  fitModelShadow,
  footprintCircle,
  headingDelta,
  ISO_TILT_DEG,
  leavingPose,
  MODEL_PRESET_BY_ID,
  MODEL_SCALE_MAX,
  MODEL_SCALE_MIN,
  MODEL_SHADOW_MAX,
  MODEL_SHADOW_MIN,
  type ModelPresetId,
  type ModelView,
  metresPerPixelOf,
  modelCameraGeometry,
  modelFootprint,
  modelRay,
  northArrowDeg,
  panned,
  rayAtLevel,
  scaleBarFor,
  scaleLabel,
  scaleOf,
  screenOfPoint,
  snapTilt,
  snapTurn,
  viewBetween,
  withPreset,
  zoomedAbout,
} from "./model-view";
import { DEG2RAD, directionOf } from "./pose";

const VIEWPORT = { width: 1600, height: 900 };

function viewOf(preset: ModelPresetId, turnDeg = 45): ModelView {
  return withPreset(
    {
      pivot: { x: 120, y: 112, z: -340 },
      preset,
      turnDeg,
      tiltDeg: 0,
      metresPerPixel: metresPerPixelOf(2500),
      shear: 0,
      cut: false,
    },
    preset
  );
}

/** A point's screen position in CSS px (y down), for drag arithmetic. */
function pxOf(view: ModelView, p: { x: number; y: number; z: number }) {
  const s = screenOfPoint(view, VIEWPORT, p);
  return {
    x: ((s.x + 1) / 2) * VIEWPORT.width,
    y: ((1 - s.y) / 2) * VIEWPORT.height,
  };
}

describe("the scale", () => {
  test("a denominator and metres per CSS pixel round-trip at 96 dpi", () => {
    expect(metresPerPixelOf(1000)).toBeCloseTo(0.264_583, 5);
    expect(scaleOf(metresPerPixelOf(2500))).toBeCloseTo(2500, 6);
  });

  test("the label rounds to two significant digits with thin groups", () => {
    expect(scaleLabel(2953)).toBe("1 : 3 000");
    expect(scaleLabel(500)).toBe("1 : 500");
    expect(scaleLabel(12_345)).toBe("1 : 12 000");
  });

  test("the scale bar is a round length that fits, labelled at 0, ½ and the end", () => {
    const bar = scaleBarFor(0.66, 160);
    expect(bar.metres).toBe(100);
    expect(bar.px).toBeLessThanOrEqual(160);
    expect(bar.labels).toEqual(["0", "50", "100 m"]);
    const far = scaleBarFor(6.6, 160);
    expect(far.metres).toBe(1000);
    expect(far.labels).toEqual(["0", "0,5", "1 km"]);
  });
});

describe("the views", () => {
  test("the isometric shortens the three axes alike and draws the ground axes at 30°", () => {
    const view = viewOf("iso", 45);
    const o = view.pivot;
    const east = pxOf(view, { x: o.x + 100, y: o.y, z: o.z });
    const south = pxOf(view, { x: o.x, y: o.y, z: o.z + 100 });
    const up = pxOf(view, { x: o.x, y: o.y + 100, z: o.z });
    const c = pxOf(view, o);
    const len = (p: { x: number; y: number }) =>
      Math.hypot(p.x - c.x, p.y - c.y);
    expect(len(east)).toBeCloseTo(len(south), 6);
    expect(len(east)).toBeCloseTo(len(up), 6);
    // an edge along a ground axis runs at 30° to the sheet's horizontal
    const angle = (p: { x: number; y: number }) =>
      (Math.atan2(Math.abs(p.y - c.y), Math.abs(p.x - c.x)) * 180) / Math.PI;
    expect(angle(east)).toBeCloseTo(30, 6);
    expect(angle(south)).toBeCloseTo(30, 6);
    expect(view.tiltDeg).toBeCloseTo(35.264, 3);
  });

  test("entering the isometric snaps the turn to the diagonals", () => {
    expect(viewOf("iso", 100).turnDeg).toBe(135);
    expect(viewOf("iso", 10).turnDeg).toBe(45);
    expect(viewOf("bird", 100).turnDeg).toBe(100);
    expect(viewOf("plan", 100).turnDeg).toBe(0);
  });

  test("the plan looks straight down, north up, without NaN", () => {
    const view = viewOf("plan");
    const g = modelCameraGeometry(view, VIEWPORT);
    for (const v of [g.position, g.right, g.up, g.forward]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    }
    const north = screenOfPoint(view, VIEWPORT, {
      x: view.pivot.x,
      y: view.pivot.y,
      z: view.pivot.z - 50,
    });
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeGreaterThan(0);
    expect(northArrowDeg(view)).toBe(0);
    expect(northArrowDeg({ turnDeg: 30 })).toBe(330);
  });

  test("the Militärperspektive keeps the plan true and stands heights up", () => {
    const view = viewOf("military", 30);
    const o = view.pivot;
    // a ground square stays a square (same side length, right angles)
    const a = pxOf(view, o);
    const b = pxOf(view, { x: o.x + 80, y: o.y, z: o.z });
    const d = pxOf(view, { x: o.x, y: o.y, z: o.z - 80 });
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const ad = { x: d.x - a.x, y: d.y - a.y };
    expect(Math.hypot(ab.x, ab.y)).toBeCloseTo(Math.hypot(ad.x, ad.y), 6);
    expect(ab.x * ad.x + ab.y * ad.y).toBeCloseTo(0, 6);
    // a point 30 m up shows 30 m higher, straight up the sheet
    const top = pxOf(view, { x: o.x, y: o.y + 30, z: o.z });
    expect(top.x).toBeCloseTo(a.x, 6);
    expect(a.y - top.y).toBeCloseTo(30 / view.metresPerPixel, 6);
  });

  test("a ray through a screen point meets the ground that projects back there", () => {
    for (const preset of ["iso", "bird", "military", "plan"] as const) {
      const view = viewOf(preset, 70);
      for (const ndc of [
        { x: 0, y: 0 },
        { x: 0.7, y: -0.4 },
        { x: -0.9, y: 0.8 },
      ]) {
        const ground = rayAtLevel(modelRay(view, VIEWPORT, ndc), 95);
        expect(ground).not.toBeNull();
        const back = screenOfPoint(view, VIEWPORT, ground!);
        expect(back.x).toBeCloseTo(ndc.x, 6);
        expect(back.y).toBeCloseTo(ndc.y, 6);
      }
    }
  });

  test("the Ansicht cuts at the pivot and shows it a quarter up the picture", () => {
    const view = viewOf("elevation", 180);
    const g = modelCameraGeometry(view, VIEWPORT);
    const back = Math.hypot(
      view.pivot.x - g.position.x,
      view.pivot.y - g.position.y,
      view.pivot.z - g.position.z
    );
    expect(g.near).toBeCloseTo(back, 6);
    expect(screenOfPoint(view, VIEWPORT, view.pivot).y).toBeCloseTo(-0.5, 9);
    expect(view.tiltDeg).toBe(0);
  });
});

describe("pan, zoom, turn and tilt", () => {
  test("a drag moves the ground under the pointer with the pointer", () => {
    const view = viewOf("bird", 20);
    const spot = rayAtLevel(
      modelRay(view, VIEWPORT, { x: 0.3, y: -0.2 }),
      view.pivot.y
    )!;
    const before = pxOf(view, spot);
    const moved = { ...view, pivot: panned(view, 40, -25) };
    const after = pxOf(moved, spot);
    expect(after.x - before.x).toBeCloseTo(40, 6);
    expect(after.y - before.y).toBeCloseTo(-25, 6);
  });

  test("zooming keeps the point under the pointer and clamps the scale", () => {
    const view = viewOf("iso", 45);
    const ndc = { x: -0.5, y: 0.35 };
    const spot = rayAtLevel(modelRay(view, VIEWPORT, ndc), view.pivot.y)!;
    const z = zoomedAbout(view, VIEWPORT, ndc, 2);
    expect(z.metresPerPixel).toBeCloseTo(view.metresPerPixel / 2, 9);
    const after = screenOfPoint({ ...view, ...z }, VIEWPORT, spot);
    expect(after.x).toBeCloseTo(ndc.x, 6);
    expect(after.y).toBeCloseTo(ndc.y, 6);
    expect(zoomedAbout(view, VIEWPORT, ndc, 1e6).metresPerPixel).toBeCloseTo(
      metresPerPixelOf(MODEL_SCALE_MIN),
      9
    );
    expect(zoomedAbout(view, VIEWPORT, ndc, 1e-6).metresPerPixel).toBeCloseTo(
      metresPerPixelOf(MODEL_SCALE_MAX),
      9
    );
  });

  test("turns snap to their steps, tilts to the presets' angles", () => {
    expect(snapTurn(52, 0, 15)).toBe(45);
    expect(snapTurn(-50, 45, 90)).toBe(315);
    expect(snapTilt(36)).toBeCloseTo(ISO_TILT_DEG, 9);
    expect(snapTilt(51)).toBe(51);
    expect(snapTilt(1)).toBe(5);
    expect(headingDelta(350, 10)).toBe(20);
    expect(headingDelta(10, 350)).toBe(-20);
  });

  test("a preset switch glides through valid views", () => {
    const a = viewOf("iso", 45);
    const b = viewOf("military", 30);
    const mid = viewBetween(a, b, 0.5);
    expect(mid.tiltDeg).toBeGreaterThan(a.tiltDeg);
    expect(mid.tiltDeg).toBeLessThan(b.tiltDeg);
    expect(mid.shear).toBeGreaterThan(0);
    expect(mid.shear).toBeLessThan(1);
    expect(viewBetween(a, b, 1)).toEqual(b);
  });
});

describe("shadows", () => {
  test("the footprint is the ground at the picture's corners", () => {
    const view = viewOf("iso", 45);
    const foot = modelFootprint(view, VIEWPORT);
    expect(foot).toHaveLength(4);
    const corners = foot.map((p) => screenOfPoint(view, VIEWPORT, p));
    for (const c of corners) {
      expect(Math.abs(c.x)).toBeCloseTo(1, 6);
      expect(Math.abs(c.y)).toBeCloseTo(1, 6);
    }
    const circle = footprintCircle(foot);
    expect(circle.radius).toBeGreaterThan(
      VIEWPORT.width * view.metresPerPixel * 0.5
    );
  });

  test("the frustum covers the footprint in half octaves, holds near a step and caps", () => {
    const r = fitModelShadow(500, MODEL_SHADOW_MIN);
    expect(r).toBeGreaterThanOrEqual(500);
    expect(r).toBeLessThan(500 * Math.SQRT2 + 1);
    // a little smaller does not shrink it, a little larger does not grow it
    expect(fitModelShadow(470, r)).toBe(r);
    expect(fitModelShadow(r * 1.05, r)).toBe(r);
    expect(fitModelShadow(1e5, r)).toBe(MODEL_SHADOW_MAX);
    expect(fitModelShadow(1e5, r, 880)).toBe(880);
    expect(fitModelShadow(1, r)).toBe(MODEL_SHADOW_MIN);
  });
});

describe("in and out of the perspective view", () => {
  const pose = {
    position: { x: 0, y: 160, z: 0 },
    headingDeg: 40,
    pitchDeg: -30,
    fovDeg: 55,
  };
  const dir = directionOf(40 * DEG2RAD, -30 * DEG2RAD);
  const pivot = {
    x: dir.x * 100,
    y: 160 + dir.y * 100,
    z: dir.z * 100,
  };

  test("entering keeps the place and the picture's size at the pivot", () => {
    const view = enteringView(pose, pivot, "iso", 900);
    expect(view.pivot).toEqual(pivot);
    expect(view.turnDeg).toBe(45);
    const height = 2 * 100 * Math.tan((55 * DEG2RAD) / 2);
    expect(view.metresPerPixel).toBeCloseTo(height / 900, 9);
  });

  test("the dolly zoom starts at the pose and ends looking at the pivot, the picture the view's", () => {
    const view = enteringView(pose, pivot, "iso", 900);
    const f0 = dollyFrame(pose, 100, view, 900, 0);
    expect(f0.position.x).toBeCloseTo(0, 6);
    expect(f0.position.y).toBeCloseTo(160, 6);
    expect(f0.position.z).toBeCloseTo(0, 6);
    expect(f0.fovDeg).toBeCloseTo(55, 9);
    const f1 = dollyFrame(pose, 100, view, 900, 1);
    expect(f1.fovDeg).toBeCloseTo(DOLLY_END_FOV_DEG, 9);
    expect(f1.pitchDeg).toBeCloseTo(-ISO_TILT_DEG, 9);
    const d = directionOf(f1.headingDeg * DEG2RAD, f1.pitchDeg * DEG2RAD);
    const looked = {
      x: f1.position.x + d.x * f1.distance,
      y: f1.position.y + d.y * f1.distance,
      z: f1.position.z + d.z * f1.distance,
    };
    expect(looked.x).toBeCloseTo(pivot.x, 6);
    expect(looked.y).toBeCloseTo(pivot.y, 6);
    expect(looked.z).toBeCloseTo(pivot.z, 6);
    const height = 2 * f1.distance * Math.tan((f1.fovDeg * DEG2RAD) / 2);
    expect(height).toBeCloseTo(view.metresPerPixel * 900, 6);
    expect(f1.near).toBeLessThan(f1.distance);
    expect(f1.far).toBeGreaterThan(f1.distance);
  });

  test("leaving from far away flies over the pivot, looking the same way", () => {
    const view = viewOf("plan", 0);
    const out = leavingPose(view, 900, 55);
    expect(out.pitchDeg).toBe(-60);
    expect(out.headingDeg).toBe(0);
    const d = directionOf(0, -60 * DEG2RAD);
    expect(out.position.x + d.x * out.lookDistance).toBeCloseTo(
      view.pivot.x,
      6
    );
    expect(out.position.y + d.y * out.lookDistance).toBeCloseTo(
      view.pivot.y,
      6
    );
  });

  test("every preset has a card and a valid tilt", () => {
    for (const p of Object.values(MODEL_PRESET_BY_ID)) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.tiltDeg).toBeGreaterThanOrEqual(0);
      expect(p.tiltDeg).toBeLessThanOrEqual(90);
    }
  });
});
