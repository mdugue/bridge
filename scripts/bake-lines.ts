/**
 * The rails, trams and riverside a fine terrain level carries (plan 074
 * part A, ADR 0029): built by the same pure builders the viewer used to
 * run per tile (lib/city/rail-mesh.ts, tram-mesh.ts, riverside-mesh.ts) on
 * the fine ground of every tile, as glTF nodes beside the terrain grid
 * (scripts/tile-glb.ts) — one node per part, named as lib/city/
 * line-nodes.ts says, which the viewer gives its material
 * (app/_components/line-looks.ts). A mast, a pile and a post are merged
 * where they stand from three's cylinder and box (the viewer instanced
 * them). Positions are quantised like the walls' (16 bits over the
 * node's extent: ±1.5 cm over a tile; float positions were measured and
 * left out, plan 074's findings). The features come from scripts/line-sources.ts. Apart from bake-tiles.ts, so
 * the ground's cache key does not carry these modules. Build-time only;
 * no DOM.
 */
import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Matrix4,
  Quaternion,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";
import type { RiversideFeature, TramFeature } from "../lib/city/features";
import type { LineNode } from "../lib/city/line-nodes";
import type { Mesh3, Triangulate } from "../lib/city/mesh3";
import { railParts } from "../lib/city/rail-mesh";
import {
  type Column,
  landings,
  riversideParts,
  type Wake,
} from "../lib/city/riverside-mesh";
import { MAST_HEIGHT_M } from "../lib/city/tram";
import { tramParts, tramStops } from "../lib/city/tram-mesh";
import type { Wires } from "../lib/city/wire-mesh";
import type { LineFeatures } from "./line-sources";
import type { ChildInput } from "./tile-glb";

/** three's triangulation (`ShapeUtils.triangulateShape`), as the viewer
 *  ran it. */
export const triangulate: Triangulate = (contour, holes) =>
  ShapeUtils.triangulateShape(
    contour.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y)))
  );

/** What the inquiry asks of a tile's lines once they are baked: the tram
 *  stops and the landing stages, carried in the fine terrain's extras
 *  (lib/city/tileset.ts `TerrainExtras.asked`). */
export interface AskedLines {
  landings: RiversideFeature[];
  stops: TramFeature[];
}

/** World frame (Y-up) → the recentered data frame (Z-up) the glTF writer
 *  takes: (x, y, z) → (x, −z, y). */
function worldToData(xyz: ArrayLike<number>): Float32Array<ArrayBuffer> {
  const out = new Float32Array(xyz.length);
  for (let i = 0; i < xyz.length; i += 3) {
    out[i] = xyz[i];
    out[i + 1] = -xyz[i + 2];
    out[i + 2] = xyz[i + 1];
  }
  return out;
}

/** A soup as a node, its shared corners welded; null when empty. */
function soup(name: LineNode, acc: Mesh3): ChildInput | null {
  if (acc.pos.length === 0) {
    return null;
  }
  return {
    name,
    positions: worldToData(acc.pos),
    normals: worldToData(acc.nrm),
    weld: true,
  };
}

/** `unit` placed by each matrix, merged into one soup (as the instanced
 *  set drew it: the normals turned by each matrix). */
function merged(
  name: LineNode,
  unit: BufferGeometry,
  matrices: Matrix4[]
): ChildInput | null {
  if (matrices.length === 0) {
    return null;
  }
  const flat = unit.index ? unit.toNonIndexed() : unit;
  const acc: Mesh3 = { pos: [], nrm: [] };
  for (const m of matrices) {
    const g = flat.clone().applyMatrix4(m);
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      acc.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      acc.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    g.dispose();
  }
  return soup(name, acc);
}

/** A vertical column (a pile, a post) as the matrix of a unit cylinder or
 *  box centred on the origin (riverside-layer.ts drew them so). */
function columnMatrix(c: Column): Matrix4 {
  return new Matrix4().compose(
    new Vector3(c.x, (c.y0 + c.y1) / 2, c.z),
    new Quaternion(),
    new Vector3(1, Math.max(c.y1 - c.y0, 0.01), 1)
  );
}

