import {
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardNodeMaterial,
  type MeshStandardNodeMaterialParameters,
  NoColorSpace,
  RedFormat,
  RGBAFormat,
  type Texture,
  UnsignedByteType,
  Vector2,
  type Vector3,
} from "three/webgpu";
import {
  asin,
  atan,
  clamp,
  degrees,
  distance,
  float,
  floor,
  Fn,
  fract,
  If,
  int,
  length,
  max,
  min,
  mix,
  mod,
  normalWorldGeometry,
  select,
  smoothstep,
  texture,
  uniform,
  vec2,
} from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";
import { decodeGreyPng } from "@/lib/city/png-raster";
import {
  FACADE_SVF_GAIN,
  FACADE_SVF_OFFSET_M,
  HORIZON_AZIMUTHS,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_SOFT_DEG,
  HORIZON_TEXTURE_LAYERS,
  NEAR_BAND_FADE_FROM,
  NEAR_MAX_DEG,
} from "@/lib/city/skyview";
import { isAbortError } from "./fetch-optional";
import {
  dataXY,
  type F,
  type Live,
  rasterUv,
  type V2,
  type V3,
} from "./shader-chunks";
import { sceneShared, textureBytes, trackTexture } from "./three-utils";

/**
 * The city's large-scale light (plan 033), from two baked rasters
 * (pipeline/bake/skyview.py; constants in lib/city/skyview.ts):
 *
 * - **Himmelslicht** (sky-view factor): the fraction of the sky a point
 *   sees within 150 m scales the INDIRECT diffuse light only — the
 *   hemisphere fill that lit a narrow courtyard as brightly as the open
 *   Elbwiesen. It is the material's `aoNode`, which three multiplies into
 *   the indirect light after the lights are summed, so the sun's direct
 *   light is untouched. (It scales the indirect specular too; the scene has
 *   no environment map, so that term is zero here.) Terrain (with its
 *   kerbs, fences and stairs) and clay facades.
 * - **Ferne Schatten** (horizon): per texel the skyline's elevation angle
 *   in 16 azimuths, in two bands — occluders 80–1 500 m out, and 8–80 m
 *   out. Where the sun stands below it, the sun's direct light is cut: the
 *   long low-sun shadows the shadow map's frustum ends, and beyond the
 *   frustum the shadows of the buildings next door. Inside the frustum the
 *   shadow map has the near occluders (with their shapes), so the near band
 *   only fades in over the frustum's last 20 % (`shadowReach`, kept by the
 *   sun rig) and counts whole beyond it. It is the material's
 *   `receivedShadowNode`, combined with the shadow map by `min`, never a
 *   product: where both see the same occluder it must not darken twice.
 *   The ground only, with what is baked into it (kerbs, fences, stairs,
 *   walls: `applyGroundLight`); the plan's facade step waits on plates.
 *
 * Both rows at 0 are the picture without them.
 */

// --- the tile's baked light ------------------------------------------------------

/**
 * A tile's baked light as the ground and the things baked into its fine
 * terrain read it (kerbs, fences, stairs, walls): the terrain's own
 * rasters, where they lie, and the rows, the frustum and the sun it binds
 * (uniform nodes, shared by every tile). Without it a kerb on a
 * far-shadowed street stayed sunlit on a shadowed carriageway.
 */
export interface GroundLight {
  svf?: Texture;
  horizon?: Texture;
  /** the tile's recentered north-west corner and size (data frame, m) */
  origin: [number, number];
  size: [number, number];
  skyView: Live;
  horizonShade: Live;
  /** the shadow frustum's centre (data frame x, y) and half-size (z) */
  shadowReach: UniformNode<"vec3", Vector3>;
  /** world (Y-up), surface → sun */
  sunDirection: UniformNode<"vec3", Vector3>;
}

const SOFT = HORIZON_SOFT_DEG;
const AZ_STEP = 360 / HORIZON_AZIMUTHS;

/** 1 where the sun at elevation `el` clears a skyline at `h` (°), across a
 *  soft band about the sun's disk plus the raster's angle step. */
const clears = (h: F, el: F): F => smoothstep(h.sub(SOFT), h.add(SOFT), el);

/**
 * Azimuth `k`'s horizon angle (°) at `uv` in the band whose planes start at
 * layer `base`: layer base + ⌊k / 4⌋, channel k mod 4. Read at level 0: the
 * array has no mips, and the near band's read sits in a branch (no
 * implicit derivative may be taken there).
 */
