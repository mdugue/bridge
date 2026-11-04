import { expect, test } from "bun:test";
import { SCENE_TOOLS } from "@/lib/city/ask-tools";
import { AERIAL_REACH, sceneTools, showPlaces } from "./ask-scene-tools";
import type { AskScene } from "./ask-scene-tools";
import type { ViewpointGeometry } from "@/lib/city/site";

const STUB: AskScene = {
  abandon: () => {},
  from: () => null,
  frame: () => ({ aspect: 1.5 }),
  look: async () => ({}),
  setLayer: () => true,
  setListening: () => {},
  setStyle: () => {},
  setTime: () => "",
  show: () => true,
  within: () => true,
  where: () => ({}),
};

test("the card runs every scene tool the server hands the browser", () => {
  // one it does not bind leaves the run waiting for ever
  const bound = sceneTools(STUB).map((t) => t.name);
  expect(bound.sort((a, b) => a.localeCompare(b))).toEqual(
    SCENE_TOOLS.map((t) => t.name).sort((a, b) => a.localeCompare(b))
  );
});

test("zeige frames the places together, or the first alone when they lie too far apart", () => {
  const shown: ViewpointGeometry[] = [];
  const scene = {
    ...STUB,
    show: (v: ViewpointGeometry) => {
      shown.push(v);
      return true;
    },
  };
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

test("zeige leaves out places off the city, refuses when none is on it, and waits for the scene", () => {
  const place = { name: "Kreuzkirche", x: 0, y: 0, z: 110, h: 90, r: 30 };
  const off = { ...place, name: "Weit weg", x: 51, y: 13 };
  const inside = { ...STUB, within: (x: number) => x === 0 };
  expect(showPlaces(inside, { ziele: [off] }).ausserhalb).toBe(true);
  expect(showPlaces(inside, { ziele: [off, place] }).gezeigt).toEqual([
    "Kreuzkirche",
  ]);
  const loading = { ...STUB, show: () => false };
  expect(showPlaces(loading, { ziele: [place] }).ok).toBe(false);
});

test("zeige takes the eye over the places' ground and shows eight at most", () => {
  const grounds: (number | undefined)[] = [];
  let shown = 0;
  const scene = {
    ...STUB,
    show: (v: ViewpointGeometry, ground?: number) => {
      grounds.push(ground);
      shown = v.aboveGround;
      return true;
    },
  };
  const place = { name: "Kirche", x: 0, y: 0, z: 140, h: 40, r: 20 };
  showPlaces(scene, { ziele: [place] });
  expect(grounds).toEqual([140]);
  expect(shown).toBeGreaterThan(0);
  // a place whose ground nobody knew: the glide measures it
  showPlaces(scene, { ziele: [{ ...place, z: undefined }] });
  expect(grounds[1]).toBeUndefined();
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...place,
    name: `Ort ${i}`,
    x: i * 20,
  }));
  expect(showPlaces(scene, { ziele: many }).gezeigt).toHaveLength(8);
});
