/**
 * The askable things beyond the register's trees, the monuments and the
 * bridges (plan 052 phase 4e): every other tree the scene draws (the
 * surface model's crowns, the laser scan's, the Basis-DLM's tree rows),
 * the hedges, the street lamps, the street furniture and playgrounds, the
 * tram stops and the landing stages — each as simple solids sized as its
 * layer draws it (lib/city/ask-solids.ts), with the inquiry it answers.
 * No THREE, no DOM.
 */
import {
  type AskItem,
  type AskSet,
  type AskSolid,
  askSets,
} from "./ask-solids";
import { finished, inRuns, type Steps } from "./build-steps";
import { type PackedTree, packedCylinderSets } from "./ask-items";
import type {
  CanopyFeature,
  FurnitureFeature,
  FurnitureKind,
  LampFeature,
  LowVegFeature,
  RiversideFeature,
  TramFeature,
  VegRowFeature,
} from "./features";
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import { armOffset, postHeight } from "./lamps";
import type { FeatureInquiry } from "./inquiry-features";
import type { CanopyInquiry } from "./inquiry-more";
import { ringCentre } from "./monuments";
import { samplePolyline } from "./polyline";
import { pineBase } from "./tree-inventory";
import {
  BASE_TREE_H,
  canopyPlacements,
  type Placement,
  rowPlacements,
  type TreeVeto,
} from "./tree-placement";

type HeightAt = (x: number, y: number) => number | null;

export interface MoreContext {
  /** the tile's own ground, which its trees, lamps and furniture stand on */
  heightAt: HeightAt;
  offset: RecenterOffset;
  tile: string;
}

/** The canopy tree's crown at scale 1 (vegetation-layer.ts: a trunk of
 *  2.4 m, a lobed crown of radius ~2.1 m round 3.45 m), as picked. */
const CANOPY = { base: 1.6, top: BASE_TREE_H + 0.4, r: 2.3 };
/** A crown narrower than this is still a target a finger can hit (m). */
const MIN_CROWN_R = 0.8;
/** How far over its post's head (lib/city/lamps.ts) a street lamp is
 *  picked, and how wide; a lamp hung across the street is picked round its
 *  head (HUNG_H). */
const LAMP = { over: 0.4, r: 0.45 };
const HUNG_LAMP = { y0: 6.4, y1: 7.5, r: 0.6 };
/** A wall lantern is picked from this far under its head (m). */
const WALL_LAMP = { below: 0.7 };
/** The tram stop's sign, picked a little wider than drawn. */
const STOP = { h: 2.8, r: 0.5 };
/** How far apart a hedge's picks stand along it (m). */
const HEDGE_STEP = 2;

/** Each furniture kind picked as a cylinder: radius, height (m). */
const FURNITURE_SOLID: Record<FurnitureKind, [number, number]> = {
  bench: [1, 1],
  bike: [0.9, 1],
  bin: [0.45, 1.1],
  bollard: [0.3, 1],
  clock: [0.5, 4.2],
  column: [0.8, 3.2],
  hydrant: [0.35, 1],
  hydrantsign: [0.3, 1.5],
  pedsignal: [0.35, 2.7],
  picnic: [1.2, 1],
  postbox: [0.45, 1.5],
  shelter: [2, 2.7],
  signal: [0.4, 3.6],
  stop: [0.45, 2.8],
  wallclock: [0.6, 4.2],
  water: [0.45, 1.2],
  climb: [1.6, 2.5],
  playground: [1, 0.4],
  playhouse: [1.4, 2.2],
  roundabout: [1.5, 1],
  sandpit: [1.5, 0.4],
  seesaw: [1.6, 1],
  slide: [1.6, 2.4],
  springy: [0.6, 1],
  swing: [1.8, 2.4],
};

/** A ring in the world's x–z plane. */
const ringXz = (
  ring: readonly (readonly [number, number])[],
  offset: RecenterOffset
) =>
  ring.map(([x, y]) => {
    const w = epsgToWorld(x, y, offset);
    return [w.x, w.z] as const;
  });

