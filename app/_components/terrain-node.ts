import {
  type BufferGeometry,
  Color,
  Mesh,
  type Texture,
  Vector2,
  Vector3,
} from "three";
import {
  abs,
  cameraPosition,
  cameraViewMatrix,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  Fn,
  fract,
  fwidth,
  length,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
} from "three/webgpu";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  type GroundInputs,
  groundDetail,
  groundFields,
  urbanGreen,
} from "./ground-detail-node";
import { colonyGarden } from "./cultivated-node";
import { roadMarkings } from "./road-markings-node";
import type { GroundLight } from "./sky-light";
import { applyGroundLightNodes } from "./sky-light-node";
import { sportGround } from "./sport-ground-node";
import type { SplatLayer } from "./terrain-layer";
import type { WaterLayer } from "./water-layer";

/**
 * SPIKE (plan 020): terrain and water as TSL node materials, term for term
 * the GLSL of terrain-layer.ts and water-layer.ts: the palette-painted splat,
 * contour ink (faded where it crowds, gated off flat ground and water),
 * calmed normals, meadow mottle + grass normals + NDVI tint on class 1, the
 * ground detail and urban green of ground-detail.ts (ground-detail-node.ts);
 * the water's feathered coverage, depth tone, Fresnel sky tint, level
 * ripples, sun glitter and the drifting, bank-blurred river mist. Data-frame XY comes from world space, as in
 * shader-chunks.ts: data (x, y) = world (x, −z). Height fog is the scene's
 * fog node (height-fog-node.ts), not a per-material patch.
 */

type Live = { value: number };
const live = (ref: Live) => uniform(ref.value).onRenderUpdate(() => ref.value);

const dataXY = (): Node<"vec2"> =>
  vec2(positionWorld.x, positionWorld.z.negate());

/**
 * The splat's uv at the fragment. The tile's corner is a uniform, not a
 * constant: every tile then compiles to the same shader (the tiles share
 * their size), and a tile flown into reuses the pipeline the first one
 * built instead of compiling the terrain's — the largest — anew.
 */
function splatUv(splat: SplatLayer): Node<"vec2"> {
  const [minX, minY, maxX, maxY] = splat.bounds;
  const origin = uniform(
    new Vector2(minX - splat.offset.cx, maxY - splat.offset.cy)
  );
  const xy = dataXY();
  return vec2(
    xy.x.sub(origin.x).div(maxX - minX),
    origin.y.sub(xy.y).div(maxY - minY)
  );
}

/**
 * CONTOUR_INK: 1 on a contour line of spacing `spacing`, one pixel wide,
 * faded out once the lines crowd closer than a few pixels (fade0..fade1 in
 * contours per pixel), and 0 where a flat quad has no derivative.
 */
function contour(
  elevation: Node<"float">,
  spacing: number,
  fade0: number,
  fade1: number
): Node<"float"> {
  const d = elevation.div(spacing);
  const w = fwidth(d);
  const line = float(1).sub(
    min(abs(fract(d.sub(0.5)).sub(0.5)).div(max(w, 1e-6)), float(1))
  );
  return select(w.greaterThan(1e-6), line, float(0)).mul(
    float(1).sub(smoothstep(fade0, fade1, w))
  );
}

const INK = vec3(0.3, 0.33, 0.38);

/** TERRAIN_NORMAL: near-flat normals pulled to straight up (view space). */
function calmNormal(): Node<"vec3"> {
  const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  const keep = float(1).sub(smoothstep(0.93, 0.985, dot(normalView, up)));
  return normalize(mix(up, normalView, max(keep, 0.12)));
}

/** The meadow terms (GRASS_MOTTLE) as vars the later chunks update. */
function meadowVars(splat: SplatLayer, uv: Node<"vec2">, xy: Node<"vec2">) {
  const cls = floor(texture(splat.texture, uv).r.mul(255).add(0.5)).toVar();
  const meadow = float(1)
    .sub(step(0.5, abs(cls.sub(1))))
    .toVar();
  const fw = max(fwidth(xy.x), fwidth(xy.y)).toVar();
  const detail = meadow.mul(float(1).sub(smoothstep(0.5, 2.5, fw))).toVar();
  const mottle = sin(xy.x.mul(0.85).add(1.3))
    .mul(sin(xy.y.mul(0.78).sub(0.7)))
    .mul(0.7)
    .add(
      sin(xy.x.mul(2.7).sub(0.5))
        .mul(sin(xy.y.mul(2.3).add(1.1)))
        .mul(0.3)
    )
    .toVar();
  return { cls, detail, fw, meadow, mottle };
}

