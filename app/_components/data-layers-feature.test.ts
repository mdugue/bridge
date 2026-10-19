import { expect, test } from "bun:test";
import { Object3D } from "three/webgpu";
import { createLookState } from "@/lib/city/look-state";
import type { TrafficHourStatus } from "@/lib/city/traffic-hours";
import { startDataLayers } from "./data-layers-feature";
import { createHook, createWatch, type SceneClock } from "./feature-seam";

test("data layers that start late catch up with the look and the clock, and let go of the hooks", () => {
  const frame = createHook<[number, number]>();
  const look = createLookState();
  // the HUD set 07:00 an hour before the first switch-on
  const clock = createWatch<SceneClock>({
    date: new Date(2026, 9, 1, 7, 0),
    atMs: performance.now() - 3_600_000,
  });
  look.set({ trafficLayer: true });
  const hours: (TrafficHourStatus | null)[] = [];
  const layers = startDataLayers(
    { frame, streamChange: createHook(), look, clock },
    {
      bounds: [408_000, 5_654_000, 418_000, 5_660_000],
      bridgeUrls: [],
      compile: () => Promise.resolve(),
      epsg: 25_833,
      ground: { offset: { cx: 0, cy: 0 }, heightAt: () => 0 },
      onTrafficHour: (status) => hours.push(status),
      parent: new Object3D(),
    }
  );
  // the clock ran on from the instant the HUD set, not from the start
  expect(layers.trafficHour().time).toBe("08:00");
  // the traffic was on before the start: its hour goes to the HUD
  frame.emit(0, performance.now());
  expect(hours.at(-1)?.time).toBe("08:00");
  // and the HUD's next instant is heard
  clock.set({ date: new Date(2026, 9, 1, 17, 30), atMs: performance.now() });
  expect(layers.trafficHour().time).toBe("17:30");
  layers.dispose();
  const heard = hours.length;
  frame.emit(1, performance.now() + 2000);
  look.set({ trafficLayer: false });
  expect(hours).toHaveLength(heard);
});
