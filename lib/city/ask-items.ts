/**
 * The askable things of one tile that are not buildings (plan 052 phase
 * 4), as the inquiry probe tests them: each tree of the trees file, each
 * monument and fountain, each bridge deck the tile draws — its solids in
 * the Y-up world frame (lib/city/ask-solids.ts) and the inquiry it
 * answers with. Built with the tile's dressing from the features the
 * dressing already fetched; sized as the layers draw them, so a ray meets
 * what is on screen. No THREE, no DOM.
 */
import {
  type Aabb,
  type AskHit,
  type AskItem,
  type AskSet,
  type AskSolid,
  type Cylinder,
  cylindersBox,
  rayCylinder,
  type Xyz,
} from "./ask-solids";
import { axisFrame, BRIDGE_STEP } from "./bridge";
import type { BridgeFeature, MonumentFeature, TreeFeature } from "./features";
import { epsgToWorld, type RecenterOffset } from "./ground-clamp";
import type { FeatureInquiry } from "./inquiry-features";
import { MARKER_SHAPE, POINT_BASIN_R, ringCentre } from "./monuments";
import { archetypeOf, treeExtents } from "./tree-inventory";
import { TREE_GENERA } from "./tree-season";

type HeightAt = (x: number, y: number) => number | null;

export interface AskContext {
  offset: RecenterOffset;
  /** ground over every loaded terrain (projected coordinates) */
  heightAt: HeightAt;
  /** whether the tile draws a deck that crosses its seam (its centroid) */
  owns?: (x: number, y: number) => boolean;
  tile: string;
  /** ground of the tile's own terrain, which the trees stand on */
  treeHeightAt?: HeightAt;
}

/** A trunk is picked a little wider than it is drawn (m). */
const TRUNK_R = 0.35;
/** A crown narrower than this is still a target a finger can hit (m). */
const MIN_CROWN_R = 0.8;
/** The tallest a pick reaches above a monument with no measured form. */
const BASIN_RIM = 1;
/** How far the deck's pick reaches over and under the measured top (m):
 *  the railing; the slab (rail-layer.ts DECK_DEPTH) and a little. */
const DECK_ABOVE = 1.3;
const DECK_BELOW = 1.3;

/** One tree packed: x, z, ground, crown base, crown top, crown radius. */
const TREE_STRIDE = 6;
/** The cell a packed tree set covers (m). */
const TREE_CELL = 64;

/** What a tile knows of its trees beyond their solids, by feature index. */
interface TreeTable {
  crown: Float32Array;
  /** bit 1 OSM, bit 2 conifer, bit 4 orchard */
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
    genus: TREE_GENERA[t.genus[i]] ?? "",
    height: t.height[i],
    crown: t.crown[i],
    ...(trunk > 0 ? { trunk } : {}),
  };
}

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
  const distance = (o: Xyz, d: Xyz, k: number): number => {
    const [trunk, crown] = cylinders(k);
    return Math.min(
      rayCylinder(o, d, trunk) ?? Number.POSITIVE_INFINITY,
      rayCylinder(o, d, crown) ?? Number.POSITIVE_INFINITY
    );
  };
  const hit = (k: number, t: number): AskHit<FeatureInquiry> => {
    const [trunk, crown] = cylinders(k);
    return {
      distance: t,
      target: target(index[k]),
      solids: [{ cylinder: trunk }, { cylinder: crown }],
    };
  };
  return {
    box,
    along: (o, d, far) => {
      const out: AskHit<FeatureInquiry>[] = [];
      for (let k = 0; k < index.length; k++) {
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
      for (let k = 0; k < index.length; k++) {
        const [trunk, crown] = cylinders(k);
        const t = Math.min(
          rayCylinder(o, d, trunk) ?? Number.POSITIVE_INFINITY,
          rayCylinder(o, d, crown) ?? Number.POSITIVE_INFINITY
        );
        if (t <= reach) {
          reach = t;
          best = k;
        }
      }
      if (best < 0) {
        return null;
      }
      const [trunk, crown] = cylinders(best);
      return {
        distance: reach,
        target: target(index[best]),
        solids: [{ cylinder: trunk }, { cylinder: crown }],
      };
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
  ctx: AskContext
): AskSet<FeatureInquiry>[] {
  const ground = ctx.treeHeightAt ?? ctx.heightAt;
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
        (archetype === "conifer" ? 2 : 0) |
        (p.s === "orchard" ? 4 : 0);
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
  for (let i = 0; i < n; i++) {
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
    for (let c = 0; c < TREE_STRIDE; c++) {
      packed[i * TREE_STRIDE + c] = tree[c];
    }
  }
  return [...cells.values()].map(({ box, trees }) => {
    const solids = new Float32Array(trees.length * TREE_STRIDE);
    trees.forEach((i, k) => {
      for (let c = 0; c < TREE_STRIDE; c++) {
        solids[k * TREE_STRIDE + c] = packed[i * TREE_STRIDE + c];
      }
    });
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
  const shape = p.kind === "fountain" ? null : MARKER_SHAPE[p.kind];
  const r = shape
    ? Math.max(shape.width, shape.depth) / 2 + 0.3
    : POINT_BASIN_R;
  const height = Math.max(top, shape?.height ?? BASIN_RIM);
  const { x, z } = epsgToWorld(ex, ey, ctx.offset);
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
