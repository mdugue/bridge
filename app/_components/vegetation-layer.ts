import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { epsgToWorld } from "@/lib/city/ground-clamp";
import { type HeightFogUniforms, injectHeightFog } from "./height-fog";

/** Recenter offset + ground lookup shared with the terrain. */
export interface VegetationContext {
  /** optional canopy GeoJSON (points with an "h" height) from DOM1 */
  canopyUrl?: string;
  heightAt: (x: number, y: number) => number | null;
  /** shared valley height-fog uniforms (by reference), patched into the
   * crown/trunk/hedge materials so tree bases pool haze with the terrain */
  heightFog?: HeightFogUniforms;
  offset: { cx: number; cy: number };
  signal?: AbortSignal;
  /**
   * Shared world-space sun direction (surface→sun), updated by the sun rig.
   * The crown material reads it (by reference) for the backlit shimmer. May be
   * absent (shimmer then stays at its default direction).
   */
  sunDirection?: Vector3;
}

/** Default backlit-shimmer strength and whether the rich (near) crown is on. */
export const DEFAULT_TREE_SHIMMER = 0.45;
export const DEFAULT_TREE_MULTITUFT = true;
/** Default backlit translucency (shadow-gated subsurface glow) strength. */
export const DEFAULT_TREE_TRANSLUCENCY = 0.5;
/**
 * Crown LOD hysteresis, measured to the NEAREST tree in a chunk (camera distance
 * minus the chunk's instance-sphere radius), not the centroid — otherwise a tree
 * a few metres away could stay cheap because its 250 m chunk's centre is far. A
 * cheap chunk switches to rich within NEAR_IN; a rich chunk only drops past
 * NEAR_OUT, so chunks straddling the line don't flicker.
 */
const LOD_NEAR_IN_M = 220;
const LOD_NEAR_OUT_M = 300;

/**
 * Runtime handle for a loaded vegetation group: a per-frame LOD swap plus live
 * tuning of the shimmer and the rich-crown toggle.
 */
export interface VegetationControl {
  group: Group;
  setMultiTuft: (enabled: boolean) => void;
  setShimmer: (strength: number) => void;
  /** advance the wind-sway animation (call per frame with elapsed seconds) */
  setTime: (seconds: number) => void;
  /** backlit (shadow-gated) translucency strength 0..1 on near/large crowns */
  setTranslucency: (strength: number) => void;
  updateLod: (cameraPos: Vector3) => void;
}

interface CellLod {
  cheap: InstancedMesh;
  rich: InstancedMesh;
}

interface LineFeature {
  geometry: { coordinates: [number, number][]; type: "LineString" };
  properties: { kind: "hedge" | "treerow" };
}

interface PointFeature {
  geometry: { coordinates: [number, number]; type: "Point" };
  properties: { h: number };
}

const TREE_SPACING = 9; // metres between trees along a row
const HEDGE_SPACING = 1.1; // metres between hedge segments
/**
 * Edge length (m) of a vegetation chunk. Each chunk is its own InstancedMesh
 * with a tight bounding sphere, so three frustum-culls whole chunks that are
 * behind or beside the camera out of BOTH the main and the shadow pass —
 * instead of the old all-or-nothing "one mesh per tile". Trades a few hundred
 * (mostly-culled) draw calls for a large drop in processed triangles.
 */
const CHUNK_SIZE = 250;
const TRUNK_H = 2.4;
const CROWN_R = 2.1;
const HEDGE_H = 1.3;
const HEDGE_W = 0.9;
/** Approx visual height of an unscaled tree; canopy scale = h / this. */
const BASE_TREE_H = 5.8;

/** Deterministic [0,1) jitter so the layer rebuilds identically. */
function hash(i: number): number {
  const s = Math.sin(i * 12.9898) * 43_758.5453;
  return s - Math.floor(s);
}

/** Walks a polyline emitting points every `spacing` metres (EPSG coords). */
function sampleLine(
  coords: [number, number][],
  spacing: number
): [number, number][] {
  const out: [number, number][] = [];
  // Distance from the current segment's start to the next sample to emit.
  let dist = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i];
    const [x1, y1] = coords[i + 1];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      continue;
    }
    while (dist < len) {
      const t = dist / len;
      out.push([x0 + dx * t, y0 + dy * t]);
      dist += spacing;
    }
    dist -= len; // carry the remainder into the next segment
  }
  return out;
}

