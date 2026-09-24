import {
  type BufferGeometry,
  Color,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from "three";
import type { LowVegFeature } from "@/lib/city/features";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { type Point2, subdividePolyline } from "@/lib/city/polyline";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/**
 * 🧪 Low vegetation — hedges and shrubs under 3 m (scripts/extract-lowveg.sh:
 * the laser scan + OSM), drawn only behind `?veg=low` (scene-profile.ts).
 *
 * Kept apart from vegetation-layer.ts on purpose: nothing here animates (a
 * trimmed hedge does not sway, and ADR 0020 keeps casters static anyway), so
 * it needs none of the crown shader, and the tree layer stays untouched.
 *
 * - A hedge is a chain of soft superellipsoid "clay" blocks, one instance per
 *   ≤2.5 m piece of the polyline, stretched to the piece's length and to the
 *   baked height and width, overlapping so the joins read as waists, not seams.
 * - A shrub is a low lobed dome (≈140 triangles) scaled to its radius and height.
 * Both use one material recipe: pastel moss with a darker rooted base (the
 * trunks' trick), a static world-space foliage mottle, per-instance tint
 * jitter and the valley height fog.
 * Chunked into 250 m cells like the trees, so off-screen cells cull out of the
 * main AND the shadow pass.
 */

const CHUNK_SIZE = 250;
/** longest hedge piece (m); longer runs are split so the lumps stay hedge-sized */
const HEDGE_PIECE_M = 2.5;
/** each piece reaches this far into its neighbours so the chain has no gaps */
const HEDGE_OVERLAP_M = 0.6;
/** instances are sunk this far so the terrain's ~2 m facets never show a gap */
const SINK_M = 0.25;
/** superellipsoid exponents of the hedge block (2 = ellipsoid, ∞ = box):
 *  a clipped, softly rounded top half on a squarer base */
const HEDGE_P = 4;
const HEDGE_P_BASE = 7;
/** sanity clamps on the baked sizes */
const H_RANGE: [number, number] = [0.4, 3.5];
const W_RANGE: [number, number] = [0.5, 3];
const R_RANGE: [number, number] = [0.4, 3];

function clamp(v: number, [lo, hi]: [number, number]): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Deterministic [0,1) jitter so the layer rebuilds identically. */
function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43_758.5453;
  return s - Math.floor(s);
}

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

/**
 * Unit hedge block: 1 m long (x), 1 m wide (z), 1 m tall (y), base at y = 0.
 * A superellipsoid (|x|⁴ + |y|⁴ + |z|⁴ = 1 on a UV sphere): flat-ish sides
 * and top with generously rounded edges and blunt ends, so the overlapping
 * pieces of a chain merge into one clipped hedge with soft waists at the
 * joins instead of a row of boxes. A low-frequency lump breaks the top line;
 * smooth normals, bent a third of the way toward the block's core axis, let
 * the light roll over it as one soft mass (the crown's radial-normal trick).
 */
export function buildHedgeGeo(): BufferGeometry {
  const g = new SphereGeometry(1, 16, 10); // 288 triangles
  // Poles on the ends (±x), not on the top: the top then gets even quads
  // instead of a fan of slivers that the lumps would pull into spikes.
  g.rotateZ(Math.PI / 2);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // boxier below the equator: the base stands on the lawn, not on a curve
    const p = v.y < 0 ? HEDGE_P_BASE : HEDGE_P;
    const norm =
      (Math.abs(v.x) ** p + Math.abs(v.y) ** p + Math.abs(v.z) ** p) ** (1 / p);
    v.divideScalar(norm);
    const ty = (v.y + 1) / 2; // 0 (base) … 1 (top)
    // lumps on the upper half only (the base must stay on the ground)
    // (one gentle term: the rings along x are too sparse for more — a higher
    // frequency aliases into spikes on the ridge)
    const lump = 1 + ty ** 2 * 0.05 * Math.sin(v.x * 4.1 + v.z * 2.3 + 0.7);
    pos.setXYZ(i, v.x * 0.5, ty * lump, v.z * 0.5 * (1 - 0.12 * ty ** 2));
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const n = new Vector3();
  const core = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    core.set(pos.getX(i) * 0.6, pos.getY(i) - 0.4, pos.getZ(i) * 2).normalize();
    n.lerp(core, 0.35).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  return g;
}

/**
 * Unit shrub: a lobed dome of radius 1 and height 1 (base slightly below 0).
 * A 12×7 UV sphere (≈140 triangles): at walking distance the 80-triangle
 * icosphere read as a faceted egg; this keeps a round silhouette for less
 * than half the cheap tree crown. Smooth normals, bent toward the radial
 * direction like the crowns', so the dome shades as one soft mass.
 */
export function buildShrubGeo(): BufferGeometry {
  const g = new SphereGeometry(1, 12, 7);
  const lobes = [
    new Vector3(0.7, 0.5, 0.2),
    new Vector3(-0.6, 0.4, 0.55),
    new Vector3(0.1, 0.45, -0.8),
    new Vector3(-0.5, 0.7, -0.4),
  ].map((l) => l.normalize());
  const pos = g.attributes.position;
  const v = new Vector3();
  const dir = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    dir.fromBufferAttribute(pos, i).normalize();
    let bulge = 0;
    for (const l of lobes) {
      const d = Math.max(0, dir.dot(l));
      bulge += d * d * 0.28;
    }
    const r = 0.82 + Math.min(bulge, 0.3);
    v.copy(dir).multiplyScalar(r);
    // Dome: squash the lower half flat onto the ground, lift the centre.
    v.y = v.y >= 0 ? v.y * 0.62 + 0.38 : v.y * 0.45 + 0.38;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i);
    v.set(pos.getX(i), pos.getY(i) - 0.38, pos.getZ(i)).normalize();
    n.lerp(v, 0.5).normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/**
 * Pastel moss with a rooted base: the unit geometry's own Y (0 at the ground,
 * 1 at the top, before the instance scale) darkens the lower third — the soft
 * contact shading that seats a hedge on the lawn in the watercolour look.
 */
