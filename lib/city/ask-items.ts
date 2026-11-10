/**
 * The askable things of one tile that are not buildings (plan 052 phase
 * 4, 4e), as the inquiry probe tests them: each tree of the trees file,
 * each monument and fountain, each bridge deck the tile draws, and every
 * other tree the scene draws (the surface model's crowns, the laser
 * scan's, the Basis-DLM's tree rows), the hedges, the street lamps, the
 * street furniture and playgrounds, the tram stops and the landing stages
 * — each as simple solids in the Y-up world frame (lib/city/ask-solids.ts),
 * sized as its layer draws it so a ray meets what is on screen, with the
 * inquiry it answers. Built with the tile's dressing from the features the
 * dressing already fetched. No THREE, no DOM.
 *
 * Two grounds: a monument and a deck stand on every loaded terrain's
 * (`AskContext.heightAt`); a tree, a lamp, a bench, a hedge, a stop and a
 * landing on the tile's own (`treeHeightAt`), as their layers stand them.
 */
import { askSets, cylindersBox, rayCylinder } from "./ask-solids";
import type {
  Aabb,
  AskHit,
  AskItem,
  AskSet,
  AskSolid,
  Cylinder,
  Xyz,
} from "./ask-solids";
import { axisFrame, BRIDGE_STEP } from "./bridge";
import { finished, inRuns } from "./build-steps";
import type { Steps } from "./build-steps";
import type {
  BridgeFeature,
  CanopyFeature,
  FurnitureFeature,
  FurnitureKind,
  LampFeature,
  LowVegFeature,
  MonumentFeature,
  RiversideFeature,
  TramFeature,
  TreeFeature,
  VegRowFeature,
} from "./features";
import { FLAG_CLOTH_H, FLAG_CLOTH_L, FLAG_HEIGHT, flagYaw } from "./furniture";
import { epsgToWorld } from "./ground-clamp";
import type { RecenterOffset } from "./ground-clamp";
import type { CanopyInquiry, FeatureInquiry } from "./inquiry-features";
import { armOffset, postHeight } from "./lamps";
import { monumentMarker, pointBasinRadius, ringCentre } from "./monuments";
import { samplePolyline } from "./polyline";
import {
  ARCHETYPE_SHAPE,
  archetypeOf,
  pineBase,
  treeExtents,
} from "./tree-inventory";
import type { TreeArchetype } from "./tree-inventory";
import { BASE_TREE_H, canopyPlacements, rowPlacements } from "./tree-placement";
import type { Placement, TreeVeto } from "./tree-placement";
import { TREE_GENERA } from "./tree-season";

type HeightAt = (x: number, y: number) => number | null;

export interface AskContext {
  offset: RecenterOffset;
  /** ground over every loaded terrain (projected coordinates) */
  heightAt: HeightAt;
  /** whether the tile draws a deck that crosses its seam (its centroid) */
  owns?: (x: number, y: number) => boolean;
  tile: string;
}

/**
 * What the things on the tile's own ground are placed with: a tree, a
 * lamp, a bench, a hedge, a stop, a landing stand on `treeHeightAt` (the
 * tile's own terrain), never on `AskContext.heightAt` — near a seam the
 * two differ.
 */
export type OwnGroundContext = Pick<AskContext, "offset" | "tile"> & {
  /** ground of the tile's own terrain */
  treeHeightAt: HeightAt;
};

/** A trunk is picked a little wider than it is drawn (m). */
const TRUNK_R = 0.35;
/** A crown narrower than this is still a target a finger can hit (m). */
const MIN_CROWN_R = 0.8;
/** The tallest a pick reaches above a monument with no measured form. */
const BASIN_RIM = 1;
/** How far the deck's pick reaches over and under the measured top (m):
 *  the railing; the slab (bridge-layer.ts DECK_DEPTH) and a little. */
const DECK_ABOVE = 1.3;
const DECK_BELOW = 1.3;

/** One tree packed: x, z, ground, crown base, crown top, crown radius. */
const TREE_STRIDE = 6;
/** The cell a packed tree set covers (m). */
const TREE_CELL = 64;

/** The needle trees' archetypes (tree-inventory.ts): the cone's, a pine's
 *  and a yew's — each a "Nadelbaum" on the card. */
const NEEDLE_ARCHETYPES: ReadonlySet<TreeArchetype> = new Set([
  "conifer",
  "pine",
  "bush",
]);

