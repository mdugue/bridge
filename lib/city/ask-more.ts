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
import type { FeatureInquiry } from "./inquiry-features";
import type { CanopyInquiry } from "./inquiry-more";
import { ringCentre } from "./monuments";
import { samplePolyline } from "./polyline";
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
/** The street lamp's post (lamp-layer.ts LAMP_H) and how wide it is picked. */
const LAMP = { h: 5.4, r: 0.45 };
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
  ctx: MoreContext
): AskSolid | null {
  const y = ctx.heightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return { cylinder: { x, z, y0: y - 0.2, y1: y + h, r } };
}

/** A placed canopy tree as a packed trunk and crown. */
const packedCanopy = (p: Placement): PackedTree => [
  p.x,
  p.z,
  p.y,
  p.y + CANOPY.base * p.s,
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
  const place = { heightAt: ctx.heightAt, offset: ctx.offset };
  // placed one by one, as the layer places them, so each keeps its
  // measured height
  const measured = (
    source: CanopyInquiry["source"],
    list: readonly CanopyFeature[]
  ) =>
    list.flatMap((f) =>
      canopyPlacements([f], place, undefined, keepTree).map((p) => ({
        p,
        source,
        height: f.properties?.h,
      }))
    );
  const trees: {
    height?: number;
    p: Placement;
    source: CanopyInquiry["source"];
  }[] = [
    ...measured("dom", features.canopy),
    ...measured("lsc", features.scan),
    ...rowPlacements(features.rows, place, undefined, keepTree).trees.map(
      (p) => ({ p, source: "row" as const })
    ),
  ];
  // what a card needs, kept packed: the placements go once packed
  const sources: CanopyInquiry["source"][] = ["dom", "lsc", "row"];
  const position = new Float64Array(trees.length * 2);
  const height = new Float32Array(trees.length);
  const source = new Uint8Array(trees.length);
  trees.forEach((t, i) => {
    position.set(epsgOf(t.p, ctx.offset), i * 2);
    height[i] = t.height && Number.isFinite(t.height) ? t.height : 0;
    source[i] = sources.indexOf(t.source);
  });
  return packedCylinderSets(
    trees.length,
    (i) => packedCanopy(trees[i].p),
    (i) => canopyInquiry(position, height, sources[source[i]], i, ctx.tile)
  );
}

/** The canopy tree at index `i` as an inquiry. */
function canopyInquiry(
  position: Float64Array,
  height: Float32Array,
  source: CanopyInquiry["source"],
  i: number,
  tile: string
): FeatureInquiry {
  return {
    kind: "canopy",
    tile,
    position: [position[i * 2], position[i * 2 + 1]],
    source,
    ...(height[i] > 0 ? { height: height[i] } : {}),
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
    const at = f.geometry.coordinates;
    add(standing(at, LAMP.r, LAMP.h, ctx), {
      kind: "lamp",
      tile: ctx.tile,
      position: [at[0], at[1]],
      ...(f.properties?.src ? { src: f.properties.src } : {}),
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
  const [r, h] = FURNITURE_SOLID[p.k] ?? [0.6, 1];
  if (f.geometry.type === "Point") {
    const at = f.geometry.coordinates;
    const solid = standing(at, r, h, ctx);
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
            y1: deck + 1.2,
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
  features: {
    canopy: CanopyFeature[];
    furniture: FurnitureFeature[];
    hedges: LowVegFeature[];
    lamps: LampFeature[];
    river: RiversideFeature[];
    rows: VegRowFeature[];
    scan: CanopyFeature[];
    trams: TramFeature[];
  },
  ctx: MoreContext,
  keepTree?: TreeVeto
): AskSet<FeatureInquiry>[] {
  return [
    ...canopySets(features, ctx, keepTree),
    ...askSets([
      ...hedgeItems(features.hedges, features.rows, ctx),
      ...pointItems(features.lamps, features.furniture, features.trams, ctx),
      ...landingItems(features.river, ctx),
    ]),
  ];
}