/** MEADOW_NDVI: broad lush and dry drifts, read from a coarser mip. */
function meadowNdvi(
  splat: SplatLayer,
  ndviTexture: Texture,
  uv: Node<"vec2">,
  meadow: Node<"float">,
  base: Node<"vec3">
): void {
  const ndvi = texture(ndviTexture, uv).bias(float(2.5)).r;
  const lush = smoothstep(0.1, 0.6, ndvi);
  const tint = mix(
    base.mul(vec3(1.08, 1.02, 0.88)),
    base.mul(vec3(0.84, 1.06, 0.74)),
    lush
  );
  const strength = live(splat.ground?.meadowNdvi ?? { value: 0 });
  base.assign(mix(base, tint, strength.mul(meadow).mul(step(0.012, ndvi))));
}

function groundInputs(
  splat: SplatLayer,
  uv: Node<"vec2">,
  xy: Node<"vec2">
): GroundInputs {
  const [minX, minY, maxX, maxY] = splat.bounds;
  const img = splat.texture.image as { height: number; width: number };
  return {
    classTexture: splat.texture,
    classSize: [img.width, img.height],
    edgesTexture: splat.edgesTexture,
    groundDetail: splat.ground?.groundDetail ?? { value: 0 },
    ndviTexture: splat.ndviTexture,
    size: [maxX - minX, maxY - minY],
    sunDirection: splat.sunDirection ?? new Vector3(0, 1, 0),
    surfaceTexture: splat.surfaceTexture,
    urbanGreen: splat.ground?.urbanGreen ?? { value: 0 },
    uv,
    xy,
  };
}

/** What a pass over the ground's base colour reads and writes. */
interface GroundPass {
  base: Node<"vec3">;
  fd: ReturnType<typeof groundFields>;
  g: ReturnType<typeof groundInputs>;
  m: ReturnType<typeof meadowVars>;
  uv: Node<"vec2">;
}

/**
 * The passes over the ground's base colour, in terrain-layer.ts
 * splatFragment's order: gardens, sports grounds, road markings, then the
 * NDVI tint (which a painted pitch opts out of). Each runs when its tile
 * has the raster. In GLSL they are chunks spliced in a fixed order that
 * share locals by name, under a program key of flags; here a new one is a
 * row.
 */
const GROUND_PASSES: ((
  splat: SplatLayer
) => ((p: GroundPass) => void) | undefined)[] = [
  ({ colonies }) =>
    colonies && ((p) => colonyGarden(p.g, p.fd, p.m, p.base, colonies)),
  ({ sport }) => sport && ((p) => sportGround(p.g, p.fd, p.m, p.base, sport)),
  ({ markings }) =>
    markings && ((p) => roadMarkings(p.g, p.fd, p.m, p.base, markings)),
  (splat) => {
    const ndvi = splat.ndviTexture;
    return ndvi && ((p) => meadowNdvi(splat, ndvi, p.uv, p.m.meadow, p.base));
  },
];

/**
 * The splat-painted ground: palette colour, meadow mottle, the ground
 * detail (ground-detail-node.ts), the NDVI tint, and gated contour ink.
 * The normal node reads the meadow detail and the lawn tilt the colour
 * pass leaves in its vars (NodeMaterial builds the colour before lighting).
 */