function buildLowVegMaterial(
  kind: "hedge" | "shrub",
  heightFog?: HeightFogUniforms
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xff_ff_ff, roughness: 1 });
  m.customProgramCacheKey = () => `lowveg-${kind}-${heightFog !== undefined}`;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vLowY;\nvarying vec3 vLowWP;"
      )
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          " vLowY = position.y;",
          "#ifdef USE_INSTANCING",
          " vLowWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;",
          "#else",
          " vLowWP = (modelMatrix * vec4(position, 1.0)).xyz;",
          "#endif",
        ].join("\n")
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        [
          "#include <common>",
          "varying float vLowY;",
          "varying vec3 vLowWP;",
          "float lvHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
          "float lvNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(lvHash(i), lvHash(i + vec2(1.0, 0.0)), f.x), mix(lvHash(i + vec2(0.0, 1.0)), lvHash(i + vec2(1.0, 1.0)), f.x), f.y); }",
        ].join("\n")
      )
      .replace(
        "#include <map_fragment>",
        [
          "#include <map_fragment>",
          // rooted base: darker toward the ground (contact shading)
          " diffuseColor.rgb *= mix(0.8, 1.05, smoothstep(0.0, 0.7, vLowY));",
          // foliage mottle: leaf-clump-sized (~0.4 m) and bush-sized (~1.3 m)
          // value noise in world space, so neighbouring pieces never repeat;
          // the bright clumps lean a touch yellow — a watercolour wash, not a
          // texture. Static: nothing here moves (ADR 0020).
          " vec2 lvUV = vLowWP.xz + vLowWP.y * vec2(0.63, -0.41);",
          " float lvM = 0.6 * lvNoise(lvUV * 2.6) + 0.4 * lvNoise(lvUV * 0.75 + 7.1);",
          " diffuseColor.rgb *= 0.82 + 0.34 * lvM;",
          " diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.06, 0.86), smoothstep(0.55, 0.9, lvM));",
        ].join("\n")
      );
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return m;
}

/** Hedges read a touch deeper and cooler than crowns; shrubs vary more. */
function tintColor(col: Color, kind: "hedge" | "shrub", t: number): void {
  if (kind === "hedge") {
    col.setHSL(0.27 + t * 0.03, 0.34 + t * 0.06, 0.5 + t * 0.07);
  } else {
    col.setHSL(0.25 + t * 0.06, 0.32 + t * 0.1, 0.57 + t * 0.1);
  }
}

function bucket(items: Instance[]): Instance[][] {
  const cells = new Map<string, Instance[]>();
  for (const p of items) {
    const key = `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.push(p);
    } else {
      cells.set(key, [p]);
    }
  }
  return [...cells.values()];
}

function buildChunks(
  items: Instance[],
  geo: BufferGeometry,
  mat: MeshStandardMaterial,
  kind: "hedge" | "shrub"
): InstancedMesh[] {
  const dummy = new Object3D();
  const col = new Color();
  return bucket(items).map((cell) => {
    const mesh = new InstancedMesh(geo, mat, cell.length);
    mesh.name = `lowveg-${kind}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cell.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tintColor(col, kind, p.tint);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
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
    if (f.geometry?.type !== "LineString" || f.properties?.kind !== "hedge") {
      continue;
    }
    const h = clamp(f.properties.h ?? 1.5, H_RANGE);
    const w = clamp(f.properties.w ?? 1, W_RANGE);
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

function shrubInstances(
  features: LowVegFeature[],
  ctx: GroundContext
): Instance[] {
  const out: Instance[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point" || f.properties?.kind !== "shrub") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    const r = clamp(f.properties.r ?? 1, R_RANGE);
    const h = clamp(f.properties.h ?? 1.5, H_RANGE);
    const seed = ex * 0.13 + ey * 0.29;
    const world = epsgToWorld(ex, ey, ctx.offset);
    const squash = 0.9 + hash(seed) * 0.2;
    out.push({
      x: world.x,
      y: ground - SINK_M,
      z: world.z,
      rot: hash(seed * 1.7) * Math.PI * 2,
      sx: r * squash,
      sy: h + SINK_M,
      sz: r / squash,
      tint: hash(seed * 2.3) - 0.5,
    });
  }
  return out;
}

export interface LowVegetationContext extends GroundContext {
  heightFog?: HeightFogUniforms;
}

/**
 * Builds one tile's hedges and shrubs onto a Y-up group (add it to `scene`,
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
  const shrubs = shrubInstances(features, ctx);
  if (hedges.length > 0) {
    group.add(
      ...buildChunks(
        hedges,
        buildHedgeGeo(),
        buildLowVegMaterial("hedge", ctx.heightFog),
        "hedge"
      )
    );
  }
  if (shrubs.length > 0) {
    group.add(
      ...buildChunks(
        shrubs,
        buildShrubGeo(),
        buildLowVegMaterial("shrub", ctx.heightFog),
        "shrub"
      )
    );
  }
  return group;
}
