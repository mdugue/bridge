import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  bridgeItems,
  monumentItems,
  moreSets,
  toleranceBox,
  treeSets,
} from "./ask-items";
import { hitsInSets, nearestItem } from "./ask-solids";
import type { AskSolid } from "./ask-solids";
import type {
  BridgeFeature,
  CanopyFeature,
  FeatureCollection,
  FurnitureFeature,
  LampFeature,
  LowVegFeature,
  MonumentFeature,
  RiversideFeature,
  TramFeature,
  TreeFeature,
  VegRowFeature,
} from "./features";
import { FLAG_CLOTH_L, flagYaw } from "./furniture";
import { epsgToWorld } from "./ground-clamp";
import type { CardCredits } from "./card-lines";
import { inquiryCard } from "./inquiry";
import type { FeatureInquiry } from "./inquiry-features";
import { samplePolyline } from "./polyline";

const TILE = "33412_5656_2_sn";
const read = <F>(kind: string) =>
  (
    JSON.parse(
      readFileSync(
        path.join(
          import.meta.dir,
          "..",
          "..",
          "data",
          "dresden",
          "dlm",
          `${kind}_${TILE}.geojson`
        ),
        "utf-8"
      )
    ) as FeatureCollection<F>
  ).features ?? [];

const offset = { cx: 412_000, cy: 5_656_000 };
const ctx = {
  offset,
  tile: TILE,
  heightAt: () => 110,
  treeHeightAt: () => 110,
};
const down = { x: 0, y: -1, z: 0 };

test("every tree of the file is askable, by its index there", () => {
  const trees = read<TreeFeature>("trees");
  const sets = treeSets(trees, ctx);
  const i = 1234;
  const [ex, ey] = trees[i].geometry.coordinates;
  const w = epsgToWorld(ex, ey, offset);
  const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
  expect(hit?.target).toMatchObject({ kind: "tree", index: i, tile: TILE });
  // its solids come with it, for the outline
  expect(hit?.solids).toHaveLength(2);
  // straight down onto the crown's top
  expect(hit?.distance).toBeCloseTo(
    200 - 110 - (trees[i].properties?.h ?? 0),
    0
  );
});

test("an orchard tree appended to the file's is askable past its end, as an orchard tree", () => {
  const trees = read<TreeFeature>("trees");
  const at: [number, number] = [412_500.5, 5_656_500.5];
  const orchard: TreeFeature = {
    geometry: { type: "Point", coordinates: at },
    properties: { a: 0, h: 4.5, d: 4, l: "d", s: "orchard" },
  };
  const sets = treeSets([...trees, orchard], ctx);
  const w = epsgToWorld(at[0], at[1], offset);
  const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
  expect(hit?.target).toMatchObject({
    kind: "tree",
    index: trees.length,
    orchard: true,
  });
  expect(hit?.target).not.toHaveProperty("measured");
  if (!orchard.properties) {
    throw new Error("the orchard tree has no properties");
  }
  const measured = treeSets(
    [...trees, { ...orchard, properties: { ...orchard.properties, m: 1 } }],
    ctx
  );
  const again = hitsInSets({ x: w.x, y: 200, z: w.z }, down, measured, 500)[0];
  expect(again?.target).toMatchObject({ orchard: true, measured: true });
});

const tree = (x: number, a: number): TreeFeature => ({
  geometry: { type: "Point", coordinates: [412_000 + x, 5_656_000] },
  properties: { a, h: 12, d: 6, l: a === 0 ? "d" : "e" },
});

test("a pine and a yew are needle trees on the card, as the cone's conifers are", () => {
  // round, conifer, pine, bush (tree-inventory.ts TREE_ARCHETYPES)
  const trees = [tree(0, 0), tree(40, 3), tree(80, 6), tree(120, 7)];
  const sets = treeSets(trees, ctx);
  const conifer = trees.map((t) => {
    const [ex, ey] = t.geometry.coordinates;
    const w = epsgToWorld(ex, ey, offset);
    const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
    return (hit?.target as { conifer?: boolean } | undefined)?.conifer;
  });
  expect(conifer).toEqual([false, true, true, true]);
  // only the cone's conifer is drawn, and outlined, as the cone
  const cone = trees.map((t) => {
    const [ex, ey] = t.geometry.coordinates;
    const w = epsgToWorld(ex, ey, offset);
    const hit = hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 500)[0];
    return (hit?.target as { cone?: boolean } | undefined)?.cone === true;
  });
  expect(cone).toEqual([false, true, false, false]);
});