/** A cylinder standing on the ground at EPSG (x, y). */
function standing(
  [ex, ey]: readonly [number, number],
  r: number,
  h: number,
  ctx: MoreContext,
  deck?: number
): AskSolid | null {
  // on a bridge, its deck's top (pipeline/bake/furniture.py `Decks`)
  const y = deck ?? ctx.heightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return { cylinder: { x, z, y0: y - 0.2, y1: y + h, r } };
}

/** A lamp's head hung over the street at EPSG (x, y). */
function hanging(
  [ex, ey]: readonly [number, number],
  ctx: MoreContext
): AskSolid | null {
  const y = ctx.heightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  const { y0, y1, r } = HUNG_LAMP;
  return { cylinder: { x, z, y0: y + y0, y1: y + y1, r } };
}

/** A wall lantern's head, `h` m over the ground at EPSG (x, y): no post. */
function onWall(
  [ex, ey]: readonly [number, number],
  h: number,
  ctx: MoreContext
): AskSolid | null {
  const y = ctx.heightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return {
    cylinder: {
      x,
      z,
      y0: y + h - WALL_LAMP.below,
      y1: y + h + LAMP.over,
      r: LAMP.r,
    },
  };
}

/** A tall mast's head at its arm's end, `h` m over its foot (`y`). */
function armHead(f: LampFeature, y: number, ctx: MoreContext): AskSolid[] {
  const arm = armOffset(f);
  if (!arm) {
    return [];
  }
  const [ex, ey] = f.geometry.coordinates;
  const h = postHeight(f);
  const { x, z } = epsgToWorld(ex + arm[0], ey + arm[1], ctx.offset);
  const { below } = WALL_LAMP;
  const { over, r } = LAMP;
  return [{ cylinder: { x, z, y0: y + h - below, y1: y + h + over, r } }];
}

/** A lamp's picks: its head on the wire or bracket, or its post — and a
 *  tall mast's head on its arm. */
function lampSolids(f: LampFeature, ctx: MoreContext): AskSolid[] {
  const at = f.geometry.coordinates;
  const p = f.properties;
  if (p?.wire) {
    return [hanging(at, ctx)].filter((s) => s !== null);
  }
  if (p?.wall) {
    return [onWall(at, postHeight(f), ctx)].filter((s) => s !== null);
  }
  const post = standing(at, LAMP.r, postHeight(f) + LAMP.over, ctx, p?.deck);
  if (!post || !("cylinder" in post)) {
    return [];
  }
  return [post, ...armHead(f, post.cylinder.y0 + 0.2, ctx)];
}

/** Whether the layer draws a canopy tree as the cone: an evergreen that is
 *  not a pine (vegetation-layer.ts `canopyForm`). */
const canopyCone = (p: Placement): boolean =>
  p.evergreen === true && p.pine !== true;

/** A placed canopy tree as a packed trunk and crown, the crown from where
 *  the layer starts it (`Placement.base`, `crownBase`; a pine's high on its
 *  stem, `pineBase`). */
const packedCanopy = (p: Placement): PackedTree => [
  p.x,
  p.z,
  p.y,
  p.y +
    (p.evergreen === true && p.pine === true
      ? pineBase(p)
      : (p.base ?? CANOPY.base * p.s)),
  p.y + CANOPY.top * p.s,
  Math.max(CANOPY.r * p.s, MIN_CROWN_R),
];

/** The world position back in EPSG (the card's position). */
const epsgOf = (p: Placement, offset: RecenterOffset): [number, number] => [
  Math.round((p.x + offset.cx) * 10) / 10,
  Math.round((offset.cy - p.z) * 10) / 10,
];

/**
 * The trees the canopy draws (the DOM1 crowns, the laser scan's, the
 * Basis-DLM rows' trees), placed as the layer places them — with the same
 * veto of the trees a register names — and packed.
 */
