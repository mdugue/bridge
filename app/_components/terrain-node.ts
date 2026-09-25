import { type BufferGeometry, Color, Mesh, Vector3 } from "three";
import {
  abs,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  modelWorldMatrixInverse,
  normalize,
  normalView,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  texture,
  time,
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
import type { SplatLayer } from "./terrain-layer";
import type { WaterLayer } from "./water-layer";

/**
 * SPIKE (plan 020): terrain and water as TSL node materials, term for term
 * the GLSL of terrain-layer.ts and water-layer.ts: the palette-painted splat,
 * contour ink, meadow mottle + grass normals + NDVI tint on class 1; the
 * water's feathered coverage, Fresnel sky tint, ripples, sun glitter and the
 * drifting river mist. Data-frame XY comes from world space, as in
 * shader-chunks.ts: data (x, y) = world (x, −z). Height fog is the scene's
 * fog node (height-fog-node.ts), not a per-material patch.
 */

type Live = { value: number };
const live = (ref: Live) => uniform(ref.value).onRenderUpdate(() => ref.value);

const dataXY = (): Node<"vec2"> =>
  vec2(positionWorld.x, positionWorld.z.negate());

function splatUv(splat: SplatLayer): Node<"vec2"> {
  const [minX, minY, maxX, maxY] = splat.bounds;
  const ox = minX - splat.offset.cx;
  const oy = maxY - splat.offset.cy;
  const xy = dataXY();
  return vec2(
    xy.x.sub(ox).div(maxX - minX),
    float(oy)
      .sub(xy.y)
      .div(maxY - minY)
  );
}

/** 1 on a contour line of spacing `step`, fwidth-constant width. */
function contour(elevation: Node<"float">, spacing: number): Node<"float"> {
  const d = elevation.div(spacing);
  return float(1).sub(
    min(abs(fract(d.sub(0.5)).sub(0.5)).div(fwidth(d)), float(1))
  );
}

export function createNodeTerrainMaterial(
  splat?: SplatLayer
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  const elevation = positionWorld.y;
  const ink = clamp(
    contour(elevation, 2).mul(0.1).add(contour(elevation, 10).mul(0.15)),
    0,
    0.26
  );
  if (!splat) {
    material.colorNode = mix(color(0xad_b2_9e), vec3(0.3, 0.33, 0.38), ink);
    return material;
  }
  const uv = splatUv(splat);
  const xy = dataXY();
  // Meadow (class 1) detail, faded out where a texel spans metres.
  const cls = floor(texture(splat.texture, uv).r.mul(255).add(0.5));
  const meadow = float(1).sub(step(0.5, abs(cls.sub(1))));
  const fw = max(fwidth(xy.x), fwidth(xy.y));
  const detail = meadow.mul(float(1).sub(smoothstep(0.5, 2.5, fw)));
  const mottle = sin(xy.x.mul(0.85).add(1.3))
    .mul(sin(xy.y.mul(0.78).sub(0.7)))
    .mul(0.7)
    .add(
      sin(xy.x.mul(2.7).sub(0.5))
        .mul(sin(xy.y.mul(2.3).add(1.1)))
        .mul(0.3)
    );
  let base: Node<"vec3"> = texture(splat.colorTexture, uv).rgb.mul(
    float(1).add(mottle.mul(0.06).mul(detail))
  );
  if (splat.ndviTexture) {
    const ndvi = texture(splat.ndviTexture, uv).r;
    const lush = clamp(ndvi.sub(0.1).div(0.5), 0, 1);
    const tint = mix(
      base.mul(vec3(1.14, 1.02, 0.82)),
      base.mul(vec3(0.7, 1.12, 0.52)),
      lush
    );
    const strength = live(splat.ground?.meadowNdvi ?? { value: 0 });
    base = mix(base, tint, strength.mul(meadow).mul(step(0.012, ndvi)));
  }
  material.colorNode = mix(base, vec3(0.3, 0.33, 0.38), ink);
  // Grass: a faint shading-normal break-up the grazing sun catches.
  const gx = cos(xy.x.mul(0.85).add(1.3))
    .mul(sin(xy.y.mul(0.78).sub(0.7)))
    .mul(0.85);
  const gy = sin(xy.x.mul(0.85).add(1.3))
    .mul(cos(xy.y.mul(0.78).sub(0.7)))
    .mul(0.78);
  material.normalNode = normalize(
    normalView.add(vec3(gx, gy, 0).mul(detail.mul(0.12)))
  );
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

export function createNodeWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer,
  sunDirection?: Vector3
): WaterLayer {
  const sun = sunDirection ?? new Vector3(0, 1, 0);
  const sunDir = uniform(sun).onRenderUpdate(() => sun);
  const skyTint = uniform(new Color(0x9f_b6_cc));
  const uv = splatUv(splat);
  const xy = dataXY();
  const coverage = texture(splat.colorTexture, uv).a;

  const material = new MeshStandardNodeMaterial({
    color: 0x86_a8_c4,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const view = normalize(cameraPosition.sub(positionWorld));
  const fres = pow(float(1).sub(clamp(view.y, 0, 1)), 4);
  material.colorNode = mix(color(0x86_a8_c4), skyTint, fres.mul(0.55));
  material.opacityNode = smoothstep(0.28, 0.72, coverage).mul(0.8);
  material.alphaTest = 0.001;
  // Ripples: crossing sine waves on the shading normal.
  const wv = sin(xy.x.mul(0.35).add(time.mul(0.8))).add(
    sin(xy.y.mul(0.27).sub(time.mul(0.6)))
  );
  const wu = sin(xy.x.add(xy.y).mul(0.2).add(time.mul(0.5)));
  material.normalNode = normalize(normalView.add(vec3(wv, wu, 0).mul(0.06)));
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
  const shore = smoothstep(0.1, 0.95, coverage);
  const steam = mix(
    0.35,
    1,
    smoothstep(
      0.1,
      0.9,
      fbm(xy.mul(0.025).add(vec2(time.mul(0.018), time.mul(0.012))))
    )
  );
  mist.colorNode = mix(skyTint, vec3(1), 0.65);
  mist.opacityNode = shore.mul(shore).mul(steam).mul(mistStrength).mul(0.8);
  mist.alphaTest = 0.001;
  mist.fog = true;
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
    update: (_seconds, skyColor) => {
      skyTint.value.copy(skyColor);
    },
  };
}