/** What a tile knows of its trees beyond their solids, by feature index. */
interface TreeTable {
  crown: Float32Array;
  /** bit 1 OSM, bit 2 conifer (NEEDLE_ARCHETYPES), bit 4 orchard, bit 8
   *  measured (an orchard tree DOM1 measured), bit 16 drawn as the cone */
  flags: Uint8Array;
  genus: Uint8Array;
  height: Float32Array;
  /** EPSG easting, northing */
  position: Float64Array;
  trunk: Float32Array;
}

/** The tree at feature index `i` as an inquiry. */
function treeInquiry(t: TreeTable, i: number, tile: string): FeatureInquiry {
  const trunk = t.trunk[i];
  return {
    kind: "tree",
    tile,
    index: i,
    position: [t.position[i * 2], t.position[i * 2 + 1]],
    osm: (t.flags[i] & 1) === 1,
    conifer: (t.flags[i] & 2) === 2,
    ...((t.flags[i] & 4) === 4 ? { orchard: true } : {}),
    ...((t.flags[i] & 8) === 8 ? { measured: true } : {}),
    ...((t.flags[i] & 16) === 16 ? { cone: true } : {}),
    genus: TREE_GENERA[t.genus[i]] ?? "",
    height: t.height[i],
    crown: t.crown[i],
    ...(trunk > 0 ? { trunk } : {}),
  };
}

/** How a packed tree's crown is drawn: a cone where the tree says so (its
 *  archetype's crown, not a pine or a yew), else an ellipsoid. */
const crownOf = (t: FeatureInquiry): "cone" | "ellipsoid" =>
  (t.kind === "tree" || t.kind === "canopy") && t.cone === true
    ? "cone"
    : "ellipsoid";

/** The cylinders a packed tree is read into for a ray (never handed out). */
const scratchTrunk: Cylinder = { x: 0, z: 0, y0: 0, y1: 0, r: TRUNK_R };
const scratchCrown: Cylinder = { x: 0, z: 0, y0: 0, y1: 0, r: 0 };

/**
 * One cell's packed trees as a set. Its own function, so the closure holds
 * only what it reads — not the build's scope (the parsed features).
 */
function packedTreeSet(
  box: Aabb,
  solids: Float32Array,
  index: Int32Array,
  target: (i: number) => FeatureInquiry
): AskSet<FeatureInquiry> {
  const cylinders = (k: number): [Cylinder, Cylinder] => {
    const at = k * TREE_STRIDE;
    const [x, z, y0, yb, yt, r] = solids.subarray(at, at + TREE_STRIDE);
    return [
      { x, z, y0, y1: yb, r: TRUNK_R },
      { x, z, y0: yb, y1: yt, r },
    ];
  };
  // read into the two scratch cylinders: the autofocus asks ten times a
  // second, through every tree of the cells its ray enters
  const distance = (o: Xyz, d: Xyz, k: number): number => {
    const at = k * TREE_STRIDE;
    scratchTrunk.x = solids[at];
    scratchTrunk.z = solids[at + 1];
    scratchTrunk.y0 = solids[at + 2];
    scratchTrunk.y1 = solids[at + 3];
    scratchCrown.x = scratchTrunk.x;
    scratchCrown.z = scratchTrunk.z;
    scratchCrown.y0 = scratchTrunk.y1;
    scratchCrown.y1 = solids[at + 4];
    scratchCrown.r = solids[at + 5];
    return Math.min(
      rayCylinder(o, d, scratchTrunk) ?? Number.POSITIVE_INFINITY,
      rayCylinder(o, d, scratchCrown) ?? Number.POSITIVE_INFINITY
    );
  };
  const hit = (k: number, t: number): AskHit<FeatureInquiry> => {
    const [trunk, crown] = cylinders(k);
    const made = target(index[k]);
    return {
      distance: t,
      target: made,
      solids: [{ cylinder: trunk }, { cylinder: crown, crown: crownOf(made) }],
    };
  };
  return {
    box,
    along: (o, d, far) => {
      const out: AskHit<FeatureInquiry>[] = [];
      for (let k = 0; k < index.length; k += 1) {
        const t = distance(o, d, k);
        if (t <= far) {
          out.push(hit(k, t));
        }
      }
      return out.sort((a, b) => a.distance - b.distance);
    },
    nearest: (o, d, far) => {
      let best = -1;
      let reach = far;
      for (let k = 0; k < index.length; k += 1) {
        const t = distance(o, d, k);
        if (t <= reach) {
          reach = t;
          best = k;
        }
      }
      if (best < 0) {
        return null;
      }
      return hit(best, reach);
    },
  };
}