interface Placement {
  rot: number;
  s: number;
  x: number;
  y: number;
  z: number;
}

/** Resamples every line and drops each point onto the terrain (EPSG -> world). */
function collectPlacements(
  features: LineFeature[],
  ctx: VegetationContext
): { hedges: Placement[]; trees: Placement[] } {
  const { offset } = ctx;
  const trees: Placement[] = [];
  const hedges: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "LineString") {
      continue;
    }
    const isHedge = f.properties?.kind === "hedge";
    const pts = sampleLine(
      f.geometry.coordinates,
      isHedge ? HEDGE_SPACING : TREE_SPACING
    );
    for (let i = 0; i < pts.length; i++) {
      const [ex, ey] = pts[i];
      const ground = ctx.heightAt(ex, ey);
      if (ground === null) {
        continue; // off-tile or NoData
      }
      const seed = ex * 0.13 + ey * 0.07 + i;
      const w = epsgToWorld(ex, ey, offset);
      const place: Placement = {
        x: w.x,
        y: ground,
        z: w.z,
        rot: isHedge ? hash(seed) * 0.3 : hash(seed * 1.7) * Math.PI,
        s: isHedge ? 1 : 0.8 + hash(seed) * 0.6,
      };
      (isHedge ? hedges : trees).push(place);
    }
  }
  return { trees, hedges };
}

/** Groups placements into CHUNK_SIZE cells so each becomes its own mesh. */
function bucketByCell(items: Placement[]): Placement[][] {
  const cells = new Map<string, Placement[]>();
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

function writeInstances(mesh: InstancedMesh, items: Placement[]): void {
  const dummy = new Object3D();
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.rot, 0);
    dummy.scale.setScalar(p.s);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  // Without this the cull test uses the (origin-centred) geometry sphere and
  // wrongly culls the whole spread-out instance cloud whenever the world
  // origin is off-screen.
  mesh.computeBoundingSphere();
}

/**
 * Lumpy, soft-shaded crown — a single icosphere (detail 2) whose surface is
 * pushed out into a few overlapping lobes, then given RADIAL normals (every
 * vertex normal points out from the crown centre). The lobes break the "green
 * ball" silhouette; the radial normals make light glide over the whole mass as
 * one soft form instead of faceting per triangle. This stays ONE shared
 * geometry (~320 tris) — a cheap ~4× over the old icosphere, not the 18× of the
 * sandbox's merged multi-tuft crown (that needs per-distance LOD before it can
 * be afforded across tens of thousands of trees).
 */
function buildCrownGeo(): BufferGeometry {
  const g = new IcosahedronGeometry(CROWN_R, 2);
  const cy = TRUNK_H + CROWN_R * 0.5;
  // Lobe directions: a fuller top, irregular sides, flatter underside.
  const lobes = [
    new Vector3(0, 0.6, 0),
    new Vector3(0.8, 0.25, 0.35),
    new Vector3(-0.7, 0.15, 0.5),
    new Vector3(0.25, 0.5, -0.7),
    new Vector3(-0.45, 0.4, -0.3),
    new Vector3(0.55, -0.05, -0.55),
    new Vector3(-0.2, -0.1, 0.7),
  ].map((v) => v.normalize());
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const dir = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    // Bumpy radius: each lobe bulges the surface where the vertex points at it.
    let bulge = 0;
    for (const L of lobes) {
      const d = Math.max(0, dir.dot(L));
      bulge += d * d * 0.34;
    }
    const r = CROWN_R * (0.74 + Math.min(bulge, 0.95));
    v.copy(dir).multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 1.05, 1);
  g.translate(0, cy, 0);
  // Radial normals from the crown centre -> soft, unified shading.
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return g;
}

/**
 * Rich multi-tuft crown for NEAR trees (LOD): a squashed core plus heavily
 * overlapping, elongated lobes merged into one mass, then RADIAL normals. ~18×
 * the cheap crown's triangles, so it is only ever shown within LOD_NEAR_M. ONE
 * shared geometry (fixed seed) — instance rotation hides the repetition.
 */
