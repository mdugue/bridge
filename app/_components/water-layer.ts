import {
  type BufferGeometry,
  type Color,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type UniformNode,
} from "three/webgpu";
import {
  cameraPosition,
  cameraViewMatrix,
  clamp,
  distance,
  dot,
  float,
  floor,
  fract,
  materialColor,
  materialOpacity,
  mix,
  modelWorldMatrixInverse,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import { dataXY, type F, type V2, type V3 } from "./shader-chunks";
import { type SplatLayer, splatUv } from "./terrain-layer";

/** Animated water surface, masked to the land-cover "water" class (id 8). */
export interface WaterLayer {
  mesh: Mesh;
  /** drifting river-haze sheet (added to the Z-up `world`, like the water) */
  mistMesh: Mesh;
  /** 0..1 — river-mist (Flussnebel) strength */
  setMist: (strength: number) => void;
  /** Advance the ripple, glitter and mist animation (elapsed seconds). The
   *  sky tint is the fog's colour node itself: nothing to copy per frame. */
  update: (seconds: number) => void;
}

/** The animation clock, shared by every tile's water and mist. */
const waterTime = uniform(0);

/** How strongly the view-angle Fresnel tints toward the sky. */
const FRESNEL = 0.4;
/** The sun glitter's strength and colour (warm white). */
const GLITTER = 0.7;
const SUN_COLOUR = vec3(1, 0xf4 / 255, 0xe0 / 255);

/** The crossing sine waves of the ripples at data-frame `xy`. */
function ripples(xy: V2): { u: F; v: F } {
  const t = waterTime;
  return {
    v: sin(xy.x.mul(0.35).add(t.mul(0.8))).add(
      sin(xy.y.mul(0.27).sub(t.mul(0.6)))
    ),
    u: sin(xy.x.add(xy.y).mul(0.2).add(t.mul(0.5))),
  };
}

// --- the river mist ------------------------------------------------------------------

const mistHash = (p: V2): F =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43_758.5453));

function mistNoise(p: V2): F {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(
    mix(mistHash(i), mistHash(i.add(vec2(1, 0))), u.x),
    mix(mistHash(i.add(vec2(0, 1))), mistHash(i.add(vec2(1, 1))), u.x),
    u.y
  );
}

function mistFbm(p: V2): F {
  let v: F = float(0);
  let q = p;
  let a = 0.5;
  for (let i = 0; i < 3; i++) {
    v = v.add(mistNoise(q).mul(a));
    q = q.mul(2);
    a *= 0.5;
  }
  return v;
}

/**
 * Water coverage blurred over tens of metres: the colour splat's alpha read
 * from a coarse mip (bias) at five spread taps. The shoreline in the splat
 * is ~1 m wide, which is what made the mist end on a crisp outline of the
 * river; the haze has to thin out over the banks instead.
 */
function mistCoverage(splat: SplatLayer, uv: V2, size: [number, number]): F {
  const tap = (du: number, dv: number) =>
    texture(splat.colorTexture, uv.add(vec2(du, dv))).bias(float(5)).a;
  const ox = 18 / size[0];
  const oy = 18 / size[1];
  return tap(0, 0)
    .mul(0.4)
    .add(tap(ox, 0).mul(0.15))
    .add(tap(-ox, 0).mul(0.15))
    .add(tap(0, oy).mul(0.15))
    .add(tap(0, -oy).mul(0.15));
}

/**
 * Drifting river haze as a SINGLE masked sheet sharing the Z-up terrain
 * geometry (the right tool — thousands of particles over a river is not).
 * A scrolling ≤3-octave fbm "steam" band, gated to the water class, tinted
 * from the same palette sky colour as the water. `depthWrite: false` so it
 * never punches the shared depth (DoF would otherwise focus on the haze);
 * `fog = false`: it is haze itself.
 */
function createWaterMist(
  geometry: BufferGeometry,
  splat: SplatLayer,
  size: [number, number],
  skyTint: UniformNode<"color", Color>
): { mesh: Mesh; setMist: (strength: number) => void } {
  const strength = uniform(LOOK_DEFAULTS.waterMist);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  material.fog = false;
  // Float the sheet a few metres above the water (world Y is up) so it has
  // vertical presence — a sheet lying ON the water is edge-on (and so
  // invisible) from street level. The lift is world-space, taken back into
  // the mesh's (Z-up) local frame.
  material.positionNode = positionLocal.add(
    modelWorldMatrixInverse.mul(vec4(0, 4, 0, 0)).xyz
  );
  // The float is along world Y, so the data-frame XY (and the splat uv)
  // are the water's own.
  const xy = dataXY();
  const cov = mistCoverage(splat, splatUv(splat), size);
  // Broad feather, then a smooth cubic so the haze has no visible rim.
  const feather = smoothstep(0.02, 0.85, cov);
  const wcov = feather.mul(feather).mul(feather.mul(-2).add(3));
  // Two slowly drifting fbm layers at different scales and directions:
  // large soft banks and thinner wisps, no threshold anywhere, so the
  // density varies continuously instead of forming blobs with edges.
  const t = waterTime;
  const q = xy.mul(0.012).add(vec2(t.mul(0.01), t.mul(0.006)));
  const r = xy.mul(0.031).sub(vec2(t.mul(0.004), t.mul(0.013)));
  const banks = smoothstep(0.15, 0.85, mistFbm(q));
  const wisps = mistFbm(r.add(banks.mul(1.7)));
  const steam = mix(0.25, 1, banks).mul(mix(0.7, 1.15, wisps));
  // A sheet has an outline where it meets the eye up close: thin it out in
  // the first tens of metres so it reads as air, not as a plane.
  const nearFade = smoothstep(8, 90, distance(cameraPosition, positionWorld));
  const alpha = wcov.mul(steam).mul(nearFade).mul(strength).mul(0.62);
  material.maskNode = cov.greaterThan(0.01).and(alpha.greaterThan(0.002));
  // Near-white warm haze (brighter than the sky tint) so it clearly reads
  // as mist over the pale water rather than blending into it.
  material.colorNode = mix(skyTint.rgb, vec3(1, 1, 1), 0.6);
  material.opacityNode = alpha;
  const mesh = new Mesh(geometry, material);
  mesh.name = "water-mist";
  mesh.renderOrder = 3; // after the water sheet (2)
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.visible = LOOK_DEFAULTS.waterMist > 0.001;
  return {
    mesh,
    setMist: (s) => {
      const v = Math.min(Math.max(s, 0), 1);
      strength.value = v;
      // Drop the sheet from the render submission entirely when off
      // (mirrors the lamp-glow visibility gate — keep additive overdraw
      // fading to 0).
      mesh.visible = v > 0.001;
    },
  };
}