/**
 * The inventory trees as askable things (index = the trees file's),
 * packed: a tile has thousands, and each as objects of its own held 3.5 MB
 * on the busiest tile (7 453 trees); packed, the tile's askables hold
 * 0.8 MB. Per 64 m cell a typed array of trunk-and-crown cylinders; the
 * inquiry is made only for the tree a ray meets.
 */
export function treeSets(
  features: readonly TreeFeature[],
  ctx: OwnGroundContext
): AskSet<FeatureInquiry>[] {
  const ground = ctx.treeHeightAt;
  const n = features.length;
  const table: TreeTable = {
    position: new Float64Array(n * 2),
    height: new Float32Array(n),
    crown: new Float32Array(n),
    trunk: new Float32Array(n),
    genus: new Uint8Array(n),
    flags: new Uint8Array(n),
  };
  const target = (i: number) => treeInquiry(table, i, ctx.tile);
  return packedCylinderSets(
    n,
    (i) => {
      const f = features[i];
      const p = f.properties;
      if (f.geometry?.type !== "Point" || !p) {
        return null;
      }
      const [ex, ey] = f.geometry.coordinates;
      const y = ground(ex, ey);
      if (y === null) {
        return null;
      }
      const archetype = archetypeOf(p.a);
      const ext = treeExtents(p.h, p.d, archetype, p.g === 1);
      const { x, z } = epsgToWorld(ex, ey, ctx.offset);
      table.position.set([ex, ey], i * 2);
      table.height[i] = p.h;
      table.crown[i] = p.d;
      table.trunk[i] = p.t ?? 0;
      table.genus[i] = p.gn ?? 0;
      table.flags[i] =
        (p.s === "osm" ? 1 : 0) |
        (NEEDLE_ARCHETYPES.has(archetype) ? 2 : 0) |
        (p.s === "orchard" ? 4 : 0) |
        (p.m === 1 ? 8 : 0) |
        (ARCHETYPE_SHAPE[archetype] === "cone" ? 16 : 0);
      return [
        x,
        z,
        y,
        y + ext.crownBase,
        y + ext.crownTop,
        Math.max(ext.crownWidth / 2, MIN_CROWN_R),
      ];
    },
    target
  );
}

/** One packed tree: x, z, ground, crown base, crown top, crown radius. */
export type PackedTree = [number, number, number, number, number, number];

/**
 * Trees as packed trunk-and-crown cylinders, per TREE_CELL cell a typed
 * array: `put(i)` places tree i (or leaves it out with null), `target(i)`
 * makes its inquiry only when a ray meets it.
 */
export function packedCylinderSets(
  n: number,
  put: (i: number) => PackedTree | null,
  target: (i: number) => FeatureInquiry
): AskSet<FeatureInquiry>[] {
  const cells = new Map<string, { box: Aabb; trees: number[] }>();
  const packed: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const tree = put(i);
    if (!tree) {
      continue;
    }
    const [x, z, y, , top, r] = tree;
    const key = `${Math.floor(x / TREE_CELL)},${Math.floor(z / TREE_CELL)}`;
    const cell = cells.get(key);
    const box = cylindersBox(x, z, y, top, r, cell?.box);
    if (cell) {
      cell.box = box;
      cell.trees.push(i);
    } else {
      cells.set(key, { box, trees: [i] });
    }
    for (let c = 0; c < TREE_STRIDE; c += 1) {
      packed[i * TREE_STRIDE + c] = tree[c];
    }
  }
  return [...cells.values()].map(({ box, trees }) => {
    const solids = new Float32Array(trees.length * TREE_STRIDE);
    for (let k = 0; k < trees.length; k += 1) {
      const i = trees[k];
      for (let c = 0; c < TREE_STRIDE; c += 1) {
        solids[k * TREE_STRIDE + c] = packed[i * TREE_STRIDE + c];
      }
    }
    return packedTreeSet(box, solids, Int32Array.from(trees), target);
  });
}

/** The measured form's height (m), when the bake measured one. */
const reliefTop = (p: NonNullable<MonumentFeature["properties"]>) =>
  p.relief && p.relief.dm.length > 0 ? Math.max(...p.relief.dm) / 10 : 0;

