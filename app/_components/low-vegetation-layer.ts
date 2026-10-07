import { SINK } from "@/lib/city/ground-join";
import {
  type BufferGeometry,
  Color,
  Group,
  type MeshStandardNodeMaterial,
  Object3D,
} from "three/webgpu";
import type { LowVegFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import { Instances } from "./instancing";
import { bucketByCell, hash } from "./vegetation-layer";
import { buildHedgeGeo, hedgeMaterial, hedgeTint } from "./hedge-look";
import { clamp } from "@/lib/city/math";

export { buildHedgeGeo } from "./hedge-look";

/**
 * Hedges — the OSM `barrier=hedge` lines, at the laser-scan height where the
 * scan sees one (pipeline/bake/lowveg.py). The bake's laser-scan-only
 * hedges and its shrubs are not shipped (docs/transformations.md: about 30 %
 * of them are crown rims, and a shrub dome reads as a faceted boulder up
 * close), so the artifact holds only what this layer draws.
 *
 * Kept apart from vegetation-layer.ts on purpose: nothing here animates (a
 * trimmed hedge does not sway, and ADR 0020 keeps casters static anyway), so
 * it needs none of the crown material (only its value noise), and the tree
 * layer stays untouched.
 *
 * - A hedge is a chain of soft superellipsoid "clay" blocks, one instance per
 *   ≤2.5 m piece of the polyline, stretched to the piece's length and to the
 *   baked height and width, overlapping so the joins read as waists, not seams.
 * The material: pastel moss with a darker rooted base (the
 * trunks' trick), a static world-space foliage mottle, per-instance tint
 * jitter; the scene's fog (height-fog.ts) reaches it like every material.
 * Chunked into 250 m cells like the trees, so off-screen cells cull out of the
 * main AND the shadow pass.
 */

/** longest hedge piece (m); longer runs are split so the lumps stay hedge-sized */
const HEDGE_PIECE_M = 2.5;
/** each piece reaches this far into its neighbours so the chain has no gaps */
const HEDGE_OVERLAP_M = 0.6;
/** instances are sunk this far so the terrain's ~2 m facets never show a gap */
const SINK_M = SINK.planted;
/** sanity clamps on the baked sizes */
const H_RANGE: [number, number] = [0.4, 3.5];
const W_RANGE: [number, number] = [0.5, 3];

/** One hedge instance: centre, heading and extents, in EPSG metres. */
export interface HedgePiece {
  /** heading of the piece, radians from +x (east) toward +y (north) */
  angle: number;
  h: number;
  len: number;
  w: number;
  x: number;
  y: number;
}

/**
 * Splits a hedge polyline into pieces no longer than HEDGE_PIECE_M, each
 * carrying the hedge's height and width. Pure (EPSG in, EPSG out), for tests.
 */
export function hedgePieces(
  coords: Point2[],
  h: number,
  w: number
): HedgePiece[] {
  const pts = subdividePolyline(coords, HEDGE_PIECE_M);
  const out: HedgePiece[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 0.05) {
      continue;
    }
    out.push({
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      angle: Math.atan2(y1 - y0, x1 - x0),
      len,
      h,
      w,
    });
  }
  return out;
}

interface Instance {
  /** heading about +Y (world) */
  rot: number;
  sx: number;
  sy: number;
  sz: number;
  /** tint jitter −0.5..0.5 */
  tint: number;
  x: number;
  y: number;
  z: number;
}

function buildChunks(
  items: Instance[],
  geo: BufferGeometry,
  mat: MeshStandardNodeMaterial
): Instances[] {
  const dummy = new Object3D();
  const col = new Color();
  return bucketByCell(items).map((cell) => {
    const mesh = new Instances(geo, mat, cell.length);
    mesh.name = "lowveg-hedge";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cell.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      hedgeTint(col, p.tint);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceTints) {
      mesh.instanceTints.needsUpdate = true;
    }
    // Without this the cull test uses the unit geometry's sphere at the origin.
    mesh.computeBoundingSphere();
    return mesh;
  });
}

function hedgeInstances(
  features: LowVegFeature[],
  ctx: GroundContext
): Instance[] {
  const out: Instance[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString" || !f.properties) {
      continue;
    }
    const h = clamp(f.properties.h ?? 1.5, ...H_RANGE);
    const w = clamp(f.properties.w ?? 1, ...W_RANGE);
    for (const piece of hedgePieces(f.geometry.coordinates, h, w)) {
      const ground = ctx.heightAt(piece.x, piece.y);
      if (ground === null) {
        continue;
      }
      const seed = piece.x * 0.37 + piece.y * 0.11;
      const world = epsgToWorld(piece.x, piece.y, ctx.offset);
      out.push({
        x: world.x,
        y: ground - SINK_M,
        z: world.z,
        // A +Y rotation by the EPSG heading lays local +x along the piece
        // (it turns +x toward −z, which is north); a coin flip of 180° hides
        // that every piece shares one lump pattern.
        rot: piece.angle + (hash(seed) < 0.5 ? 0 : Math.PI),
        sx: piece.len + HEDGE_OVERLAP_M,
        sy: (h + SINK_M) * (0.94 + hash(seed * 1.3) * 0.12),
        sz: w,
        tint: hash(seed * 2.1) - 0.5,
      });
    }
  }
  return out;
}

/** What the hedges need of a tile: its ground. */
export type LowVegetationContext = GroundContext;

/**
 * Builds one tile's hedges onto a Y-up group (add it to `scene`,
 * not the Z-up `world`). Empty input → an empty group; the meshes are freed
 * with the scene (disposeObject3D).
 */
export function buildLowVegetation(
  features: LowVegFeature[],
  ctx: LowVegetationContext
): Group {
  const group = new Group();
  group.name = "low-vegetation";
  const hedges = hedgeInstances(features, ctx);
  if (hedges.length > 0) {
    group.add(...buildChunks(hedges, buildHedgeGeo(), hedgeMaterial()));
  }
  return group;
}