function buildCrownGeoRich(): BufferGeometry {
  const cy = TRUNK_H + CROWN_R * 0.5;
  const R = CROWN_R;
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const at = new Vector3();
  const scl = new Vector3();
  const q = new Quaternion();
  const mtx = new Matrix4();
  const parts: BufferGeometry[] = [];
  let k = 0;
  const rnd = () => hash((k++ + 1) * 1.37 + 0.19);

  const core = new IcosahedronGeometry(R * 0.72, 1);
  core.scale(1.1, 0.82, 1.1);
  parts.push(core);

  const addLobes = (
    count: number,
    distLo: number,
    distHi: number,
    radLo: number,
    radHi: number,
    elong: number,
    yLo: number,
    yHi: number
  ): void => {
    for (let i = 0; i < count; i++) {
      const ny = yLo + rnd() * (yHi - yLo);
      dir.set(rnd() * 2 - 1, ny, rnd() * 2 - 1).normalize();
      at.copy(dir).multiplyScalar(R * (distLo + rnd() * (distHi - distLo)));
      at.y += R * 0.06;
      const rad = R * (radLo + rnd() * (radHi - radLo));
      const long = 1 + rnd() * elong; // stretch along the lobe's reach
      scl.set(1 / Math.sqrt(long), long, 1 / Math.sqrt(long));
      q.setFromUnitVectors(up, dir);
      mtx.compose(at, q, scl);
      const b = new IcosahedronGeometry(rad, 1);
      b.applyMatrix4(mtx);
      parts.push(b);
    }
  };
  addLobes(5, 0.24, 0.44, 0.5, 0.66, 0.4, -0.3, 1.15); // big fused lobes
  addLobes(4, 0.34, 0.52, 0.4, 0.54, 0.35, -0.7, 0.05); // low skirt
  addLobes(8, 0.46, 0.66, 0.24, 0.34, 0.3, -0.15, 1.05); // silhouette bumps

  const merged = mergeGeometries(parts);
  if (!merged) {
    return buildCrownGeo(); // attributes always match here; fall back defensively
  }
  merged.scale(1, 1.04, 1);
  merged.translate(0, cy, 0);
  const pos = merged.attributes.position;
  const nrm = merged.attributes.normal;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i) - cy, pos.getZ(i)).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  nrm.needsUpdate = true;
  return merged;
}

/**
 * Sage crown material with a shadow-gated backlit shimmer: when the sun is
 * behind the canopy the camera-facing leaves glow warm, but ONLY where the sun
 * actually reaches — the shadow is sampled 2 m toward the sun so a building
 * behind the tree kills the glow while the crown's own self-shadow doesn't.
 * Shared by both LOD crown meshes. `sunDirection` (surface→sun) and `shimmer`
 * are live references; mutating `shimmer.value` retunes without a recompile.
 */
