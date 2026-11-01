import { expect, test } from "bun:test";
import type { FootprintPoly } from "@/lib/city/minimap";
import type { CityWalkStats } from "./create-app";
import type { ModelHud } from "./model-rig";
import {
  createSceneStatus,
  NO_PROGRESS,
  sceneReports,
  withStage,
} from "./scene-status";

function stats(buildingCount: number): CityWalkStats {
  return {
    buildingCount,
    gpuMegabytes: 120,
    // the census is rebuilt on every pass: never the same object
    layerStats: {} as CityWalkStats["layerStats"],
    shadowsEnabled: true,
    terrainVertexCount: 5000,
  };
}

function wire(polys?: FootprintPoly[]) {
  const status = createSceneStatus();
  let live = true;
  const reports = sceneReports(status, {
    footprints: () => polys,
    live: () => live,
  });
  return { status, reports, drop: () => (live = false) };
}

test("each report writes its own slice, and only that one is heard", () => {
  const { status, reports } = wire();
  const heard: string[] = [];
  status.subscribe("busy", () => heard.push("busy"));
  status.subscribe("stats", () => heard.push("stats"));
  status.subscribe("fps", () => heard.push("fps"));
  reports.onBusy(true);
  reports.onFps(59.6);
  expect(status.get("busy")).toBe(true);
  expect(status.get("fps")).toBe(60);
  expect(heard).toEqual(["busy", "fps"]);
});

test("a dropped boot's late reports change nothing", () => {
  const { status, reports, drop } = wire();
  drop();
  reports.onStage({ id: "buildings", fraction: 0.5 });
  reports.onError("tile 404");
  reports.onFatal("device lost");
  reports.onModeChange("fly");
  expect(status.get("progress")).toBe(NO_PROGRESS);
  expect(status.get("streamError")).toBeNull();
  expect(status.get("gpuFailure")).toBeNull();
  expect(status.get("mode")).toBe("walk");
});

test("after a fatal report a late tile failure adds no hole under its card", () => {
  const { status, reports } = wire();
  reports.onError("tile 404");
  expect(status.get("streamError")).toContain("tile 404");
  reports.onFatal("device lost");
  reports.onErrorCleared();
  reports.onError("another tile");
  expect(status.get("gpuFailure")).toBe("device lost");
  expect(status.get("streamError")).toContain("tile 404");
});

test("a stats pass with the same counters is no change, and the footprints stay the same array", () => {
  const polys: FootprintPoly[] = [];
  const { status, reports } = wire(polys);
  const heard: string[] = [];
  status.subscribe("stats", () => heard.push("stats"));
  status.subscribe("footprints", () => heard.push("footprints"));
  reports.onStats(stats(10));
  reports.onStats(stats(10));
  expect(status.get("stats")).toEqual({
    buildingCount: 10,
    gpuMegabytes: 120,
    terrainVertexCount: 5000,
  });
  expect(status.get("footprints")).toBe(polys);
  expect(heard).toEqual(["stats", "footprints"]);
  reports.onStats(stats(11));
  expect(heard).toEqual(["stats", "footprints", "stats"]);
});

test("Modell's view rebuilt with the same numbers is no change", () => {
  const { status, reports } = wire();
  const view = (scale: number): ModelHud => ({
    preset: "iso",
    turnDeg: 30,
    tiltDeg: 35,
    scale,
    metresPerPixel: 0.5,
    shear: 0,
    pivot: { x: 1, y: 2, z: 3 },
    footprint: [{ x: 0, y: 0, z: 0 }],
    transitioning: false,
    cutOut: false,
    cutOutPending: false,
    cutOutFailed: false,
  });
  let heard = 0;
  status.subscribe("modelView", () => heard++);
  reports.onModelView(view(1000));
  reports.onModelView(view(1000));
  reports.onModelView(view(2000));
  reports.onModelView(null);
  expect(heard).toBe(3);
});

test("the stages merge one by one, and a skipped one stays skipped", () => {
  const { status, reports } = wire();
  reports.onStage({ id: "buildings", fraction: 0.4 });
  reports.onStage({ id: "surroundings", fraction: 0, skipped: true });
  reports.onStage({ id: "buildings", fraction: 1 });
  expect(status.get("progress")).toEqual({
    fractions: { buildings: 1, surroundings: 0 },
    skipped: { surroundings: true },
  });
  // a report without the flag keeps the stages' skipped object
  const prev = status.get("progress");
  expect(withStage(prev, { id: "terrain", fraction: 1 }).skipped).toBe(
    prev.skipped
  );
});

test("an inquiry is kept with what its ray met, and cleared by none", () => {
  const { status, reports } = wire();
  const asked = { kind: "building" } as never;
  reports.onInquiry(asked, null);
  expect(status.get("inquiry")).toEqual({
    inquiry: asked,
    along: null,
    picked: { active: 0, adding: false, picks: [asked] },
  });
  reports.onInquiry(null, null);
  expect(status.get("inquiry")).toBeNull();
});