function splatTerrain(
  material: MeshStandardNodeMaterial,
  splat: SplatLayer
): void {
  const uv = splatUv(splat);
  const xy = dataXY();
  const elevation = positionWorld.y;
  const g = groundInputs(splat, uv, xy);
  const m = meadowVars(splat, uv, xy);
  const tilt = vec3(0).toVar();
  const detail = m.detail;
  material.colorNode = Fn(() => {
    const base = texture(splat.colorTexture, uv)
      .rgb.mul(m.mottle.mul(0.035).mul(m.detail).add(1))
      .toVar();
    const fd = groundFields(g, m);
    const ugW = urbanGreen(g, fd, m, base);
    tilt.assign(groundDetail(g, fd, ugW, base, m.fw));
    const pass = { g, fd, m, base, uv };
    for (const layer of GROUND_PASSES) {
      layer(splat)?.(pass);
    }
    const run = max(length(fwidth(xy)), 1e-4);
    const slope = fwidth(elevation).div(run);
    const ink = clamp(
      contour(elevation, 2, 0.08, 0.2)
        .mul(0.08)
        .add(contour(elevation, 10, 0.06, 0.16).mul(0.14)),
      0,
      0.22
    )
      .mul(smoothstep(0.025, 0.09, slope))
      .mul(
        float(1).sub(smoothstep(0.05, 0.4, texture(splat.colorTexture, uv).a))
      );
    return mix(base, INK, ink);
  })();
  // Calmed normals, the meadow's shading break-up, then the lawn edges' tilt.
  const gx = cos(xy.x.mul(0.85).add(1.3))
    .mul(sin(xy.y.mul(0.78).sub(0.7)))
    .mul(0.85);
  const gy = sin(xy.x.mul(0.85).add(1.3))
    .mul(cos(xy.y.mul(0.78).sub(0.7)))
    .mul(0.78);
  const grass = normalize(
    calmNormal().add(vec3(gx, gy, 0).mul(detail.mul(0.06)))
  );
  material.normalNode = normalize(grass.add(tilt));
}

export function createNodeTerrainMaterial(
  splat?: SplatLayer,
  light?: GroundLight
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  if (splat) {
    splatTerrain(material, splat);
    // The city's large-scale light (sky-light.ts): the sky view on the
    // ambient term, the far horizon on the sun.
    applyGroundLightNodes(material, light);
    return material;
  }
  const elevation = positionWorld.y;
  const ink = clamp(
    contour(elevation, 2, 0.08, 0.2)
      .mul(0.08)
      .add(contour(elevation, 10, 0.06, 0.16).mul(0.14)),
    0,
    0.22
  );
  material.colorNode = mix(color(0xad_b2_9e), INK, ink);
  material.normalNode = calmNormal();
  return material;
}

/** Smoothed value noise and a 3-octave fbm (the mist's GLSL). */
function valueNoise(p: Node<"vec2">): Node<"float"> {
  const h = (q: Node<"vec2">) =>
    fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(
    mix(h(i), h(i.add(vec2(1, 0))), u.x),
    mix(h(i.add(vec2(0, 1))), h(i.add(vec2(1, 1))), u.x),
    u.y
  );
}
function fbm(p: Node<"vec2">): Node<"float"> {
  return valueNoise(p)
    .mul(0.5)
    .add(valueNoise(p.mul(2)).mul(0.25))
    .add(valueNoise(p.mul(4)).mul(0.125));
}

/** water-layer.ts's sheet colour. */
const WATER_COLOR = 0x7a_9e_bc;