/** The wires as a node: centre points, the segment direction (in the
 *  glTF's Y-up frame as it is: custom attributes are written untouched),
 *  side and half-width — app/_components/wire-ribbons.ts's attributes. */
function wireNode(name: LineNode, w: Wires): ChildInput | null {
  if (w.index.length === 0) {
    return null;
  }
  return {
    name,
    positions: worldToData(w.pos),
    attributes: {
      _WIREDIR: { array: new Float32Array(w.dir), type: "VEC3" },
      _WIRESIDE: new Float32Array(w.side),
      _WIREHALF: new Float32Array(w.half),
    },
    indices: new Uint32Array(w.index),
  };
}

/** The ferry wake as a node: its ribbon and its arc length per vertex. */
function wakeNode(name: LineNode, wake: Wake): ChildInput | null {
  if (wake.index.length === 0) {
    return null;
  }
  return {
    name,
    positions: worldToData(wake.pos),
    attributes: { _WAKEALONG: new Float32Array(wake.along) },
    indices: new Uint32Array(wake.index),
  };
}

/** What the inquiry asks of a tile's baked lines (the fine terrain's
 *  extras carry it), or nothing when the tile has none. */
export function askedLines(
  features: Pick<LineFeatures, "river" | "trams">
): AskedLines | undefined {
  const asked = {
    stops: tramStops(features.trams),
    landings: landings(features.river),
  };
  return asked.stops.length > 0 || asked.landings.length > 0
    ? asked
    : undefined;
}

/**
 * A tile's rails, trams and riverside as the fine terrain glTF's nodes
 * (each absent where the tile has none of it), standing on `heightAt` —
 * the fine ground of every tile. `owns`: whether the tile draws a span
 * deck centred there (its owner).
 */
export function lineNodes(
  features: LineFeatures,
  ctx: {
    heightAt: (x: number, y: number) => number | null;
    offset: { cx: number; cy: number };
    owns: (x: number, y: number) => boolean;
  }
): ChildInput[] {
  const mesh = { ...ctx, triangulate };
  const rail = railParts(
    {
      rails: features.rails,
      ballast: features.ballast,
      platforms: features.platforms,
      bridges: features.bridges,
    },
    mesh
  );
  const tram = tramParts(features.trams, features.bridges, mesh);
  const river = riversideParts(features.river, mesh);
  const mast = new CylinderGeometry(0.1, 0.14, MAST_HEIGHT_M + 0.2, 8);
  mast.translate(0, (MAST_HEIGHT_M + 0.2) / 2, 0);
  const pile = new CylinderGeometry(0.14, 0.14, 1, 8);
  const post = new BoxGeometry(0.06, 1, 0.06);
  const children = [
    soup("rail-ballast", rail.ballast),
    soup("rail-tracks", rail.tracks),
    soup("rail-platforms", rail.platforms),
    soup("rail-span-top", rail.spanTop),
    soup("rail-span-stone", rail.spanStone),
    soup("tram-rails", tram.tracks.rail),
    soup("tram-street-rails", tram.tracks.streetRail),
    soup("tram-grass", tram.tracks.grass),
    soup("tram-ballast", tram.tracks.ballast),
    soup("tram-span-top", tram.spanTop),
    soup("tram-span-stone", tram.spanStone),
    merged(
      "tram-masts",
      mast,
      tram.masts.map((p) => new Matrix4().makeTranslation(p.x, p.y, p.z))
    ),
    wireNode("tram-wires", tram.wires),
    soup("riverside-pier", river.deck),
    soup("riverside-hull", river.hull),
    soup("riverside-pontoon-deck", river.pontoonDeck),
    soup("riverside-hut", river.hut),
    soup("riverside-roof", river.roof),
    soup("riverside-gangway", river.gangway),
    soup("riverside-railing", river.railing),
    soup("riverside-groyne", river.groyne),
    merged("riverside-piles", pile, river.piles.map(columnMatrix)),
    merged("riverside-posts", post, river.posts.map(columnMatrix)),
    wakeNode("riverside-ferry", river.ferry),
  ].filter((c): c is ChildInput => c !== null);
  for (const g of [mast, pile, post]) {
    g.dispose();
  }
  return children;
}