function buildCrownMaterial(
  sunDirection: Vector3,
  shimmer: { value: number },
  uTime: { value: number },
  translucency: { value: number },
  heightFog?: HeightFogUniforms
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0xa6_bf_92, roughness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDir = { value: sunDirection };
    sh.uniforms.uShimmer = shimmer;
    sh.uniforms.uTime = uTime;
    sh.uniforms.uTranslucency = translucency;
    sh.vertexShader = sh.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uSunDir;\nuniform float uTime;\nvarying vec3 vShimWP;\nvarying vec4 vShimSC;\nvarying float vCrownScale;"
      )
      // Wind sway: bend the crown in local space, stiff at the base (where it
      // meets the trunk) and loose at the top. The per-tree phase comes from the
      // instance's world column (instanceMatrix[3].xz) so neighbours sway out of
      // step — a free, stable seed with no extra attribute or buffer upload.
      // Crowns live in the Y-up scene, so local Y is already up. Cast shadows
      // stay rigid (the auto depth material has no sway and the sun rig only
      // re-renders the shadow map on move) — accepted; invisible at this scale.
      .replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "#ifdef USE_INSTANCING",
          " vec2 swayOrigin = instanceMatrix[3].xz;",
          " float swayPhase = dot(swayOrigin, vec2(0.07, 0.11));",
          " float swayK = clamp(transformed.y / 7.0, 0.0, 1.0);",
          " swayK *= swayK;",
          " float sway = sin(uTime * 0.38 + swayPhase) + 0.5 * sin(uTime * 0.8 + swayPhase * 1.7);",
          " transformed.x += sway * swayK * 0.16;",
          " transformed.z += 0.6 * sin(uTime * 0.31 + swayPhase + 1.7) * swayK * 0.16;",
          " vCrownScale = length(instanceMatrix[0].xyz);",
          "#else",
          " vCrownScale = 1.0;",
          "#endif",
        ].join("\n")
      )
      .replace(
        "#include <worldpos_vertex>",
        [
          "#include <worldpos_vertex>",
          "#ifdef USE_INSTANCING",
          " vShimWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;",
          "#else",
          " vShimWP = (modelMatrix * vec4(transformed, 1.0)).xyz;",
          "#endif",
          "#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0",
          " vShimSC = directionalShadowMatrix[0] * vec4(vShimWP + uSunDir * 2.0, 1.0);",
          "#endif",
        ].join("\n")
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uSunDir;\nuniform float uShimmer;\nuniform float uTranslucency;\nvarying vec3 vShimWP;\nvarying vec4 vShimSC;\nvarying float vCrownScale;"
      )
      .replace(
        "#include <emissivemap_fragment>",
        [
          "#include <emissivemap_fragment>",
          "vec3 shimV = normalize(cameraPosition - vShimWP);",
          "float shimBack = pow(clamp(dot(shimV, -uSunDir), 0.0, 1.0), 3.6);",
          "float shimVis = 1.0;",
          "#if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0",
          " DirectionalLightShadow shimDls = directionalLightShadows[0];",
          " shimVis = getShadow(directionalShadowMap[0], shimDls.shadowMapSize, shimDls.shadowIntensity, shimDls.shadowBias, shimDls.shadowRadius, vShimSC);",
          "#endif",
          "totalEmissiveRadiance += uShimmer * shimBack * shimVis * vec3(0.95, 0.85, 0.45);",
          // Backlit translucency: a BROADER subsurface glow (low exponent) using
          // the SAME shadow gate, so building occluders kill it but the crown's
          // own self-shadow doesn't. Limited to near OR large crowns and to
          // daytime so it never reads as far-field "noise".
          "float trBack = pow(clamp(dot(shimV, -uSunDir), 0.0, 1.0), 1.6);",
          "float trLarge = smoothstep(1.2, 3.0, vCrownScale);",
          "float trNear = 1.0 - smoothstep(120.0, 260.0, distance(cameraPosition, vShimWP));",
          "float trGate = max(trLarge, trNear) * clamp(uSunDir.y, 0.0, 1.0);",
          "totalEmissiveRadiance += uTranslucency * trBack * shimVis * trGate * vec3(0.45, 0.62, 0.30);",
        ].join("\n")
      );
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return m;
}

/**
 * De-sterilised trunk — a tapered cylinder with (1) a root flare at the base,
 * (2) low-amplitude radial "bark" bumps and (3) a gentle fixed lean. One shared
 * geometry across all instances (per-tree variety comes from instance rotation
 * + scale); branches were dropped here because, shared, they'd repeat
 * identically — they belong on a near-distance LOD crown.
 */
function buildTrunkGeo(): BufferGeometry {
  const t = new CylinderGeometry(0.09, 0.16, TRUNK_H, 7, 5);
  t.translate(0, TRUNK_H / 2, 0);
  const bend = 0.05 * TRUNK_H;
  const bx = 0.82;
  const bz = 0.57;
  const pos = t.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const tt = Math.min(Math.max(v.y / TRUNK_H, 0), 1);
    const r = Math.hypot(v.x, v.z);
    const ang = Math.atan2(v.z, v.x);
    if (r > 1e-4) {
      const flare = tt < 0.16 ? 1 + ((0.16 - tt) / 0.16) * 0.9 : 1;
      const bump = 1 + (hash(ang * 2.4 + v.y * 1.7) - 0.5) * 0.2;
      const nr = r * flare * bump;
      v.x = Math.cos(ang) * nr;
      v.z = Math.sin(ang) * nr;
    }
    const k = tt ** 1.4 * bend;
    v.x += bx * k;
    v.z += bz * k;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  t.computeVertexNormals();
  return t;
}