test("a fountain basin and the monuments are askable where they stand", () => {
  const monuments = read<MonumentFeature>("monuments");
  const items = monumentItems(monuments, ctx);
  expect(items).toHaveLength(monuments.length);
  const named = items.find(
    (m) => m.target.kind === "monument" && m.target.properties.name
  );
  expect(named).toBeDefined();
  const [ex, ey] =
    named?.target.kind === "monument" ? named.target.position : [0, 0];
  const w = epsgToWorld(ex, ey, offset);
  const hit = nearestItem({ x: w.x, y: 150, z: w.z }, down, items, 500);
  expect(hit?.target).toBe(named?.target);
});

test("a bridge is met on its deck, not in the air over its ends", () => {
  const bridges = read<BridgeFeature>("bridge");
  const items = bridgeItems(bridges, ctx);
  const albert = items.find(
    (b) =>
      b.target.kind === "bridge" && b.target.properties.name === "Albertbrücke"
  );
  expect(albert).toBeDefined();
  if (albert?.target.kind !== "bridge") {
    return;
  }
  expect(albert.target.length).toBeGreaterThan(100);
  const props = albert.target.properties;
  const [ax, ay] = props.axis?.[0] ?? [0, 0];
  const [bx, by] = props.axis?.at(-1) ?? [0, 0];
  // the middle of the deck: met from above near the measured top
  const mid = epsgToWorld((ax + bx) / 2, (ay + by) / 2, offset);
  const hit = nearestItem({ x: mid.x, y: 200, z: mid.z }, down, [albert], 500);
  const top = Math.max(...(props.line ?? [0]));
  expect(hit).not.toBeNull();
  expect(200 - (hit?.distance ?? 0)).toBeGreaterThan(top - 3);
  expect(200 - (hit?.distance ?? 0)).toBeLessThan(top + 1.5);
  // level with the arch's crown, a ray along the deck over its low end
  // passes over it until the deck rises to meet it
  const end = epsgToWorld(ax, ay, offset);
  const along = { x: mid.x - end.x, y: 0, z: mid.z - end.z };
  const len = Math.hypot(along.x, along.z);
  const lowEnd = props.line?.[0] ?? 0;
  const ray = nearestItem(
    { x: end.x, y: lowEnd + 2.6, z: end.z },
    { x: along.x / len, y: 0, z: along.z / len },
    [albert],
    500
  );
  expect(ray === null || (ray.distance ?? 0) > 5).toBe(true);
});

/** The lowest a solid reaches. */
function solidBottom(s: AskSolid): number {
  if ("cylinder" in s) {
    return s.cylinder.y0;
  }
  return "prism" in s ? s.prism.y0 : s.slab.y0;
}
const bottom = (solids: readonly AskSolid[]) =>
  Math.min(...solids.map(solidBottom));

const point = (dx: number): [number, number] => [412_500 + dx, 5_656_500];
const geometry = (dx: number) => ({
  type: "Point" as const,
  coordinates: point(dx),
});

test("a lamp, a bench, a canopy and an inventory tree stand on the tile's own ground, a monument on every terrain's", () => {
  // near a seam the two grounds differ: the tile's own terrain (50) and
  // every loaded terrain's (110)
  const grounds = { ...ctx, treeHeightAt: () => 50 };
  const canopy: CanopyFeature = {
    geometry: geometry(0),
    properties: { h: 18 },
  };
  const lamp: LampFeature = { geometry: geometry(20), properties: {} };
  const bench: FurnitureFeature = {
    geometry: geometry(40),
    properties: { k: "bench" },
  };
  const monument: MonumentFeature = {
    geometry: geometry(60),
    properties: { kind: "statue", source: "osm" },
  };
  const sets = moreSets(
    {
      canopy: [canopy],
      scan: [],
      rows: [],
      hedges: [],
      lamps: [lamp],
      furniture: [bench],
      trams: [],
      river: [],
    },
    grounds
  ).concat(
    treeSets(
      [{ geometry: geometry(80), properties: { a: 0, h: 12, d: 6, l: "d" } }],
      grounds
    )
  );
  const at = (dx: number) => {
    const [x, y] = point(dx);
    const w = epsgToWorld(x, y, offset);
    return hitsInSets({ x: w.x, y: 300, z: w.z }, down, sets, 1000)[0];
  };
  for (const [dx, kind] of [
    [0, "canopy"],
    [20, "lamp"],
    [40, "furniture"],
    [80, "tree"],
  ] as const) {
    const hit = at(dx);
    expect(hit?.target.kind).toBe(kind);
    expect(bottom(hit?.solids ?? [])).toBeGreaterThan(49);
    expect(bottom(hit?.solids ?? [])).toBeLessThan(51);
  }
  const [item] = monumentItems([monument], grounds);
  expect(bottom(item.solids)).toBeGreaterThan(109);
  expect(bottom(item.solids)).toBeLessThan(111);
});