export function canopySets(
  features: {
    canopy: CanopyFeature[];
    rows: VegRowFeature[];
    scan: CanopyFeature[];
  },
  ctx: MoreContext,
  keepTree?: TreeVeto
): AskSet<FeatureInquiry>[] {
  return finished(canopySetsSteps(features, ctx, keepTree));
}

/** Trees and rows placed per step (build-steps.ts). */
const PLACE_RUN = 256;
const ROW_RUN = 16;

interface AskedTree {
  height?: number;
  leaf?: CanopyInquiry["evergreen"];
  p: Placement;
  source: CanopyInquiry["source"];
}

/** `canopySets` in steps: per run of trees placed (build-steps.ts). */
function* canopySetsSteps(
  features: {
    canopy: CanopyFeature[];
    rows: VegRowFeature[];
    scan: CanopyFeature[];
  },
  ctx: MoreContext,
  keepTree?: TreeVeto
): Steps<AskSet<FeatureInquiry>[]> {
  const place = { heightAt: ctx.heightAt, offset: ctx.offset };
  // placed one by one, as the layer places them, so each keeps its
  // measured height
  const measured = (
    source: CanopyInquiry["source"],
    list: readonly CanopyFeature[]
  ) =>
    inRuns(list, PLACE_RUN, (run) =>
      run.flatMap((f) =>
        canopyPlacements([f], place, undefined, keepTree).map(
          (p): AskedTree => ({
            p,
            source,
            height: f.properties?.h,
            leaf: leafOf(f),
          })
        )
      )
    );
  // whole rows per run: a row's trees are seeded by their place along it
  const rowTrees = inRuns(features.rows, ROW_RUN, (run) =>
    rowPlacements(run, place, undefined, keepTree).trees.map(
      (p): AskedTree => ({ p, source: "row" })
    )
  );
  const trees: AskedTree[] = [
    ...(yield* measured("dom", features.canopy)),
    ...(yield* measured("lsc", features.scan)),
    ...(yield* rowTrees),
  ];
  // what a card needs, kept packed: the placements go once packed
  const sources: CanopyInquiry["source"][] = ["dom", "lsc", "row"];
  const position = new Float64Array(trees.length * 2);
  const height = new Float32Array(trees.length);
  const source = new Uint8Array(trees.length);
  // 0 a broadleaf (or not known), else 1 + its index in LEAVES; + CONE
  // for one drawn as the cone
  const leaf = new Uint8Array(trees.length);
  trees.forEach((t, i) => {
    position.set(epsgOf(t.p, ctx.offset), i * 2);
    height[i] = t.height && Number.isFinite(t.height) ? t.height : 0;
    source[i] = sources.indexOf(t.source);
    leaf[i] =
      (t.leaf ? LEAVES.indexOf(t.leaf) + 1 : 0) |
      (canopyCone(t.p) ? LEAF_CONE : 0);
  });
  return packedCylinderSets(
    trees.length,
    (i) => packedCanopy(trees[i].p),
    (i) =>
      canopyInquiry(position, height, sources[source[i]], leaf[i], i, ctx.tile)
  );
}

const LEAVES = ["forest", "photo"] as const;
/** The leaf byte's bit for a crown drawn as the cone (`canopyCone`). */
const LEAF_CONE = 0x80;

/** What told a crown is an evergreen (canopy.py): the forest's kind, or
 *  the leaf-off orthophoto. */
const leafOf = (f: CanopyFeature): CanopyInquiry["evergreen"] =>
  f.properties?.l === "e"
    ? f.properties.ls === "dop"
      ? "photo"
      : "forest"
    : undefined;

