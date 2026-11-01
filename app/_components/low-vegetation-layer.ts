import { SINK } from "@/lib/city/ground-join";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Matrix4,
  MeshStandardNodeMaterial,
  Object3D,
} from "three/webgpu";
import {
  float,
  length,
  materialColor,
  max,
  mix,
  modelWorldMatrix,
  positionGeometry,
  positionView,
  positionWorld,
  smoothstep,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { LowVegFeature, VegRowFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import {
  Instances,
  instanceMatrix,
  instancePosition,
  instanceTint,
} from "./instancing";
import type { F, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";
import { bucketByCell, hash, leafNoise, printedLeaf } from "./vegetation-layer";
import { clamp } from "@/lib/city/math";

/**
 * Hedges — the OSM `barrier=hedge` lines, at the laser-scan height where the
 * scan sees one (pipeline/bake/lowveg.py), and the Basis-DLM's hedge rows
 * (veg04, `kind: "hedge"`) at a default size (`hedgeLines`). The bake's laser-scan-only hedges and its
 * shrubs are not shipped (docs/transformations.md: about 30 % of them are
 * crown rims, and a shrub dome reads as a faceted boulder up close), so the
 * artifact holds only what this layer draws.
 *
 * Kept apart from vegetation-layer.ts on purpose: nothing here animates (a
 * trimmed hedge does not sway, and ADR 0009 keeps casters static anyway), so
 * it needs none of the crown material (only its value noise and, in Comic,
 * its marker ink), and the tree layer stays untouched.
 *
 * - A hedge is a chain of trimmed blocks, one instance per ≤2.5 m piece of
 *   the polyline, stretched to the piece's length and to the height and
 *   width, overlapping past their rounded ends so a run reads as one hedge.
 *   Its leafy lumps and the rise and fall of its top are pushed out in the
 *   vertex stage by a noise read in world space, so overlapping pieces
 *   agree and no seam shows (`hedgeShape`). One tint per hedge, not per
 *   piece, for the same reason.
 * - The material: pastel moss with a darker rooted base (the trunks'
 *   trick), the lumps' relief as light and shade, a fine mottle near the
 *   eye; the scene's fog (height-fog.ts) reaches it like every material.
 * Chunked into 250 m cells like the trees, so off-screen cells cull out of the
 * main AND the shadow pass.
 */

/** longest hedge piece (m); longer runs are split so the lumps stay hedge-sized */
const HEDGE_PIECE_M = 2.5;
/** instances are sunk this far so the terrain's ~2 m facets never show a gap */
const SINK_M = SINK.planted;
/** the flanks narrow by this share of the width from the foot to the top */
const HEDGE_TAPER = 0.14;
/** where the flank turns into the rounded shoulder (share of the height),
 *  and the shoulder's superellipse exponent (2 = round, higher = squarer) */
const HEDGE_SHOULDER_Y = 0.62;
const HEDGE_SHOULDER_P = 2.6;
/** the leafy lumps: their size and how far they push in and out (m) */
const HEDGE_LUMP_WAVE_M = 0.8;
const HEDGE_LUMP_M = 0.09;
/** the slow rise and fall of the top line: its length and height (m) */
const HEDGE_SWELL_WAVE_M = 6;
const HEDGE_SWELL_M = 0.14;
/** the fine leaf mottle fades out between these distances (m) */
const HEDGE_MOTTLE_NEAR_M = 40;
const HEDGE_MOTTLE_FAR_M = 120;
/** a DLM hedge's size (the bake has none for it): what its card says
 *  (lib/city/ask-more.ts `hedgeItems`) */
export const DLM_HEDGE_H = 1.6;
export const DLM_HEDGE_W = 1.2;
/** sanity clamps on the baked sizes */
const H_RANGE: [number, number] = [0.4, 3.5];
const W_RANGE: [number, number] = [0.5, 3];

/** One hedge instance: centre, heading and extents, in EPSG metres. */
export interface HedgePiece {
  /** heading of the piece, radians from +x (east) toward +y (north) */
  angle: number;
  /** where the drawn piece starts and ends: the joints, pushed out at a
   *  bend so the two pieces meet in a mitre */
  from: Point2;
  h: number;
  /** the drawn length (m) */
  len: number;
  to: Point2;
  w: number;
  x: number;
  y: number;
}

/** How far (m) a piece of width `w` reaches past a joint where the line
 *  turns by `turn` radians, so the outer corners meet (a mitre); capped
 *  at the width for a hairpin. */
function mitre(w: number, turn: number): number {
  return Math.min((w / 2) * Math.tan(Math.abs(turn) / 2), w);
}

/** The turn (radians, −π..π) from heading `a` to heading `b`. */
function turnBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Splits a hedge polyline into pieces no longer than HEDGE_PIECE_M, each
 * carrying the hedge's height and width. On a straight run the pieces meet
 * end to end, so their open-ended cross-sections join without a seam; at a
 * bend each reaches on by its mitre so the corner closes. Pure (EPSG in,
 * EPSG out), for tests.
 */
export function hedgePieces(
  coords: Point2[],
  h: number,
  w: number
): HedgePiece[] {
  const pts = subdividePolyline(coords, HEDGE_PIECE_M);
  const segs: { a: Point2; angle: number; b: Point2; len: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len >= 0.05) {
      segs.push({ a, b, len, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
    }
  }
  return segs.map(({ a, b, len, angle }, i) => {
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const e0 = prev ? mitre(w, turnBetween(prev.angle, angle)) : 0;
    const e1 = next ? mitre(w, turnBetween(angle, next.angle)) : 0;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const from: Point2 = [a[0] - dx * e0, a[1] - dy * e0];
    const to: Point2 = [b[0] + dx * e1, b[1] + dy * e1];
    return {
      x: (from[0] + to[0]) / 2,
      y: (from[1] + to[1]) / 2,
      from,
      to,
      angle,
      len: len + e0 + e1,
      h,
      w,
    };
  });
}

interface Instance {
  /** heading about +Y (world) */
  rot: number;
  /** the ground's rise (m) from the piece's start to its end: the block is
   *  sheared to it, so the ends of two pieces meet at one height */
  rise: number;
  sx: number;
  sy: number;
  sz: number;
  /** tint jitter −0.5..0.5 */
  tint: number;
  x: number;
  y: number;
  z: number;
}

/**
 * The hedge's cross-section (z across, y up; base at y = 0, top at 1),
 * from the bottom-left corner over the top to the bottom-right: straight,
 * slightly tapered flanks, rounded shoulders and a flattish crown — a
 * trimmed hedge. The base is open (it is sunk into the lawn).
 */
function hedgeProfile(): [number, number][] {
  const left: [number, number][] = [];
  const flank = (y: number): number => 0.5 * (1 - HEDGE_TAPER * y);
  left.push([-flank(0), 0], [-flank(0.3), 0.3]);
  const steps = 4;
  for (let k = 0; k < steps; k++) {
    const phi = (k / steps) * (Math.PI / 2);
    const c = Math.cos(phi) ** (2 / HEDGE_SHOULDER_P);
    const s = Math.sin(phi) ** (2 / HEDGE_SHOULDER_P);
    const y = HEDGE_SHOULDER_Y + (1 - HEDGE_SHOULDER_Y) * s;
    left.push([-flank(y) * c, y]);
  }
  const right = left.map(([z, y]): [number, number] => [-z, y]).reverse();
  return [...left, [0, 1], ...right];
}

/** Rings of the unit block along its length: a piece is at most 2.5 m
 *  (and a mitre) long, so they stand ≤ 0.3 m apart — fine enough for the
 *  lumps (`hedgeShape`). */
const HEDGE_RINGS = 10;

/**
 * Unit hedge block: 1 m long (x), 1 m wide (z), 1 m tall (y), base at y = 0.
 * The trimmed cross-section (`hedgeProfile`) swept straight along x, cut
 * flat at both ends. The pieces of a run meet end to end (`hedgePieces`),
 * so their sections join without a seam and the caps between them are
 * hidden inside the hedge: only a run's two ends show theirs, square as
 * the shears leave a hedge. (The old chain of soft blocks overlapped with
 * rounded ends and pinched at every join: a row of sausages.) The caps
 * have vertices of their own, so the flanks keep the profile's normals to
 * the very end. The leafy lumps and the slow rise and fall of the top are
 * not in the geometry: the material pushes the vertices out by a noise
 * read where they stand in the world (`hedgeShape`), so two pieces meeting
 * at a joint take the same lumps there.
 */
export function buildHedgeGeo(): BufferGeometry {
  const profile = hedgeProfile();
  const n = profile.length;
  const pos: number[] = [];
  const nrm: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= HEDGE_RINGS; r++) {
    for (const [z, y] of profile) {
      pos.push(-0.5 + r / HEDGE_RINGS, y, z);
    }
  }
  for (let i = 0; i < HEDGE_RINGS; i++) {
    for (let k = 0; k < n - 1; k++) {
      const a = i * n + k;
      const b = a + n;
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const sides = new BufferGeometry();
  sides.setAttribute("position", new Float32BufferAttribute(pos, 3));
  sides.setIndex(index);
  sides.computeVertexNormals();
  nrm.push(...(sides.getAttribute("normal").array as Float32Array));
  // the caps: a fan from the middle of each end's section, facing out
  for (const side of [-1, 1]) {
    const centre = pos.length / 3;
    pos.push(side * 0.5, 0.4, 0);
    nrm.push(side, 0, 0);
    for (const [z, y] of profile) {
      pos.push(side * 0.5, y, z);
      nrm.push(side, 0, 0);
    }
    for (let k = 0; k < n - 1; k++) {
      const a = centre + 1 + k;
      if (side < 0) {
        index.push(centre, a, a + 1);
      } else {
        index.push(centre, a + 1, a);
      }
    }
  }
  sides.dispose();
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  if (g.boundingSphere) {
    g.boundingSphere.radius += HEDGE_LUMP_M + HEDGE_SWELL_M;
  }
  return g;
}

/**
 * The leafy lumps' noise (0..1) at a point of the world: two value noises
 * of the ground plan slid by the height in two crossing directions, so a
 * flank gets blobs, not the upright ribs a plan-only noise draws on a wall.
 * The vertex stage pushes by it and the fragment shades by it.
 */
function hedgeLumps(world: V3): F {
  const p = world.xz.div(HEDGE_LUMP_WAVE_M);
  const up = world.y.div(HEDGE_LUMP_WAVE_M);
  return leafNoise(p.add(up.mul(vec2(0.63, -0.41))))
    .add(
      leafNoise(
        p
          .mul(1.31)
          .add(up.mul(vec2(0.37, 0.71)))
          .add(5.3)
      )
    )
    .mul(0.5);
}

/** The axis the lumps push out from, in the unit block (y up, z across). */
const HEDGE_AXIS_Y = 0.35;

/**
 * The hedge's shape, as the vertex stage sees it: the unit block's vertex
 * pushed out by two noises read at its place in the world — leafy lumps
 * (~0.8 m) over the flanks and the top, and a slow rise and fall (~6 m) of
 * the top line, as a hedge trimmed by hand grows. The push runs out from
 * the block's axis, in metres (the instance's scale taken out): a
 * direction from the vertex's place alone, not its normal, so the flank's
 * last ring and the cap's rim — and the ends of two pieces at a joint —
 * move as one. The foot stays put (it meets the lawn).
 */
function hedgeShape(): V3 {
  const local = positionGeometry;
  const m = instanceMatrix();
  const world = modelWorldMatrix.mul(m.mul(vec4(local, 1))).xyz;
  const sy = length(m.mul(vec4(0, 1, 0, 0)).xyz);
  const sz = length(m.mul(vec4(0, 0, 1, 0)).xyz);
  // out from the axis, in metres, then back into the unit block
  const out = vec3(0, local.y.sub(HEDGE_AXIS_Y).mul(sy), local.z.mul(sz));
  const dir = out.div(max(length(out), 1e-3));
  const foot = smoothstep(0.08, 0.55, local.y);
  const top = smoothstep(0.55, 1, local.y).mul(max(dir.y, 0));
  const lumps = hedgeLumps(world).sub(0.5);
  const swell = leafNoise(world.xz.div(HEDGE_SWELL_WAVE_M).add(13.7)).sub(0.5);
  const push = lumps
    .mul(HEDGE_LUMP_M * 2)
    .mul(foot)
    .add(swell.mul(HEDGE_SWELL_M * 2).mul(top));
  return local.add(vec3(0, dir.y.div(sy), dir.z.div(sz)).mul(push));
}

/**
 * Pastel moss in the crowns' family, with a rooted base: the unit
 * geometry's own Y (0 at the ground, 1 at the top, before the instance
 * scale) darkens the lower third — the soft contact shading that seats a
 * hedge on the lawn in the watercolour look. The lumps the vertex stage
 * pushed out (`hedgeShape`) are read again here from the same noise: their
 * crests a touch lighter and warmer, their hollows deeper — the leafy
 * relief without a normal map. A finer leaf mottle rides on it near the
 * eye and fades out by `HEDGE_MOTTLE_FAR_M`, where it would only shimmer.
 * While Comic prints the crowns (`crownsPrinted`) the hedge wears the
 * crowns' marker ink, so it is printed flat like them, not dotted like a
 * wall. Scene-wide (`sceneMaterial`): it carries nothing of a tile.
 */
function hedgeMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("low-vegetation-hedge", () => {
    const m = new MeshStandardNodeMaterial({ color: 0xff_ff_ff, roughness: 1 });
    m.name = "lowveg-hedge";
    m.positionNode = instancePosition(hedgeShape());
    const rooted = mix(
      0.78,
      1.04,
      smoothstep(0.02, 0.6, varying(positionGeometry.y))
    );
    const lumps = hedgeLumps(positionWorld);
    const near = float(1).sub(
      smoothstep(
        HEDGE_MOTTLE_NEAR_M,
        HEDGE_MOTTLE_FAR_M,
        positionView.z.negate()
      )
    );
    const uv = positionWorld.xz.add(positionWorld.y.mul(vec2(0.63, -0.41)));
    const mottle = leafNoise(uv.mul(3.1)).sub(0.5).mul(near);
    const relief = lumps.mul(0.2).add(0.9).add(mottle.mul(0.1));
    const moss = materialColor.mul(instanceTint()).mul(rooted).mul(relief);
    const lit = mix(
      moss,
      moss.mul(vec3(1.06, 1.05, 0.88)),
      smoothstep(0.6, 0.9, lumps)
    );
    m.colorNode = printedLeaf(lit);
    return m;
  });
}

/** Hedges read deeper and cooler than the crowns and the lawn — a dense
 *  evergreen, in the same soft sage family, never a lime. */
function tintColor(col: Color, t: number): void {
  col.setHSL(0.29 + t * 0.03, 0.26 + t * 0.05, 0.35 + t * 0.06);
}

function buildChunks(
  items: Instance[],
  geo: BufferGeometry,
  mat: MeshStandardNodeMaterial
): Instances[] {
  const dummy = new Object3D();
  const shear = new Matrix4();
  const matrix = new Matrix4();
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
      // the shear: local x lifts by `rise` over the piece's length
      shear.makeShear(p.rise / p.sy, 0, 0, 0, 0, 0);
      mesh.setMatrixAt(i, matrix.multiplyMatrices(dummy.matrix, shear));
      tintColor(col, p.tint);
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

/** A hedge to draw: its line (EPSG) and its size (m). */
export interface HedgeLine {
  coords: Point2[];
  h: number;
  w: number;
}

/**
 * The hedges a tile draws: its OSM hedges at their baked size, then the
 * Basis-DLM's hedge rows at the size their card states. A DLM hedge
 * along an OSM one is already cut at the bake (pipeline/bake/hedges.py
 * `without_mapped`), so a hedge is drawn once. Pure, for tests.
 */
export function hedgeLines(
  osm: readonly LowVegFeature[],
  rows: readonly VegRowFeature[] = []
): HedgeLine[] {
  const out: HedgeLine[] = [];
  for (const f of osm) {
    if (f.geometry?.type === "LineString" && f.properties) {
      out.push({
        coords: f.geometry.coordinates,
        h: clamp(f.properties.h ?? DLM_HEDGE_H, ...H_RANGE),
        w: clamp(f.properties.w ?? DLM_HEDGE_W, ...W_RANGE),
      });
    }
  }
  for (const f of rows) {
    if (f.geometry?.type === "LineString" && f.properties?.kind === "hedge") {
      out.push({
        coords: f.geometry.coordinates,
        h: DLM_HEDGE_H,
        w: DLM_HEDGE_W,
      });
    }
  }
  return out;
}

function hedgeInstances(lines: HedgeLine[], ctx: GroundContext): Instance[] {
  const out: Instance[] = [];
  for (const { coords, h, w } of lines) {
    if (coords.length < 2) {
      continue;
    }
    // One tint and one height per hedge, not per piece: overlapping pieces
    // that disagreed would show their seam (the lumps and the rise and
    // fall of the top come from the world-space noise, `hedgeShape`).
    const [hx, hy] = coords[0];
    const seed = hx * 0.37 + hy * 0.11;
    const tint = hash(seed * 2.1) - 0.5;
    const sy = (h + SINK_M) * (0.94 + hash(seed * 1.3) * 0.12);
    for (const piece of hedgePieces(coords, h, w)) {
      const ground = ctx.heightAt(piece.x, piece.y);
      if (ground === null) {
        continue;
      }
      // the ground under both ends: the block follows its slope, so two
      // pieces meet at one height (the centre's where an end is off it)
      const g0 = ctx.heightAt(...piece.from) ?? ground;
      const g1 = ctx.heightAt(...piece.to) ?? ground;
      const world = epsgToWorld(piece.x, piece.y, ctx.offset);
      out.push({
        x: world.x,
        y: (g0 + g1) / 2 - SINK_M,
        z: world.z,
        // A +Y rotation by the EPSG heading lays local +x along the piece
        // (it turns +x toward −z, which is north).
        rot: piece.angle,
        rise: g1 - g0,
        sx: piece.len,
        sy,
        sz: w,
        tint,
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
  ctx: LowVegetationContext,
  rows: readonly VegRowFeature[] = []
): Group {
  const group = new Group();
  group.name = "low-vegetation";
  const hedges = hedgeInstances(hedgeLines(features, rows), ctx);
  if (hedges.length > 0) {
    group.add(...buildChunks(hedges, buildHedgeGeo(), hedgeMaterial()));
  }
  return group;
}