export function createNodeWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer,
  sunDirection?: Vector3
): WaterLayer {
  const sun = sunDirection ?? new Vector3(0, 1, 0);
  const sunDir = uniform(sun).onRenderUpdate(() => sun);
  // The render loop's clock (update), as the GLSL sheets' uTime.
  const clock = uniform(0);
  const skyTint = uniform(new Color(0x9f_b6_cc));
  const uv = splatUv(splat);
  const xy = dataXY();
  const coverage = texture(splat.colorTexture, uv).a;

  const material = new MeshStandardNodeMaterial({
    color: WATER_COLOR,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(clamp(view.y, 0, 1)), 4);
  // Depth by distance from the bank: the coverage from a coarse mip (~30 m)
  // is 1 mid-stream, so the channel deepens in tone and the shallows lighten.
  const deep = smoothstep(
    0.55,
    1,
    texture(splat.colorTexture, uv).bias(float(6)).a
  );
  const toned = mix(vec3(1.1, 1.08, 1.04), vec3(0.86, 0.92, 0.98), deep).mul(
    color(WATER_COLOR)
  );
  material.colorNode = mix(toned, skyTint, fres.mul(0.4));
  material.opacityNode = smoothstep(0.28, 0.72, coverage).mul(0.9);
  material.alphaTest = 0.001;
  // Ripples on a level sheet: the terrain grid's normals carry the DGM's
  // noisy river surface, so start from straight up (as the GLSL does).
  const wv = sin(xy.x.mul(0.35).add(clock.mul(0.8))).add(
    sin(xy.y.mul(0.27).sub(clock.mul(0.6)))
  );
  const wu = sin(xy.x.add(xy.y).mul(0.2).add(clock.mul(0.5)));
  const up = normalize(cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz);
  material.normalNode = normalize(up.add(vec3(wv, wu, 0).mul(0.06)));
  // Sun glitter off a Y-up ripple normal, gone after sunset.
  const n = normalize(vec3(wv.mul(0.12), 1, wu.mul(0.12)));
  const spec = pow(clamp(dot(n, normalize(view.add(sunDir))), 0, 1), 120);
  material.emissiveNode = color(0xff_f4_e0).mul(
    spec.mul(0.7).mul(clamp(sunDir.y, 0, 1))
  );
  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;

  // River mist: the same sheet floated 4 m up, fbm steam, depthWrite off.
  const mistStrength = uniform(LOOK_DEFAULTS.waterMist);
  const mist = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  mist.positionNode = positionLocal.add(
    modelWorldMatrixInverse.mul(vec4(0, 4, 0, 0)).xyz
  );
  // Coverage blurred over tens of metres: five spread taps from a coarse
  // mip, so the haze thins out over the banks instead of tracing them.
  const [minX, minY, maxX, maxY] = splat.bounds;
  const o = vec2(18 / (maxX - minX), 18 / (maxY - minY));
  const tap = (d: Node<"vec2">) =>
    texture(splat.colorTexture, uv.add(d)).bias(float(5)).a;
  const cov = tap(vec2(0, 0))
    .mul(0.4)
    .add(tap(vec2(o.x, 0)).mul(0.15))
    .add(tap(vec2(o.x.negate(), 0)).mul(0.15))
    .add(tap(vec2(0, o.y)).mul(0.15))
    .add(tap(vec2(0, o.y.negate())).mul(0.15));
  const w0 = smoothstep(0.02, 0.85, cov);
  const shore = w0.mul(w0).mul(float(3).sub(w0.mul(2)));
  // Large soft banks and thinner wisps, drifting on their own.
  const banks = smoothstep(
    0.15,
    0.85,
    fbm(xy.mul(0.012).add(vec2(clock.mul(0.01), clock.mul(0.006))))
  );
  const wisps = fbm(
    xy
      .mul(0.031)
      .sub(vec2(clock.mul(0.004), clock.mul(0.013)))
      .add(banks.mul(1.7))
  );
  const steam = mix(0.25, 1, banks).mul(mix(0.7, 1.15, wisps));
  // Thin the sheet out in the first tens of metres: air, not a plane.
  const nearFade = smoothstep(8, 90, length(cameraPosition.sub(positionWorld)));
  mist.colorNode = mix(skyTint, vec3(1), 0.6);
  mist.opacityNode = shore
    .mul(steam)
    .mul(nearFade)
    .mul(mistStrength)
    .mul(0.62)
    .mul(step(0.01, cov));
  mist.alphaTest = 0.002;
  // Not fogged, as the GLSL mist (a ShaderMaterial without fog chunks).
  mist.fog = false;
  const mistMesh = new Mesh(geometry, mist);
  mistMesh.name = "water-mist";
  mistMesh.renderOrder = 3;
  mistMesh.visible = LOOK_DEFAULTS.waterMist > 0.001;
  return {
    mesh,
    mistMesh,
    setMist: (strength) => {
      const v = Math.min(Math.max(strength, 0), 1);
      mistStrength.value = v;
      mistMesh.visible = v > 0.001;
    },
    update: (seconds, skyColor) => {
      clock.value = seconds;
      skyTint.value.copy(skyColor);
    },
  };
}