function hzAngle(
  horizon: Texture,
  uv: V2,
  k: F,
  base: number,
  maxDeg: number
): F {
  // one read, four channels to choose from
  const v = texture(horizon, uv)
    .depth(floor(k.div(4)).add(base))
    .level(int(0))
    .toVar();
  const c = k.mod(4);
  const s = select(
    c.lessThan(0.5),
    v.r,
    select(c.lessThan(1.5), v.g, select(c.lessThan(2.5), v.b, v.a))
  );
  return s.mul(maxDeg);
}

/**
 * How much of the sun clears the skyline (1 = all), before the row
 * (lib/city/skyview.ts horizonSunVisibility): the far band always; the
 * near band by its weight, 0 inside the shadow frustum and 1 beyond it
 * (lib/city/skyview.ts nearBandWeight) — skipped where it is 0, which is
 * most of what is on screen.
 */
function hzSunVisible(light: GroundLight, horizon: Texture, uv: V2): F {
  const sun = light.sunDirection;
  const reach = light.shadowReach;
  return Fn(() => {
    const visible = float(1).toVar();
    // straight overhead the azimuth is undefined, and the sun clears all
    If(length(sun.xz).greaterThanEqual(1e-4), () => {
      // world (x, y, z) = data (x, −z, y): azimuth clockwise from north
      const el = degrees(asin(clamp(sun.y, -1, 1)));
      const az = mod(degrees(atan(sun.x, sun.z.negate())).add(360), 360);
      const f = az.div(AZ_STEP);
      const k0 = mod(floor(f), HORIZON_AZIMUTHS);
      const k1 = mod(k0.add(1), HORIZON_AZIMUTHS);
      const t = fract(f);
      const far = clears(
        mix(
          hzAngle(horizon, uv, k0, 0, HORIZON_MAX_DEG),
          hzAngle(horizon, uv, k1, 0, HORIZON_MAX_DEG),
          t
        ),
        el
      ).toVar();
      visible.assign(far);
      const r = max(reach.z, 1);
      const w = smoothstep(
        r.mul(NEAR_BAND_FADE_FROM),
        r,
        distance(dataXY(), reach.xy)
      ).toVar();
      If(w.greaterThan(0), () => {
        const near = mix(
          hzAngle(horizon, uv, k0, HORIZON_LAYERS, NEAR_MAX_DEG),
          hzAngle(horizon, uv, k1, HORIZON_LAYERS, NEAR_MAX_DEG),
          t
        );
        visible.assign(min(far, mix(1, clears(near, el), w)));
      });
    });
    return visible;
  })();
}

/**
 * Folds a tile's sky view (`skyView`: the ambient term, → `aoNode`) and far
 * horizon (the sun, → `receivedShadowNode`) into a node material, as the
 * ground has them — the same terms, read at the fragment's own ground
 * position. A few texture reads on a few pixels; nothing when the tile has
 * neither raster.
 */
export function applyGroundLight(
  material: MeshStandardNodeMaterial,
  light: GroundLight | undefined,
  skyView = true
): void {
  const svf = skyView ? light?.svf : undefined;
  const horizon = light?.horizon;
  if (!(light && (svf || horizon))) {
    return;
  }
  // The corner is a uniform: every tile then builds the same shader.
  const uv = rasterUv(
    dataXY(),
    uniform(new Vector2(...light.origin)),
    light.size
  );
  if (svf) {
    material.aoNode = mix(1, texture(svf, uv).r, light.skyView);
  }
  if (horizon) {
    const lit = mix(1, hzSunVisible(light, horizon, uv), light.horizonShade);
    // three's ShadowNode calls this with the light's shadow term (the
    // filtered shadow map, 1 outside its frustum) and multiplies the light
    // colour by what it returns. The @types declare it without the
    // argument, hence the optional parameter; the term is a float (a vec3
    // only with coloured, transmitted shadows, which the scene does not use).
    material.receivedShadowNode = (shadow?: Node) =>
      shadow ? min(shadow as F, lit) : lit;
  }
}

/** A standard node material lit by the tile's baked light. */
export function groundLitMaterial(
  params: MeshStandardNodeMaterialParameters,
  light: GroundLight | undefined,
  skyView: boolean
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial(params);
  applyGroundLight(material, light, skyView);
  return material;
}

// --- the clay facades --------------------------------------------------------------

/** One building tile's sky view as its clay reads it. */
export interface ClaySky {
  /**
   * The facade's ambient scale (the clay's `aoNode` factor): the ground's
   * sky view a little outside the wall (under the roof the ground sees no
   * sky), doubled (a vertical face sees at most half the sky, the ground at
   * its foot the wall too), faded to the open sky toward the eaves — a
   * courtyard's ground floor is dim, its eaves are not. Roofs sit above the
   * eaves: unchanged. `localH` is the fragment's height above the
   * building's ground, `eaveH` the eave height, `skyView` the row;
   * `normal` the world geometric normal. lib/city/skyview.ts
   * `facadeSkyView` is the same curve.
   */
  ao: (localH: F, eaveH: F, skyView: F, normal?: V3) => F;
  /** Binds the tile's raster once it lands: a texture swap and two uniform
   *  writes, never a rebuild. */
  set: (
    texture: Texture,
    origin: [number, number],
    size: [number, number]
  ) => void;
}

