/**
 * The askable things of one tile that are not buildings (plan 049 phase
 * 4), as the inquiry probe tests them: each tree of the trees file, each
 * monument and fountain, each bridge deck the tile draws — its solids in
 * the Y-up world frame (lib/city/ask-solids.ts) and the inquiry it
 * answers with. Built with the tile's dressing from the features the
 * dressing already fetched; sized as the layers draw them, so a ray meets
 * what is on screen. No THREE, no DOM.
 */
import type { AskItem, AskSolid } from "./ask-solids";
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

/** The inventory trees as askable things (index = the trees file's). */
export function treeItems(
  features: readonly TreeFeature[],
  ctx: AskContext
): AskItem<FeatureInquiry>[] {
  const ground = ctx.treeHeightAt ?? ctx.heightAt;
  const out: AskItem<FeatureInquiry>[] = [];
  features.forEach((f, index) => {
    const p = f.properties;
    if (f.geometry?.type !== "Point" || !p) {
      return;
    }
    const [ex, ey] = f.geometry.coordinates;
    const y = ground(ex, ey);
    if (y === null) {
      return;
    }
    const archetype = archetypeOf(p.a);
    const ext = treeExtents(p.h, p.d, archetype, p.g === 1);
    const { x, z } = epsgToWorld(ex, ey, ctx.offset);
    out.push({
      solids: [
        { cylinder: { x, z, y0: y, y1: y + ext.crownBase, r: TRUNK_R } },
        {
          cylinder: {
            x,
            z,
            y0: y + ext.crownBase,
            y1: y + ext.crownTop,
            r: Math.max(ext.crownWidth / 2, MIN_CROWN_R),
          },
        },
      ],
      target: {
        kind: "tree",
        tile: ctx.tile,
        index,
        position: [ex, ey],
        osm: p.s === "osm",
        conifer: archetype === "conifer",
        genus: TREE_GENERA[p.gn ?? 0] ?? "",
        height: p.h,
        crown: p.d,
        ...(p.t ? { trunk: p.t } : {}),
      },
    });
  });
  return out;
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