/** The monument's solid: a basin's prism, else a cylinder over its point. */
function monumentSolid(
  f: MonumentFeature,
  ctx: AskContext
): { position: [number, number]; solid: AskSolid } | null {
  const p = f.properties;
  if (!p) {
    return null;
  }
  const g = f.geometry;
  const ring = g.type === "Polygon" ? g.coordinates[0] : null;
  const [ex, ey] = ring
    ? ringCentre(ring)
    : (g.coordinates as [number, number]);
  const y = ctx.heightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const top = reliefTop(p);
  if (ring) {
    return {
      position: [ex, ey],
      solid: {
        prism: {
          ring: ring.map(([x, yy]) => {
            const w = epsgToWorld(x, yy, ctx.offset);
            return [w.x, w.z] as const;
          }),
          y0: y - 0.2,
          y1: y + Math.max(BASIN_RIM, top),
        },
      },
    };
  }
  // the solids the layer draws (monument-layer.ts): the same marker
  const marker =
    p.kind === "fountain" ? null : monumentMarker(p, p.kind, [ex, ey]);
  const pieces = marker?.pieces ?? null;
  const r = pieces
    ? Math.max(
        ...pieces.map(
          (s) => Math.hypot(s.width, s.depth) / 2 + Math.abs(s.along)
        )
      ) + 0.3
    : pointBasinRadius(p.r);
  const height = Math.max(
    top,
    pieces ? Math.max(...pieces.map((s) => s.lift + s.height)) : BASIN_RIM
  );
  const [cx, cy] = marker?.centre ?? [ex, ey];
  const { x, z } = epsgToWorld(cx, cy, ctx.offset);
  return {
    position: [ex, ey],
    solid: { cylinder: { x, z, y0: y - 0.2, y1: y + height, r } },
  };
}

/** The monuments and fountains as askable things. */
export function monumentItems(
  features: readonly MonumentFeature[],
  ctx: AskContext
): AskItem<FeatureInquiry>[] {
  const out: AskItem<FeatureInquiry>[] = [];
  for (const f of features) {
    const placed = monumentSolid(f, ctx);
    if (placed && f.properties) {
      out.push({
        solids: [placed.solid],
        target: {
          kind: "monument",
          tile: ctx.tile,
          position: placed.position,
          properties: f.properties,
        },
      });
    }
  }
  return out;
}

/** The deck top along a bridge's measured line (world Y at x, z). */
function deckTop(
  p: NonNullable<BridgeFeature["properties"]>,
  ctx: AskContext
): ((x: number, z: number) => number) | null {
  const frame = p.axis ? axisFrame(p.axis) : null;
  const line = p.line ?? [];
  if (frame && line.length > 0) {
    return (x, z) => {
      const { s } = frame.project(x + ctx.offset.cx, ctx.offset.cy - z);
      const at = Math.min(Math.max(s / BRIDGE_STEP, 0), line.length - 1);
      const i = Math.floor(at);
      const j = Math.min(i + 1, line.length - 1);
      return line[i] + (line[j] - line[i]) * (at - i);
    };
  }
  const deck = (p.deck ?? []).filter(Number.isFinite);
  if (deck.length === 0) {
    return null;
  }
  const mean = deck.reduce((a, b) => a + b, 0) / deck.length;
  return () => mean;
}

/** The bridge decks the tile draws, as askable things. */
export function bridgeItems(
  features: readonly BridgeFeature[],
  ctx: AskContext
): AskItem<FeatureInquiry>[] {
  const out: AskItem<FeatureInquiry>[] = [];
  for (const f of features) {
    const p = f.properties;
    const ring =
      f.geometry?.type === "Polygon" ? f.geometry.coordinates[0] : null;
    const topAt = p ? deckTop(p, ctx) : null;
    if (!(p && ring && ring.length >= 3 && topAt)) {
      continue;
    }
    const centre = ringCentre(ring);
    if (ctx.owns && !ctx.owns(centre[0], centre[1])) {
      continue;
    }
    const heights = [...(p.line ?? []), ...(p.deck ?? [])].filter(
      Number.isFinite
    );
    const below = (p.depth ?? 0) + DECK_BELOW;
    out.push({
      solids: [
        {
          slab: {
            ring: ring.map(([x, y]) => {
              const w = epsgToWorld(x, y, ctx.offset);
              return [w.x, w.z] as const;
            }),
            y0: Math.min(...heights) - below,
            y1: Math.max(...heights) + DECK_ABOVE,
            topAt,
            above: DECK_ABOVE,
            below,
          },
        },
      ],
      target: {
        kind: "bridge",
        tile: ctx.tile,
        position: centre,
        length: (p.axis ? axisFrame(p.axis)?.length : 0) ?? 0,
        properties: p,
      },
    });
  }
  return out;
}