/** The canopy tree at index `i` as an inquiry (`leaf`: its leaf byte). */
function canopyInquiry(
  position: Float64Array,
  height: Float32Array,
  source: CanopyInquiry["source"],
  leaf: number,
  i: number,
  tile: string
): FeatureInquiry {
  const evergreen = LEAVES[(leaf & ~LEAF_CONE) - 1];
  return {
    kind: "canopy",
    tile,
    position: [position[i * 2], position[i * 2 + 1]],
    source,
    ...(height[i] > 0 ? { height: height[i] } : {}),
    ...(evergreen ? { evergreen } : {}),
    ...((leaf & LEAF_CONE) === 0 ? {} : { cone: true }),
  };
}

/** A line's length (m). */
function lineLength(coords: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += Math.hypot(
      coords[i][0] - coords[i - 1][0],
      coords[i][1] - coords[i - 1][1]
    );
  }
  return sum;
}

/** The hedges (OSM's and the Basis-DLM's): a pick every HEDGE_STEP. */
export function hedgeItems(
  osm: readonly LowVegFeature[],
  rows: readonly VegRowFeature[],
  ctx: MoreContext
): AskItem<FeatureInquiry>[] {
  const lines = [
    ...osm.map((f) => ({ coords: f.geometry.coordinates, p: f.properties })),
    ...rows
      .filter((f) => f.properties?.kind === "hedge")
      .map((f) => ({ coords: f.geometry.coordinates, p: null })),
  ];
  const out: AskItem<FeatureInquiry>[] = [];
  for (const { coords, p } of lines) {
    if (coords.length < 2) {
      continue;
    }
    const h = p?.h ?? 1.6;
    const w = p?.w ?? 1.2;
    const solids = samplePolyline(coords, HEDGE_STEP).flatMap((at) => {
      const s = standing(at, Math.max(w / 2, 0.6), h, ctx);
      return s ? [s] : [];
    });
    if (solids.length === 0) {
      continue;
    }
    const mid = coords[Math.floor(coords.length / 2)];
    out.push({
      solids,
      target: {
        kind: "hedge",
        tile: ctx.tile,
        position: [mid[0], mid[1]],
        length: lineLength(coords),
        source: p?.src ?? "dlm",
        ...(p ? { height: p.h, width: p.w } : {}),
      },
    });
  }
  return out;
}

/** What a lamp's card says of it. */
function lampInquiry(f: LampFeature, tile: string): FeatureInquiry {
  const at = f.geometry.coordinates;
  const p = f.properties;
  return {
    kind: "lamp",
    tile,
    position: [at[0], at[1]],
    ...(p?.wire ? { hung: true } : {}),
    ...(p?.wall
      ? {
          wall: p.on === "wall" ? ("wall" as const) : ("facade" as const),
          height: postHeight(f),
        }
      : {}),
    ...(p?.src ? { src: p.src } : {}),
    ...(!p?.wire && p?.hs ? { height: postHeight(f), heightFrom: p.hs } : {}),
    ...(armOffset(f) ? { arm: true } : {}),
  };
}

/** The point things: lamps, furniture (and playgrounds), tram stops. */
export function pointItems(
  lamps: readonly LampFeature[],
  furniture: readonly FurnitureFeature[],
  trams: readonly TramFeature[],
  ctx: MoreContext
): AskItem<FeatureInquiry>[] {
  const out: AskItem<FeatureInquiry>[] = [];
  const add = (solid: AskSolid | null, target: FeatureInquiry) => {
    if (solid) {
      out.push({ solids: [solid], target });
    }
  };
  for (const f of lamps) {
    const solids = lampSolids(f, ctx);
    if (solids.length === 0) {
      continue;
    }
    out.push({
      solids,
      target: lampInquiry(f, ctx.tile),
    });
  }
  for (const f of furniture) {
    const p = f.properties;
    if (p) {
      out.push(...furnitureItem(f, p, ctx));
    }
  }
  for (const f of trams) {
    if (f.properties?.k === "stop" && f.geometry.type === "Point") {
      const at = f.geometry.coordinates;
      add(standing(at, STOP.r, STOP.h, ctx), {
        kind: "stop",
        tile: ctx.tile,
        position: [at[0], at[1]],
        name: f.properties.name ?? "",
      });
    }
  }
  return out;
}

