import { expect, test } from "bun:test";
import {
  Color,
  IcosahedronGeometry,
  type Material,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import { TREE_GENERA } from "@/lib/city/tree-season";
import {
  createSeasonClock,
  type CrownSeasonKey,
  crownWarmup,
  seasonCrowns,
} from "./crown-season";
import { Instances, isInstances } from "./instancing";
import { buildVegetation, sceneCrowns } from "./vegetation-layer";

const LIME = TREE_GENERA.indexOf("Tilia");
const JAN_10 = 9;
const JUL_10 = 190;
const OCT_20 = 292;

function crowns(keys: CrownSeasonKey[]) {
  const geo = new IcosahedronGeometry(1, 1);
  const leafy = new MeshBasicNodeMaterial();
  const bare = new MeshBasicNodeMaterial();
  const cheap = new Instances(geo, leafy, keys.length);
  const rich = new Instances(geo, leafy, keys.length);
  const green = new Color(0.4, 0.6, 0.3);
  for (const mesh of [cheap, rich]) {
    keys.forEach((_, i) => mesh.setColorAt(i, green));
  }
  const season = seasonCrowns({ mid: cheap, rich }, keys, { leafy, bare });
  return { cheap, rich, season, leafy, bare, geo };
}

const lime: CrownSeasonKey = { genus: LIME, evergreen: false, jitter: 0 };
const pine: CrownSeasonKey = { genus: 0, evergreen: true, jitter: 0 };

test("both LOD sets share one tint buffer and one leaf cover over the crown's own buffers", () => {
  const { cheap, rich, geo } = crowns([lime, pine]);
  expect(rich.instanceTints).toBe(cheap.instanceTints);
  expect(cheap.geometry.getAttribute("aBare")).toBe(
    rich.geometry.getAttribute("aBare")
  );
  expect(cheap.geometry.getAttribute("position")).toBe(
    geo.getAttribute("position")
  );
});

test("summer changes nothing; winter bares the deciduous crowns and thins their shadow", () => {
  const { cheap, rich, season, leafy, bare } = crowns([lime, pine]);
  expect(season.apply(JUL_10)).toBe(false);
  expect(cheap.material).toBe(leafy);
  expect(season.apply(JAN_10)).toBe(true);
  const cover = cheap.geometry.getAttribute("aBare").array;
  expect(cover[0]).toBeCloseTo(1);
  expect(cover[1]).toBe(0); // the evergreen stays in leaf
  for (const mesh of [cheap, rich]) {
    expect(mesh.material as Material).toBe(bare);
  }
  // Same day again: nothing to write, no shadow redraw.
  expect(season.apply(JAN_10)).toBe(false);
  // Back to summer: the plain material.
  expect(season.apply(JUL_10)).toBe(true);
  expect(cheap.material).toBe(leafy);
});

test("autumn moves a lime's colour off its summer green; an evergreen keeps it", () => {
  const { cheap, season } = crowns([lime, pine]);
  const summer = Float32Array.from(cheap.instanceTints?.array ?? []);
  season.apply(OCT_20);
  const now = cheap.instanceTints?.array ?? [];
  const moved = (i: number) =>
    Math.hypot(
      now[i * 3] - summer[i * 3],
      now[i * 3 + 1] - summer[i * 3 + 1],
      now[i * 3 + 2] - summer[i * 3 + 2]
    );
  expect(moved(0)).toBeGreaterThan(0.1);
  expect(moved(1)).toBe(0);
  // Back to July restores the summer colour exactly.
  season.apply(JUL_10);
  expect(Array.from(cheap.instanceTints?.array ?? [])).toEqual(
    Array.from(summer)
  );
});

test("the canopy's crowns follow the season through the vegetation control", () => {
  const veg = buildVegetation(
    {
      rows: [],
      canopy: [0, 20, 40].map((x) => ({
        geometry: { type: "Point" as const, coordinates: [x, 0] as const },
        properties: { h: 12 },
      })),
    },
    { offset: { cx: 0, cy: 0 }, heightAt: () => 100 }
  );
  expect(veg.setSeason(JUL_10)).toBe(false);
  expect(veg.setSeason(JAN_10)).toBe(true);
  const { bare } = sceneCrowns();
  const crownsNow = veg.group.children.filter(
    (c) => isInstances(c) && c.material === bare
  );
  expect(crownsNow).toHaveLength(3); // the mid, rich and far crowns
});

test("the clock re-seasons on a new calendar day only, throttled, the last day winning", async () => {
  const days: number[] = [];
  const clock = createSeasonClock(
    new Date(2026, 6, 10, 9),
    (d) => days.push(d),
    40
  );
  expect(clock.day()).toBe(JUL_10);
  clock.set(new Date(2026, 6, 10, 18)); // same day, later hour
  expect(days).toEqual([]);
  clock.set(new Date(2026, 0, 10, 12)); // applied at once
  expect(days).toEqual([JAN_10]);
  clock.set(new Date(2026, 9, 1, 12)); // inside the throttle
  clock.set(new Date(2026, 9, 20, 12));
  expect(days).toEqual([JAN_10]);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(days).toEqual([JAN_10, OCT_20]);
  clock.dispose();
});

test("the warm-up stands in for both crown variants, laid out as a crown", () => {
  const geo = new IcosahedronGeometry(1, 1);
  const leafy = new MeshBasicNodeMaterial();
  const bare = new MeshBasicNodeMaterial();
  const warm = crownWarmup(geo, { leafy, bare });
  expect(warm.main.map((m) => m.material)).toEqual([bare, leafy]);
  // As a crown: instanced, with instance tints and its leaf cover (the same
  // attribute layout, so the same build).
  for (const mesh of warm.main) {
    expect(mesh.instanceTints).not.toBeNull();
    expect(mesh.geometry.getAttribute("aBare")).toBeDefined();
    expect(mesh.castShadow).toBe(true);
  }
  let freed = 0;
  for (const m of [leafy, bare]) {
    m.addEventListener("dispose", () => freed++);
  }
  let geoFreed = false;
  geo.addEventListener("dispose", () => {
    geoFreed = true;
  });
  warm.dispose();
  expect(geoFreed).toBe(true);
  expect(freed).toBe(0); // the materials are the scene's, not the warm-up's
});

test("only the seasonal crown masks (the shadow pass honours it), and twigs lose the glow", () => {
  const { leafy, bare } = sceneCrowns();
  expect(leafy).toBeInstanceOf(MeshStandardNodeMaterial);
  expect(bare).toBeInstanceOf(MeshStandardNodeMaterial);
  const plain = leafy as MeshStandardNodeMaterial;
  const seasonal = bare as MeshStandardNodeMaterial;
  expect(plain.maskNode).toBeNull();
  expect(seasonal.maskNode).not.toBeNull();
  for (const m of [plain, seasonal]) {
    expect(m.positionNode).not.toBeNull();
    // the cast shadow stays rigid: no sway in the shadow pass
    expect(m.castShadowPositionNode).not.toBeNull();
    expect(m.castShadowPositionNode).not.toBe(m.positionNode);
  }
  expect(seasonal.emissiveNode).not.toBe(plain.emissiveNode);
});