/** Dresden's credits (sites/providers.ts) as the HUD hands them over. */
const DRESDEN: CardCredits = {
  dlm: true,
  provider: "Quelle: GeoSN, dl-de/by-2-0",
};

const features = {
  canopy: read<CanopyFeature>("canopy"),
  scan: read<CanopyFeature>("canopyx"),
  rows: read<VegRowFeature>("vegrows"),
  hedges: read<LowVegFeature>("lowveg"),
  lamps: read<LampFeature>("lamps"),
  furniture: read<FurnitureFeature>("furniture"),
  trams: read<TramFeature>("tram"),
  river: read<RiversideFeature>("riverside"),
};
const sets = moreSets(features, ctx);

/** What a ray straight down at EPSG (x, y) meets first. */
const askDown = (x: number, y: number): FeatureInquiry | undefined => {
  const w = epsgToWorld(x, y, offset);
  return hitsInSets({ x: w.x, y: 200, z: w.z }, down, sets, 1000)[0]?.target;
};

test("a surface-model crown answers with its measured height", () => {
  const f = features.canopy[100];
  const [x, y] = f.geometry.coordinates;
  const asked = askDown(x, y);
  expect(asked?.kind).toBe("canopy");
  if (asked?.kind === "canopy") {
    expect(asked.source).toBe("dom");
    // kept packed as a float32
    expect(asked.height).toBeCloseTo(f.properties?.h ?? Number.NaN, 5);
  }
});

const crown = (x: number, extra: Partial<CanopyFeature["properties"]>) =>
  ({
    geometry: { type: "Point", coordinates: [412_500 + x, 5_656_500] },
    properties: { h: 18, ...extra },
  }) as CanopyFeature;

test("an evergreen crown is outlined as the cone, a pine's not, and the pine's crown starts high", () => {
  const canopy = [
    crown(0, {}),
    crown(30, { l: "e" }),
    crown(60, { l: "e", pine: 1 }),
  ];
  const own = moreSets({ ...features, canopy, scan: [], rows: [] }, ctx);
  const asked = canopy.map((f) => {
    const [x, y] = f.geometry.coordinates;
    const w = epsgToWorld(x, y, offset);
    return hitsInSets({ x: w.x, y: 200, z: w.z }, down, own, 1000).find(
      (h) => h.target.kind === "canopy"
    );
  });
  expect(
    asked.map((h) => h?.target.kind === "canopy" && h.target.cone === true)
  ).toEqual([false, true, false]);
  // the crown solid the hit makes says so; the trunk says no crown
  expect(
    asked.map((h) => {
      const [trunk, top] = h?.solids ?? [];
      return [
        trunk && "cylinder" in trunk ? trunk.crown : "none",
        top && "cylinder" in top ? top.crown : "none",
      ];
    })
  ).toEqual([
    [undefined, "ellipsoid"],
    [undefined, "cone"],
    [undefined, "ellipsoid"],
  ]);
  // a level ray 8.2 m up meets the broadleaf's crown (from 6.6 m) at its
  // rim, the pine (its crown from 0.55 H, 9.9 m) only at its stem
  const across = [0, 60].map((dx) => {
    const w = epsgToWorld(412_500 + dx - 20, 5_656_500, offset);
    return hitsInSets(
      { x: w.x, y: 110 + 8.2, z: w.z },
      { x: 1, y: 0, z: 0 },
      own,
      25
    ).find((h) => h.target.kind === "canopy")?.distance;
  });
  expect((across[1] ?? 0) - (across[0] ?? 0)).toBeGreaterThan(2);
});

