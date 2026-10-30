import { expect, test } from "bun:test";
import { SCENE_TOOLS } from "@/lib/city/ask-tools";
import {
  AERIAL_REACH,
  type AskScene,
  sceneTools,
  showPlaces,
} from "./ask-scene-tools";
import type { ViewpointGeometry } from "@/lib/city/site";

const STUB: AskScene = {
  from: () => null,
  frame: () => ({ aspect: 1.5 }),
  look: () => ({}),
  river: null,
  setFlood: () => undefined,
  setVolume: () => true,
  setLayer: () => true,
  setListening: () => undefined,
  setStyle: () => undefined,
  setTime: () => "",
  select: () => undefined,
  show: () => undefined,
  where: () => ({}),
};

test("the card runs every scene tool the server hands the browser", () => {
  // one it does not bind leaves the run waiting for ever
  const bound = sceneTools(STUB).map((t) => t.name);
  expect(bound.sort((a, b) => a.localeCompare(b))).toEqual(
    SCENE_TOOLS.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  );
});

test("a box is taken away with aus alone, and not placed off the loaded ground", async () => {
  const placed: unknown[] = [];
  const tools = sceneTools({
    ...STUB,
    setVolume: (v) => {
      placed.push(v);
      return v === null;
    },
  });
  const tool = tools.find((t) => t.name === "plane_baukoerper")!;
  expect(await tool.execute!({ aus: true })).toEqual({ ok: true });
  const off = (await tool.execute!({
    x: 1,
    y: 2,
    breite: 10,
    tiefe: 10,
    hoehe: 20,
  })) as { ok: boolean };
  expect(off.ok).toBe(false);
  expect(placed).toHaveLength(2);
});

test("zeige frames the places together, or the first alone when they lie too far apart", () => {
  const shown: ViewpointGeometry[] = [];
  const scene = { ...STUB, show: (v: ViewpointGeometry) => shown.push(v) };
  const near = [
    { name: "Kreuzkirche", x: 0, y: 0, z: 110, h: 90, r: 30 },
    { name: "Frauenkirche", x: 250, y: 150, z: 112, h: 90, r: 30 },
  ];
  const together = showPlaces(scene, { ziele: near });
  expect(together.gezeigt).toEqual(["Kreuzkirche", "Frauenkirche"]);
  expect(together.abstand_m as number).toBeLessThanOrEqual(AERIAL_REACH);
  const far = [near[0], { ...near[1], x: 4000 }];
  const apart = showPlaces(scene, { ziele: far });
  expect(apart.gezeigt).toEqual(["Kreuzkirche"]);
  expect(apart.hinweis).toBeDefined();
  expect(showPlaces(scene, { ziele: near, alle: false }).gezeigt).toEqual([
    "Kreuzkirche",
  ]);
  const street = showPlaces(scene, { ziele: near, aus_der_luft: false });
  expect(street.gezeigt).toEqual(["Kreuzkirche"]);
  expect(shown.at(-1)?.mode).toBe("walk");
  expect(shown.slice(0, 3).every((v) => v.mode === "fly")).toBe(true);
});

test("what an answer shows is selected: all of them, or the answer alone", () => {
  const selected: (readonly { x: number; y: number }[])[] = [];
  const scene = {
    ...STUB,
    select: (p: readonly { x: number; y: number }[]) => selected.push(p),
  };
  const ziele = [
    { name: "A", x: 0, y: 0 },
    { name: "B", x: 60, y: 0 },
    { name: "C", x: 5000, y: 0 },
  ];
  showPlaces(scene, { ziele: ziele.slice(0, 2) });
  showPlaces(scene, { ziele, alle: false });
  // spread too far for one view: still every place selected
  showPlaces(scene, { ziele });
  showPlaces(scene, { ziele: ziele.slice(0, 2), aus_der_luft: false });
  expect(selected.map((s) => s.length)).toEqual([2, 1, 3, 2]);
});