/** The canopy tree's crown at scale 1 (vegetation-layer.ts: a trunk of
 *  2.4 m, a lobed crown of radius ~2.1 m round 3.45 m), as picked. */
const CANOPY = { base: 1.6, top: BASE_TREE_H + 0.4, r: 2.3 };
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

/** A flagpole's ball over its top (m), picked with the mast. */
const FLAG_BALL = 0.2;

/** How tall a piece is picked: a signal on a mast arm by its mast
 *  (furniture-layer.ts `signalArm`), a flagpole by its tagged height and
 *  the ball on top, the rest by its kind. */
function solidHeight(
  p: NonNullable<FurnitureFeature["properties"]>,
  base: number
): number {
  if (p.arm) {
    return 6.2;
  }
  return p.k === "flag" ? (p.h ?? FLAG_HEIGHT) + FLAG_BALL : base;
}

/** A flag's cloth, picked as a cylinder round its middle (it flies
 *  downwind of the mast, `flagYaw`, and ripples a little): the mast's
 *  solid `mast`, at EPSG (x, y). */
function clothSolid(
  [ex, ey]: readonly [number, number],
  mast: AskSolid
): AskSolid | null {
  if (!("cylinder" in mast)) {
    return null;
  }
  const yaw = flagYaw(ex, ey);
  const half = FLAG_CLOTH_L / 2;
  // local +X turned by yaw: (cos, −sin) in the scene's x–z
  const top = mast.cylinder.y1 - FLAG_BALL;
  return {
    cylinder: {
      x: mast.cylinder.x + Math.cos(yaw) * half,
      z: mast.cylinder.z - Math.sin(yaw) * half,
      y0: top - FLAG_CLOTH_H - 0.2,
      y1: top,
      r: half,
    },
  };
}

/** Each furniture kind picked as a cylinder: radius, height (m). */
const FURNITURE_SOLID: Record<FurnitureKind, [number, number]> = {
  bench: [1, 1],
  bike: [0.9, 1],
  bin: [0.45, 1.1],
  bollard: [0.3, 1],
  clock: [0.5, 4.2],
  column: [0.8, 3.2],
  flag: [0.4, FLAG_HEIGHT + FLAG_BALL],
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
  ctx: OwnGroundContext,
  deck?: number
): AskSolid | null {
  // on a bridge, its deck's top (pipeline/bake/furniture.py `Decks`)
  const y = deck ?? ctx.treeHeightAt(ex, ey);
  if (y === null) {
    return null;
  }
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
  return { cylinder: { x, z, y0: y - 0.2, y1: y + h, r } };
}