test("a crown a register's tree stands on is left to the register", () => {
  const f = features.canopy[100];
  const [x, y] = f.geometry.coordinates;
  const vetoed = moreSets(features, ctx, (vx, vy) => vx !== x || vy !== y);
  const w = epsgToWorld(x, y, offset);
  const thisCrown = (h: { target: FeatureInquiry }) =>
    h.target.kind === "canopy" &&
    h.target.position[0] === Math.round(x * 10) / 10 &&
    h.target.position[1] === Math.round(y * 10) / 10;
  const o = { x: w.x, y: 200, z: w.z };
  // without the veto the same ray finds it, so the match itself holds
  expect(hitsInSets(o, down, sets, 1000).some(thisCrown)).toBe(true);
  expect(hitsInSets(o, down, vetoed, 1000).some(thisCrown)).toBe(false);
});

test("lamps, furniture and tram stops are each askable at their point", () => {
  const lamp = features.lamps[0].geometry.coordinates;
  expect(askDown(lamp[0], lamp[1])?.kind).toBe("lamp");
  const bench = features.furniture.find(
    (f) => f.properties?.k === "bench" && f.geometry.type === "Point"
  );
  const at = bench?.geometry.coordinates as [number, number];
  const asked = askDown(at[0], at[1]);
  expect(asked?.kind).toBe("furniture");
  expect(asked && inquiryCard(asked, null, DRESDEN).title).toBe("Bank");
  const stop = features.trams.find(
    (f) => f.properties?.k === "stop" && f.properties.name
  );
  expect(stop?.geometry.type).toBe("Point");
  if (stop?.geometry.type !== "Point") {
    throw new Error("no named tram stop on the tile");
  }
  const [sx, sy] = stop.geometry.coordinates;
  const s = askDown(sx, sy);
  expect(s?.kind).toBe("stop");
  expect(s && inquiryCard(s, null, DRESDEN).title).toBe(
    stop.properties?.name ?? ""
  );
});

// a crown may stand over the hedge: the hedge is among the hits
const hedgeAt = ([x, y]: [number, number]) =>
  hitsInSets({ ...epsgToWorld(x, y, offset), y: 200 }, down, sets, 1000).find(
    (h) => h.target.kind === "hedge"
  )?.target;

test("a hedge is one thing along its whole line", () => {
  const hedge = features.hedges.find((f) => f.geometry.coordinates.length > 3);
  const along = samplePolyline(hedge?.geometry.coordinates ?? [], 2);
  const [a, b] = [along[0], along.at(-1)] as [number, number][];
  const first = hedgeAt(a);
  const last = hedgeAt(b);
  expect(first?.kind).toBe("hedge");
  expect(last?.kind).toBe("hedge");
  expect(first?.position).toEqual(last?.position);
});

test("a landing stage on the river answers with its kind", () => {
  const pier = features.river.find(
    (f) =>
      f.geometry.type === "Polygon" &&
      (f.properties?.k === "pier" || f.properties?.k === "pontoon")
  );
  expect(pier).toBeDefined();
  if (pier?.geometry.type !== "Polygon") {
    throw new Error("no landing stage on the tile");
  }
  const ring = pier.geometry.coordinates[0];
  const x = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const y = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const hits = hitsInSets(
    { ...epsgToWorld(x, y, offset), y: 200 },
    down,
    sets,
    1000
  );
  expect(hits.some((h) => h.target.kind === "landing")).toBe(true);
});

const pt = (x: number, y: number) => ({
  type: "Point" as const,
  coordinates: [x, y] as [number, number],
});

test("a lamp or a bench on a bridge is asked on its deck, a wall lantern at its head", () => {
  const own = moreSets(
    {
      canopy: [],
      scan: [],
      rows: [],
      hedges: [],
      river: [],
      trams: [],
      lamps: [
        { geometry: pt(412_010, 5_656_020), properties: { h: 5, deck: 125 } },
        {
          geometry: pt(412_030, 5_656_020),
          properties: { h: 3.5, wall: [412_030, 5_656_020.5] },
        },
      ],
      furniture: [
        {
          geometry: pt(412_050, 5_656_020),
          properties: { k: "bench", deck: 125 },
        },
      ],
    },
    ctx
  );
  // a ray along the street at height y (m), from the west
  const along = (y: number, x: number) => {
    const w = epsgToWorld(x - 5, 5_656_020, offset);
    return hitsInSets({ x: w.x, y, z: w.z }, { x: 1, y: 0, z: 0 }, own, 10)[0]
      ?.target.kind;
  };
  expect(along(127, 412_010)).toBe("lamp"); // the post on the deck
  expect(along(112, 412_010)).toBeUndefined(); // nothing on the ground below
  expect(along(113.4, 412_030)).toBe("lamp"); // the lantern's head
  expect(along(111, 412_030)).toBeUndefined(); // no post under it
  expect(along(125.5, 412_050)).toBe("furniture");
  expect(along(110.5, 412_050)).toBeUndefined();
});