/** Trunk material with a gentle vertical value gradient (darker rooted base). */
function buildTrunkMaterial(
  heightFog?: HeightFogUniforms
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: 0x8a_7c_68, roughness: 1 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vTrunkY;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n vTrunkY = position.y;"
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vTrunkY;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\n float tg = clamp(vTrunkY / ${TRUNK_H.toFixed(
          2
        )}, 0.0, 1.0);\n diffuseColor.rgb *= mix(0.74, 1.05, smoothstep(0.0, 0.6, tg));`
      );
    if (heightFog) {
      injectHeightFog(sh, heightFog);
    }
  };
  return m;
}

/** Deterministic per-tree pastel sage variation (hue + value). */
function paintCrowns(crowns: InstancedMesh, cell: Placement[]): void {
  const col = new Color();
  for (let i = 0; i < cell.length; i++) {
    const v = hash(cell[i].x * 0.3 + cell[i].z * 0.7) - 0.5;
    col.setHSL(0.26 + v * 0.05, 0.27, 0.62 + v * 0.12);
    crowns.setColorAt(i, col);
  }
  if (crowns.instanceColor) {
    crowns.instanceColor.needsUpdate = true;
  }
}

function buildTrees(
  trees: Placement[],
  sunDirection: Vector3,
  shimmer: { value: number },
  uTime: { value: number },
  translucency: { value: number },
  heightFog?: HeightFogUniforms
): { cells: CellLod[]; meshes: InstancedMesh[] } {
  // Geometry + materials are shared across all chunks; only the per-chunk
  // instance buffers differ, so this stays cheap to allocate.
  const trunkGeo = buildTrunkGeo();
  const cheapGeo = buildCrownGeo();
  const richGeo = buildCrownGeoRich();
  const trunkMat = buildTrunkMaterial(heightFog);
  const crownMat = buildCrownMaterial(
    sunDirection,
    shimmer,
    uTime,
    translucency,
    heightFog
  );

  const meshes: InstancedMesh[] = [];
  const cells: CellLod[] = [];
  for (const cell of bucketByCell(trees)) {
    const trunks = new InstancedMesh(trunkGeo, trunkMat, cell.length);
    const cheap = new InstancedMesh(cheapGeo, crownMat, cell.length);
    const rich = new InstancedMesh(richGeo, crownMat, cell.length);
    trunks.castShadow = true;
    for (const c of [cheap, rich]) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
    writeInstances(trunks, cell);
    writeInstances(cheap, cell);
    writeInstances(rich, cell);
    paintCrowns(cheap, cell);
    paintCrowns(rich, cell);
    // updateLod() decides which crown is visible each frame; start on cheap.
    rich.visible = false;
    meshes.push(trunks, cheap, rich);
    cells.push({ cheap, rich });
  }
  return { cells, meshes };
}

function buildHedges(
  hedges: Placement[],
  heightFog?: HeightFogUniforms
): InstancedMesh[] {
  const geo = new BoxGeometry(HEDGE_W, HEDGE_H, HEDGE_W * 1.4);
  geo.translate(0, HEDGE_H / 2, 0);
  const mat = new MeshStandardMaterial({ color: 0x55_6b_3e, roughness: 1 });
  if (heightFog) {
    mat.onBeforeCompile = (sh) => injectHeightFog(sh, heightFog);
  }
  const meshes: InstancedMesh[] = [];
  for (const cell of bucketByCell(hedges)) {
    const mesh = new InstancedMesh(geo, mat, cell.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    writeInstances(mesh, cell);
    meshes.push(mesh);
  }
  return meshes;
}

export async function fetchFeatures<T>(
  url: string,
  signal?: AbortSignal
): Promise<T[]> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { features?: T[] };
    return data.features ?? [];
  } catch {
    return [];
  }
}

/** Canopy points (DOM1-derived) → height-scaled tree placements. */
function collectCanopy(
  features: PointFeature[],
  ctx: VegetationContext
): Placement[] {
  const { offset } = ctx;
  const out: Placement[] = [];
  for (const f of features) {
    if (f.geometry?.type !== "Point") {
      continue;
    }
    const [ex, ey] = f.geometry.coordinates;
    const ground = ctx.heightAt(ex, ey);
    if (ground === null) {
      continue;
    }
    // A point missing a numeric `h` (only the TS type, not the JSON, promises
    // one) would make scale NaN; Math.max/min don't clamp NaN, so the NaN
    // matrix poisons the chunk's bounding sphere and the whole cell culls.
    const h = Number.isFinite(f.properties.h) ? f.properties.h : BASE_TREE_H;
    const seed = ex * 0.13 + ey * 0.07;
    const w = epsgToWorld(ex, ey, offset);
    out.push({
      x: w.x,
      y: ground,
      z: w.z,
      rot: hash(seed * 1.7) * Math.PI,
      // Scale the whole tree to the measured canopy height (± a touch).
      s: Math.min(Math.max(h / BASE_TREE_H, 0.5), 7) * (0.9 + hash(seed) * 0.2),
    });
  }
  return out;
}

/**
 * Builds stylized vegetation from the ATKIS veg04 rows GeoJSON (hedges + tree
 * rows) and, when given, the DOM1-derived canopy GeoJSON (area trees scaled to
 * their measured height). Everything is drawn with InstancedMeshes so tens of
 * thousands of plants stay cheap; each is dropped onto the terrain via
 * `heightAt` and points off the tile are skipped.
 *
 * Non-fatal: any failure resolves to an empty group so the scene still loads.
 */
export async function loadVegetation(
  url: string,
  ctx: VegetationContext
): Promise<VegetationControl> {
  const group = new Group();
  group.name = "vegetation";

  const shimmer = { value: DEFAULT_TREE_SHIMMER };
  const translucency = { value: DEFAULT_TREE_TRANSLUCENCY };
  // By-reference clock for the crown wind sway; advanced once per frame by the
  // render loop (same elapsed seconds as the water ripple). One uniform write
  // per tile per frame.
  const uTime = { value: 0 };
  const sunDirection = ctx.sunDirection ?? new Vector3(0, 1, 0);
  let multiTuft = DEFAULT_TREE_MULTITUFT;
  let cells: CellLod[] = [];

  const [rowFeatures, canopyFeatures] = await Promise.all([
    fetchFeatures<LineFeature>(url, ctx.signal),
    ctx.canopyUrl
      ? fetchFeatures<PointFeature>(ctx.canopyUrl, ctx.signal)
      : Promise.resolve([]),
  ]);

  const { trees, hedges } = collectPlacements(rowFeatures, ctx);
  trees.push(...collectCanopy(canopyFeatures, ctx));
  if (trees.length > 0) {
    const built = buildTrees(
      trees,
      sunDirection,
      shimmer,
      uTime,
      translucency,
      ctx.heightFog
    );
    group.add(...built.meshes);
    cells = built.cells;
  }
  if (hedges.length > 0) {
    group.add(...buildHedges(hedges, ctx.heightFog));
  }

  return {
    group,
    setShimmer: (strength) => {
      shimmer.value = strength;
    },
    setMultiTuft: (enabled) => {
      multiTuft = enabled;
    },
    setTime: (seconds) => {
      uTime.value = seconds;
    },
    setTranslucency: (strength) => {
      translucency.value = strength;
    },
    // Rich crown only near the camera (and only when multi-tuft is enabled);
    // far chunks fall back to the cheap crown. Distance is to the NEAREST tree in
    // the chunk (sphere centre minus radius) with enter/exit hysteresis.
    updateLod: (cameraPos) => {
      for (const c of cells) {
        const sphere = c.cheap.boundingSphere;
        const near = sphere
          ? cameraPos.distanceTo(sphere.center) - sphere.radius
          : Number.POSITIVE_INFINITY;
        const wantRich =
          multiTuft && near < (c.rich.visible ? LOD_NEAR_OUT_M : LOD_NEAR_IN_M);
        c.rich.visible = wantRich;
        c.cheap.visible = !wantRich;
      }
    },
  };
}