/** The clay's sky view: the open-sky texel until the tile's raster lands. */
export function createClaySky(): ClaySky {
  const svf = texture(openSkyTexture());
  const origin = uniform(new Vector2(0, 0));
  const size = uniform(new Vector2(1, 1));
  return {
    set: (tex, o, s) => {
      svf.value = tex;
      origin.value.set(o[0], o[1]);
      size.value.set(s[0], s[1]);
    },
    ao: (localH, eaveH, skyView, normal = normalWorldGeometry) => {
      const n = vec2(normal.x, normal.z.negate());
      const l = length(n);
      const out = select(l.greaterThan(1e-3), n.div(max(l, 1e-3)), vec2(0, 0));
      const p = dataXY().add(out.mul(FACADE_SVF_OFFSET_M));
      const uv = vec2(
        p.x.sub(origin.x).div(size.x),
        origin.y.sub(p.y).div(size.y)
      );
      const wall = min(svf.sample(uv).r.mul(FACADE_SVF_GAIN), 1);
      const lifted = mix(wall, 1, smoothstep(0, max(eaveH, 3), localH));
      return mix(1, lifted, skyView);
    },
  };
}

const white = sceneShared(() => {
  const tex = new DataTexture(
    new Uint8Array([255]),
    1,
    1,
    RedFormat,
    UnsignedByteType
  );
  // LINEAR like the sky-view rasters that replace it on a clay tile: the
  // swap then keeps the texture's sampling state (a filterable R8, a linear
  // sampler).
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
});
/** The 1×1 sky view "all sky" a clay tile binds until its raster lands;
 *  disposed with the last app that holds it (`retainOpenSkyTexture`). */
export function openSkyTexture(): DataTexture {
  return white.get();
}

/** An app's hold on the open-sky texel; call the result on dispose. */
export const retainOpenSkyTexture = white.retain;

// --- loading -------------------------------------------------------------------------

/** Drops the CPU copy once the GPU has it (as terrain-layer's rasters do). */
function releaseAfterUpload(tex: Texture): void {
  tex.onUpdate = () => {
    (tex.image as { data: Uint8Array | null }).data = null;
    tex.onUpdate = null;
  };
}

async function fetchGrey(url: string, signal?: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return decodeGreyPng(new Uint8Array(await res.arrayBuffer()));
}

/**
 * The sky-view raster as a RED texture, LINEAR + mipmapped (a soft field).
 * Decoded by the viewer's own PNG decoder, never the browser's. Absent or
 * undecodable → null (the light stays as it was); rethrows an abort.
 */
export async function loadSkyViewTexture(
  url: string,
  signal?: AbortSignal
): Promise<Texture | null> {
  try {
    const raster = await fetchGrey(url, signal);
    const tex = new DataTexture(
      raster.data,
      raster.width,
      raster.height,
      RedFormat,
      UnsignedByteType
    );
    tex.flipY = false;
    tex.unpackAlignment = 1;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.colorSpace = NoColorSpace;
    tex.needsUpdate = true;
    releaseAfterUpload(tex);
    trackTexture(tex, textureBytes(raster.width, raster.height, 1, true));
    return tex;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * The horizon raster as an 8-layer RGBA array texture (the far band's four
 * planes, then the near band's): the PNG is the planes stacked
 * north-to-south, each n rows of n RGBA texels with the bytes interleaved —
 * exactly a DataArrayTexture's layer-major layout. LINEAR (the angles
 * interpolate), no mipmaps. Absent, or an older one-band raster → null.
 */
export async function loadHorizonTexture(
  url: string,
  signal?: AbortSignal
): Promise<DataArrayTexture | null> {
  try {
    const raster = await fetchGrey(url, signal);
    const n = raster.width / 4;
    if (raster.height !== n * HORIZON_TEXTURE_LAYERS) {
      return null;
    }
    const tex = new DataArrayTexture(raster.data, n, n, HORIZON_TEXTURE_LAYERS);
    tex.format = RGBAFormat;
    tex.type = UnsignedByteType;
    tex.flipY = false;
    tex.unpackAlignment = 1;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = NoColorSpace;
    tex.needsUpdate = true;
    releaseAfterUpload(tex);
    trackTexture(tex, textureBytes(n, n * HORIZON_TEXTURE_LAYERS, 4, false));
    return tex;
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}