/** One piece of furniture: a cylinder at its point, an outline's prism. */
function furnitureItem(
  f: FurnitureFeature,
  p: NonNullable<FurnitureFeature["properties"]>,
  ctx: MoreContext
): AskItem<FeatureInquiry>[] {
  const [r, base] = FURNITURE_SOLID[p.k] ?? [0.6, 1];
  // a signal on a mast arm: its mast (furniture-layer.ts `signalArm`)
  const h = p.arm ? 6.2 : base;
  if (f.geometry.type === "Point") {
    const at = f.geometry.coordinates;
    const solid = standing(at, r, h, ctx, p.deck);
    return solid
      ? [
          {
            solids: [solid],
            target: {
              kind: "furniture",
              tile: ctx.tile,
              position: [at[0], at[1]],
              properties: p,
            },
          },
        ]
      : [];
  }
  const ring = f.geometry.coordinates[0];
  const centre = ringCentre(ring);
  const y = ctx.heightAt(centre[0], centre[1]);
  if (y === null || ring.length < 3) {
    return [];
  }
  return [
    {
      solids: [
        { prism: { ring: ringXz(ring, ctx.offset), y0: y - 0.3, y1: y + h } },
      ],
      target: {
        kind: "furniture",
        tile: ctx.tile,
        position: centre,
        properties: p,
      },
    },
  ];
}

/** The landing stages and pontoons (their outlines; groynes and ferry
 *  lines stay unasked). */
export function landingItems(
  features: readonly RiversideFeature[],
  ctx: MoreContext
): AskItem<FeatureInquiry>[] {
  const out: AskItem<FeatureInquiry>[] = [];
  for (const f of features) {
    const p = f.properties;
    if (!(p && f.geometry.type === "Polygon")) {
      continue;
    }
    const ring = f.geometry.coordinates[0];
    const centre = ringCentre(ring);
    const ground = ctx.heightAt(centre[0], centre[1]);
    const deck = p.deck ?? ground;
    if (deck === null || deck === undefined || ring.length < 3) {
      continue;
    }
    out.push({
      solids: [
        {
          prism: {
            ring: ringXz(ring, ctx.offset),
            y0: deck - 1.5,
            // a pontoon floats its freeboard over the water (riverside.py
            // `fb`, up to 1.5 m): the box reaches over its deck too
            y1: deck + (p.k === "pontoon" ? (p.fb ?? 0.9) : 0) + 1.2,
          },
        },
      ],
      target: {
        kind: "landing",
        tile: ctx.tile,
        position: centre,
        properties: p,
      },
    });
  }
  return out;
}

/** Everything of a tile beyond its trees, monuments and bridges. */
export function moreSets(
  features: MoreFeatures,
  ctx: MoreContext,
  keepTree?: TreeVeto
): AskSet<FeatureInquiry>[] {
  return finished(moreSetsSteps(features, ctx, keepTree));
}

export interface MoreFeatures {
  canopy: CanopyFeature[];
  furniture: FurnitureFeature[];
  hedges: LowVegFeature[];
  lamps: LampFeature[];
  river: RiversideFeature[];
  rows: VegRowFeature[];
  scan: CanopyFeature[];
  trams: TramFeature[];
}

/** `moreSets` in steps (build-steps.ts). */
export function* moreSetsSteps(
  features: MoreFeatures,
  ctx: MoreContext,
  keepTree?: TreeVeto
): Steps<AskSet<FeatureInquiry>[]> {
  const canopy = yield* canopySetsSteps(features, ctx, keepTree);
  yield;
  return [
    ...canopy,
    ...askSets([
      ...hedgeItems(features.hedges, features.rows, ctx),
      ...pointItems(features.lamps, features.furniture, features.trams, ctx),
      ...landingItems(features.river, ctx),
    ]),
  ];
}