test("a tall mast is asked at its post and at the head on its arm", () => {
  const own = moreSets(
    {
      canopy: [],
      scan: [],
      rows: [],
      hedges: [],
      river: [],
      trams: [],
      lamps: [
        {
          geometry: { type: "Point", coordinates: [412_070, 5_656_020] },
          // 9 m, its arm reaching east (1.8 m)
          properties: { h: 9, hs: "street", arm: 90 },
        },
      ],
      furniture: [],
    },
    ctx
  );
  // a ray north at height y (m), x m east of the post
  const north = (y: number, dx: number) => {
    const w = epsgToWorld(412_070 + dx, 5_655_990, offset);
    return hitsInSets({ x: w.x, y, z: w.z }, { x: 0, y: 0, z: -1 }, own, 60)[0]
      ?.target;
  };
  const head = north(119, 1.8);
  expect(head?.kind).toBe("lamp");
  expect(head && "arm" in head ? head.arm : undefined).toBe(true);
  expect(north(113, 1.8)).toBeUndefined(); // nothing under the arm
  expect(north(113, 0)?.kind).toBe("lamp"); // the post
});

test("a flagpole is asked at its mast and at its cloth, downwind of it", () => {
  const at: [number, number] = [412_070, 5_656_020];
  const own = moreSets(
    {
      canopy: [],
      scan: [],
      rows: [],
      hedges: [],
      river: [],
      trams: [],
      lamps: [],
      furniture: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: at },
          properties: { k: "flag", h: 10 },
        } as FurnitureFeature,
      ],
    },
    ctx
  );
  // a ray straight down at the cloth's middle, and one upwind of the mast
  const yaw = flagYaw(at[0], at[1]);
  const mast = epsgToWorld(at[0], at[1], offset);
  const downAt = (along: number) =>
    hitsInSets(
      {
        x: mast.x + Math.cos(yaw) * along,
        y: 200,
        z: mast.z - Math.sin(yaw) * along,
      },
      down,
      own,
      1000
    )[0];
  const cloth = downAt(FLAG_CLOTH_L / 2);
  expect(cloth?.target.kind).toBe("furniture");
  // the cloth's top is the mast's: 110 m ground, a 10 m mast
  expect(200 - (cloth?.distance ?? 0)).toBeCloseTo(120);
  expect(downAt(-FLAG_CLOTH_L / 2)).toBeUndefined();
  // the cloth's cylinder is a box round the sheet: the lens passes it by
  expect(cloth && toleranceBox(cloth)).toBe(true);
});

const toleranceItem = (kind: string, solids: AskSolid[]) =>
  ({ solids, target: { kind } }) as unknown as Parameters<
    typeof toleranceBox
  >[0];

const monumentItem = (kind: string, solids: AskSolid[]) =>
  ({
    solids,
    target: { kind: "monument", properties: { kind } },
  }) as unknown as Parameters<typeof toleranceBox>[0];

test("the lens never focuses on a box the probe tolerates", () => {
  const prism: AskSolid = { prism: { ring: [], y0: 0, y1: 1 } };
  const post: AskSolid = { cylinder: { x: 0, z: 0, y0: 0, y1: 1, r: 0.1 } };
  expect(toleranceBox(toleranceItem("landing", [prism]))).toBe(true);
  expect(toleranceBox(toleranceItem("furniture", [prism]))).toBe(true);
  expect(toleranceBox(toleranceItem("furniture", [post]))).toBe(false);
  expect(toleranceBox(toleranceItem("tree", [post]))).toBe(false);
  expect(toleranceBox(monumentItem("fountain", [post]))).toBe(true);
  expect(toleranceBox(monumentItem("statue", [prism]))).toBe(true);
  expect(toleranceBox(monumentItem("statue", [post]))).toBe(false);
});
