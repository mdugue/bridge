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
  type WebGPURenderer,
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
  vec2,
} from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";
import { decodeGreyPng, type GreyRaster } from "@/lib/city/png-raster";
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
  type Slots,
  setGraph,
  setSlots,
  slotTexture,
  slotUniform,
} from "./material-slots";
import {
  dataXY,
  type F,
  type Live,
  rasterUv,
  type Tex,
  type V2,
  type V3,
} from "./shader-chunks";
import {
  dropDataOnUpload,
  fetchRasterBytes,
  inRasterTurn,
  uploadNow,
} from "./raster-upload";
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
function hzAngle(horizon: Tex, uv: V2, k: F, base: number, maxDeg: number): F {
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
function hzSunVisible(light: GroundLight, horizon: Tex, uv: V2): F {
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

/** A light variant's shared nodes (see `applyGroundLight`). */
interface GroundLightGraph {
  ao?: F;
  receivedShadow?: (shadow?: Node) => Node;
}

/**
 * The light's graphs, one per variant (which rasters it has, and the
 * tile's size), per app — keyed by its sun uniform, which every tile of an
 * app shares — so a tile that arrives builds no shader (material-slots.ts).
 */
const lightGraphs = new WeakMap<object, Map<string, GroundLightGraph>>();

/** A light variant's key: which rasters it reads, and the tile's size. */
const lightVariant = (
  light: GroundLight,
  svf: Texture | undefined,
  horizon: Texture | undefined
): string =>
  [svf ? "svf" : "", horizon ? "horizon" : "", ...light.size].join("|");

/**
 * The key of the ground light a material takes (`applyGroundLight`): the
 * part of its build the light decides (material-slots.ts `setGraph`).
 */
export function groundLightKey(
  light: GroundLight | undefined,
  skyView = true
): string {
  const svf = skyView ? light?.svf : undefined;
  const horizon = light?.horizon;
  return light && (svf || horizon)
    ? lightVariant(light, svf, horizon)
    : "unlit";
}

function lightGraph(
  light: GroundLight,
  svf: Texture | undefined,
  horizon: Texture | undefined
): GroundLightGraph {
  let graphs = lightGraphs.get(light.sunDirection);
  if (!graphs) {
    graphs = new Map();
    lightGraphs.set(light.sunDirection, graphs);
  }
  const key = lightVariant(light, svf, horizon);
  let graph = graphs.get(key);
  if (graph) {
    return graph;
  }
  // The tile's corner and rasters are slots: every tile reads its own.
  const origin = slotUniform(
    "lightOrigin",
    new Vector2(...light.origin)
  ) as unknown as UniformNode<"vec2", Vector2>;
  const uv = rasterUv(dataXY(), origin, light.size);
  graph = {};
  if (svf) {
    graph.ao = mix(
      1,
      texture(slotTexture("lightSvf", svf), uv).r,
      light.skyView
    );
  }
  if (horizon) {
    const lit = mix(
      1,
      hzSunVisible(light, slotTexture("lightHorizon", horizon), uv),
      light.horizonShade
    );
    // three's ShadowNode calls this with the light's shadow term (the
    // filtered shadow map, 1 outside its frustum) and multiplies the light
    // colour by what it returns. The @types declare it without the
    // argument, hence the optional parameter; the term is a float (a vec3
    // only with coloured, transmitted shadows, which the scene does not use).
    graph.receivedShadow = (shadow?: Node) =>
      shadow ? min(shadow as F, lit) : lit;
  }
  graphs.set(key, graph);
  return graph;
}

/**
 * Folds a tile's sky view (`skyView`: the ambient term, → `aoNode`) and far
 * horizon (the sun, → `receivedShadowNode`) into a node material, as the
 * ground has them — the same terms, read at the fragment's own ground
 * position. A few texture reads on a few pixels; nothing when the tile has
 * neither raster. The nodes are the variant's shared ones; the tile's
 * rasters and corner go into the material's slots.
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
  const graph = lightGraph(light, svf, horizon);
  if (graph.ao) {
    material.aoNode = graph.ao;
  }
  if (graph.receivedShadow) {
    material.receivedShadowNode = graph.receivedShadow;
  }
  setSlots(material, {
    ...(material.userData.slots as Slots | undefined),
    lightOrigin: new Vector2(...light.origin),
    lightSvf: svf,
    lightHorizon: horizon,
  });
}

/**
 * A standard node material lit by the tile's baked light. `kind` names
 * what else its build depends on (the caller's parameters and nodes, the
 * same for every tile): the build is shared under it (`setGraph`).
 */
export function groundLitMaterial(
  kind: string,
  params: MeshStandardNodeMaterialParameters,
  light: GroundLight | undefined,
  skyView: boolean
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial(params);
  material.name = "ground-lit";
  applyGroundLight(material, light, skyView);
  setGraph(material, `${kind}|${groundLightKey(light, skyView)}`);
  return material;
}

// --- the clay facades --------------------------------------------------------------

/** The clay's sky view, read through slots (material-slots.ts). */
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
}

/**
 * The clay's sky view for the graph every building tile shares: its raster,
 * corner and extent are slots, which a tile's clay fills with the open sky
 * (`openSkySlots`) until its raster lands (`claySkySlots`) — a swap of
 * values, never a rebuild.
 */
export function createClaySky(): ClaySky {
  const svf = slotTexture("claySvf", openSkyTexture());
  // reason: a Vector2 slot is a vec2 uniform; slotUniform types it loosely.
  const origin = slotUniform(
    "clayOrigin",
    new Vector2(0, 0)
  ) as unknown as UniformNode<"vec2", Vector2>;
  const size = slotUniform(
    "claySize",
    new Vector2(1, 1)
  ) as unknown as UniformNode<"vec2", Vector2>;
  return {
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

/**
 * A tile's sky view as its clay's slots: the raster, its north-west corner
 * in the recentered data frame and its extent (m).
 */
export function claySkySlots(
  raster: Texture,
  origin: [number, number],
  size: [number, number]
): Slots {
  return {
    claySvf: raster,
    clayOrigin: new Vector2(...origin),
    claySize: new Vector2(...size),
  };
}

/** The open sky: a clay's sky view until its tile's raster lands. */
export const openSkySlots = (): Slots =>
  claySkySlots(openSkyTexture(), [0, 0], [1, 1]);

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

/**
 * A baked light raster: fetched, then decoded by the viewer's own PNG
 * decoder (never the browser's), made a texture by `make` and on the GPU in
 * its turn (raster-upload.ts: one raster at a time site-wide, its CPU bytes
 * dropped at the upload). Absent, undecodable, refused by `make` or failed
 * to upload → null (the light stays as it was); rethrows an abort.
 */
async function loadLightRaster<T extends Texture>(
  url: string,
  make: (raster: GreyRaster) => T | null,
  renderer?: WebGPURenderer,
  signal?: AbortSignal
): Promise<T | null> {
  try {
    const bytes = await fetchRasterBytes(url, signal);
    return await inRasterTurn(async () => {
      const raster = await decodeGreyPng(bytes);
      signal?.throwIfAborted();
      const tex = make(raster);
      if (tex) {
        tex.flipY = false;
        tex.unpackAlignment = 1;
        tex.colorSpace = NoColorSpace;
        tex.needsUpdate = true;
        dropDataOnUpload(tex);
        uploadNow(tex, renderer);
      }
      return tex;
    }, signal);
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    return null;
  }
}

/**
 * The sky-view raster as a RED texture, LINEAR + mipmapped (a soft field).
 * See `loadLightRaster`.
 */
export function loadSkyViewTexture(
  url: string,
  signal?: AbortSignal,
  renderer?: WebGPURenderer
): Promise<Texture | null> {
  return loadLightRaster(
    url,
    (raster) => {
      const tex = new DataTexture(
        raster.data,
        raster.width,
        raster.height,
        RedFormat,
        UnsignedByteType
      );
      tex.magFilter = LinearFilter;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      trackTexture(tex, textureBytes(raster.width, raster.height, 1, true));
      return tex;
    },
    renderer,
    signal
  );
}

/**
 * The horizon raster as an 8-layer RGBA array texture (the far band's four
 * planes, then the near band's): the PNG is the planes stacked
 * north-to-south, each n rows of n RGBA texels with the bytes interleaved —
 * exactly a DataArrayTexture's layer-major layout. LINEAR (the angles
 * interpolate), no mipmaps. Absent, or an older one-band raster → null.
 */
export function loadHorizonTexture(
  url: string,
  signal?: AbortSignal,
  renderer?: WebGPURenderer
): Promise<DataArrayTexture | null> {
  return loadLightRaster(
    url,
    (raster) => {
      const n = raster.width / 4;
      if (raster.height !== n * HORIZON_TEXTURE_LAYERS) {
        return null;
      }
      const tex = new DataArrayTexture(
        raster.data,
        n,
        n,
        HORIZON_TEXTURE_LAYERS
      );
      tex.format = RGBAFormat;
      tex.type = UnsignedByteType;
      tex.magFilter = LinearFilter;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
      trackTexture(tex, textureBytes(n, n * HORIZON_TEXTURE_LAYERS, 4, false));
      return tex;
    },
    renderer,
    signal
  );
}