/** A lamp's head hung over the street at EPSG (x, y). */
function hanging(
  [ex, ey]: readonly [number, number],
  ctx: OwnGroundContext
): AskSolid | null {
  const y = ctx.treeHeightAt(ex, ey);
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
  ctx: OwnGroundContext
): AskSolid | null {
  const y = ctx.treeHeightAt(ex, ey);
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
function armHead(f: LampFeature, y: number, ctx: OwnGroundContext): AskSolid[] {
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
function lampSolids(f: LampFeature, ctx: OwnGroundContext): AskSolid[] {
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

/** Trees and rows placed per step (build-steps.ts). */
const PLACE_RUN = 256;
const ROW_RUN = 16;

interface AskedTree {
  height?: number;
  leaf?: CanopyInquiry["evergreen"];
  p: Placement;
  source: CanopyInquiry["source"];
}

/**
 * The trees the canopy draws (the DOM1 crowns, the laser scan's, the
 * Basis-DLM rows' trees), placed as the layer places them — with the same
 * veto of the trees a register names — and packed, in steps: per run of
 * trees placed (build-steps.ts).
 *
 * @yields {void} once per run of trees placed
 */
function* canopySetsSteps(
  features: {
    canopy: CanopyFeature[];
    rows: VegRowFeature[];
    scan: CanopyFeature[];
  },
  ctx: OwnGroundContext,
  keepTree?: TreeVeto
): Steps<AskSet<FeatureInquiry>[]> {
  const place = { heightAt: ctx.treeHeightAt, offset: ctx.offset };
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
  for (let i = 0; i < trees.length; i += 1) {
    const t = trees[i];
    position.set(epsgOf(t.p, ctx.offset), i * 2);
    height[i] = t.height && Number.isFinite(t.height) ? t.height : 0;
    source[i] = sources.indexOf(t.source);
    leaf[i] =
      (t.leaf ? LEAVES.indexOf(t.leaf) + 1 : 0) |
      (canopyCone(t.p) ? LEAF_CONE : 0);
  }
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
const leafOf = (f: CanopyFeature): CanopyInquiry["evergreen"] => {
  if (f.properties?.l !== "e") {
    return undefined;
  }
  return f.properties.ls === "dop" ? "photo" : "forest";
};

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
  for (let i = 1; i < coords.length; i += 1) {
    sum += Math.hypot(
      coords[i][0] - coords[i - 1][0],
      coords[i][1] - coords[i - 1][1]
    );
  }
  return sum;
}

/** A hedge's size (m) where the data gives none (the Basis-DLM's): its
 *  card and its drawn block (low-vegetation-layer.ts) both use it. */
export const DEFAULT_HEDGE_H = 1.6;
export const DEFAULT_HEDGE_W = 1.2;

/** The hedges (OSM's and the Basis-DLM's): a pick every HEDGE_STEP. */
export function hedgeItems(
  osm: readonly LowVegFeature[],
  rows: readonly VegRowFeature[],
  ctx: OwnGroundContext
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
    const h = p?.h ?? DEFAULT_HEDGE_H;
    const w = p?.w ?? DEFAULT_HEDGE_W;
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
  ctx: OwnGroundContext
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
  ctx: OwnGroundContext
): AskItem<FeatureInquiry>[] {
  const [r, base] = FURNITURE_SOLID[p.k] ?? [0.6, 1];
  const h = solidHeight(p, base);
  if (f.geometry.type === "Point") {
    const at = f.geometry.coordinates;
    const solid = standing(at, r, h, ctx, p.deck);
    const cloth = solid && p.k === "flag" ? clothSolid(at, solid) : null;
    return solid
      ? [
          {
            solids: cloth ? [solid, cloth] : [solid],
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
  const y = ctx.treeHeightAt(centre[0], centre[1]);
  if (y === null || ring.length < 3) {
    return [];
  }
  return [
    {
      // a box over the outline, not its shape (`toleranceBox`)
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

/**
 * Whether an item's solids are a box the probe tolerates round what is
 * drawn — a landing stage's, an outline's prism over the surface it marks
 * (`furnitureItems`, `landingItems`), a fountain's basin up to its
 * figure's top (`monumentSolid`) — not its shape: a ray may name it, the
 * lens never focuses on it. Read from the item, never stored on it
 * (ADR 0047).
 */
export function toleranceBox(item: AskItem<FeatureInquiry>): boolean {
  const { target } = item;
  const prism = item.solids.some((s) => "prism" in s);
  return (
    target.kind === "landing" ||
    (target.kind === "furniture" && prism) ||
    // a basin's box reaches up to its figure's top (`monumentSolid`)
    (target.kind === "monument" &&
      (prism || target.properties.kind === "fountain"))
  );
}

/** The landing stages and pontoons (their outlines; groynes and ferry
 *  lines stay unasked). */
export function landingItems(
  features: readonly RiversideFeature[],
  ctx: OwnGroundContext
): AskItem<FeatureInquiry>[] {
  const out: AskItem<FeatureInquiry>[] = [];
  for (const f of features) {
    const p = f.properties;
    if (!(p && f.geometry.type === "Polygon")) {
      continue;
    }
    const ring = f.geometry.coordinates[0];
    const centre = ringCentre(ring);
    const ground = ctx.treeHeightAt(centre[0], centre[1]);
    const deck = p.deck ?? ground;
    if (deck === null || deck === undefined || ring.length < 3) {
      continue;
    }
    out.push({
      // a box round the stage, not its shape (`toleranceBox`)
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
  ctx: OwnGroundContext,
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

/**
 * `moreSets` in steps (build-steps.ts).
 *
 * @yields {void} between the sets, so the build can be spread over frames
 */
export function* moreSetsSteps(
  features: MoreFeatures,
  ctx: OwnGroundContext,
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