// --- the water sheet -----------------------------------------------------------------

/** The sheet's diffuse colour: the depth tone by distance from the bank,
 *  then the Fresnel sky tint. */
function waterColour(
  splat: SplatLayer,
  uv: V2,
  view: V3,
  skyTint: UniformNode<"color", Color>
): V3 {
  // Depth by distance from the bank, as on a drawn map: the coverage read
  // from a coarse mip (~30 m) is 1 mid-stream and falls toward the shore,
  // so the channel deepens in tone and the shallows lighten.
  const deep = smoothstep(
    0.55,
    1,
    texture(splat.colorTexture, uv).bias(float(6)).a
  );
  const toned = materialColor.rgb.mul(
    mix(vec3(1.1, 1.08, 1.04), vec3(0.86, 0.92, 0.98), deep)
  );
  const fresnel = pow(float(1).sub(clamp(view.y, 0, 1)), 4);
  return mix(toned, skyTint.rgb, fresnel.mul(FRESNEL));
}

/**
 * A translucent water sheet that re-uses the terrain geometry (so it drapes
 * on the same heightfield) but discards every fragment whose land-cover
 * class is not water. A standard node material, so the scene's sun,
 * shadows and fog apply for free; a cheap sine-wave normal wobble gives
 * stylized movement.
 *
 * On top of the base sheet it fakes poetic water at standard-material cost
 * (no transmission): a view-angle Fresnel sky tint (the fog's colour, which
 * follows the time-of-day palette), a tight additive sun-glitter lobe that
 * fades out at night, and a feathered shoreline. The Fresnel and glitter
 * need world (Y-up) vectors, so they come from `positionWorld` and the
 * camera, NOT the shading normal.
 *
 * Water coverage is the ALPHA channel of the palette-painted colour splat
 * (landcover-splat.ts), a soft coverage field sampled LINEAR + mipmapped +
 * anisotropic, so the shoreline is hardware anti-aliased.
 *
 * Geometry is SHARED with the terrain mesh — do not dispose it here. Both
 * sheets sit beside the terrain mesh with its transform.
 */
export function createWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer,
  skyTint: UniformNode<"color", Color>
): WaterLayer {
  const sun = splat.ground.sunDirection;
  const [minX, minY, maxX, maxY] = splat.bounds;
  const size: [number, number] = [maxX - minX, maxY - minY];
  const uv = splatUv(splat);
  const xy = dataXY();

  const material = new MeshStandardNodeMaterial({
    color: 0x7a_9e_bc,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    // Pull slightly towards camera so it never z-fights the shared terrain.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // A widened, feathered band dissolves the bank instead of stair-stepping.
  const wcov = smoothstep(0.28, 0.72, texture(splat.colorTexture, uv).a);
  material.maskNode = wcov.greaterThan(0.001);
  material.opacityNode = materialOpacity.mul(wcov);
  const view = normalize(cameraPosition.sub(positionWorld));
  material.colorNode = waterColour(splat, uv, view, skyTint);

  // Stylized ripples on the shading normal (view space, as the slot takes
  // it). The sheet shares the terrain's grid, whose normals carry the DGM's
  // noisy river surface (and 8-bit quantisation): lit, that painted the
  // Elbe in dark blotches. Water is level — start from up.
  const wave = ripples(xy);
  const up = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz.normalize();
  material.normalNode = normalize(up.add(vec3(wave.v, wave.u, 0).mul(0.06)));

  // Sun glitter: a tight specular lobe off a SEPARATE Y-up ripple normal, so
  // it reads as a real highlight. Gated by the sun's height so it vanishes
  // after sunset.
  const glitterN = normalize(vec3(wave.v.mul(0.12), 1, wave.u.mul(0.12)));
  const half = normalize(view.add(sun));
  const spec = pow(clamp(dot(glitterN, half), 0, 1), 120);
  material.emissiveNode = SUN_COLOUR.mul(
    spec.mul(GLITTER).mul(clamp(sun.y, 0, 1))
  );

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2; // after the opaque terrain fill
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  // River mist: a second masked sheet on the SAME (shared) geometry, on the
  // same clock and sky tint.
  const mist = createWaterMist(geometry, splat, size, skyTint);

  return {
    mesh,
    mistMesh: mist.mesh,
    setMist: mist.setMist,
    update: (seconds) => {
      waterTime.value = seconds;
    },
  };
}
