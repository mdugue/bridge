import {
  DataArrayTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  UnsignedByteType,
  Vector2,
} from "three/webgpu";
import type { Texture, UniformNode } from "three/webgpu";
import {
  asin,
  atan,
  clamp,
  degrees,
  float,
  floor,
  fract,
  fwidth,
  length,
  max,
  mix,
  mod,
  normalize,
  radians,
  reflect,
  smoothstep,
  tan,
  vec2,
  vec3,
} from "three/tsl";
import {
  HORIZON_AZIMUTHS,
  HORIZON_LAYERS,
  HORIZON_MAX_DEG,
  HORIZON_TEXTURE_LAYERS,
  NEAR_MAX_DEG,
} from "@/lib/city/skyview";
import type { Slots } from "./material-slots";
import { slotTexture, slotUniform } from "./material-slots";
import { sceneNight } from "./scene-environment";
import { dataXY, hash21 } from "./shader-chunks";
import type { F, V3 } from "./shader-chunks";
import { hzAngle } from "./sky-light";
import { skyReflection } from "./sky-reflection";
import { viewDirection } from "./view-direction";

/**
 * Der Skyline-Spiegel: what a pane or a glass wall mirrors — the street's
 * houses below their skyline, the sky above it — without a second look at
 * the scene.
 *
 * The skyline is the tile's baked horizon (pipeline/bake/skyview.py), which
 * the ground already holds for its far shadows: per 8 m texel, the
 * elevation of what stands 8–80 m out (the near band) and 80 m–10 km out
 * (the far band) in 16 azimuths. The clay reads it a few metres out of the
 * wall, where the street's ground sees what the facade sees, and asks it
 * in the mirrored direction: below the skyline the mirror shows a house,
 * above it the sky (sky-reflection.ts). Seen from a storey up, the near
 * band's skyline stands lower, as an occluder `NEAR_M` off would.
 *
 * The house in the mirror is a stand-in, not the one across the street:
 * the sky's own colour at the horizon, toned as a clay wall that faces the
 * mirror (lit where the sun stands behind the mirror, in shade where it
 * stands in front of it), with rows and axes of windows on it, and the far
 * band's houses hazed into the sky. Its windows fade into the wall's mean
 * where they would alias. After dark the house is the night sky's dark,
 * and a few of its windows are lit.
 *
 * It costs four reads of a raster every loaded tile holds (no byte more on
 * any device, ADR 0047); until a tile's horizon lands its clay reads a
 * texel of "no skyline" and mirrors the sky alone, as before.
 */

/** How far off (m) the near band's skyline is taken to stand: a street's
 *  width — it lowers the skyline seen from a storey up. */
export const NEAR_M = 22;
/** How far out of the wall (m) the skyline is read: past the footprint's
 *  edge, where the street's ground sees what the facade sees. */
export const MIRROR_OFFSET_M = 4;
/** A storey and an axis of the mirrored house's windows (m). */
export const MIRROR_WINDOW = { storey: 3.3, axis: 2.8 } as const;
/** The mirrored house's tone against the sky at the horizon: in the sun,
 *  in shade, its windows' share of that. */
export const MIRROR_TONE = { lit: 0.85, shade: 0.42, window: 0.8 } as const;
/** How much of the far band's skyline hazes into the sky. */
export const MIRROR_FAR_HAZE = 0.55;

const AZ_STEP = 360 / HORIZON_AZIMUTHS;

export interface CityMirror {
  /** The mirror at the fragment: world normal `n` (the facet's), `h` the
   *  fragment's height over its ground (m). */
  at: (n: V3, h: F) => MirrorSeen;
}

export interface MirrorSeen {
  /** What it shows (linear radiance, before any Fresnel weight), the sky
   *  blurred by `roughness`. */
  colour: (roughness: F | number) => V3;
  /** The same as a tone of the sky (1 where it shows the sky, the house's
   *  tone below the skyline) — for a pane whose sky is a fixed colour of
   *  its own (clay-windows.ts `PANE_SKY_RGB`). */
  tone: V3;
}

interface Seen {
  /** 1 where the mirrored ray meets a house */
  house: F;
  /** the house's tone against the sky at the horizon */
  tone: V3;
}

/**
 * The clay's skyline mirror for the graph every building tile shares: its
 * raster is a slot (`clayHorizon`), its corner and extent the sky view's
 * (`clayOrigin`, `claySize`, sky-light.ts) — the two rasters cover the
 * same tile.
 */
export function createCityMirror(sun: V3): CityMirror {
  const horizon = slotTexture("clayHorizon", noSkylineTexture());
  // reason: a Vector2 slot is a vec2 uniform; slotUniform types it loosely.
  const origin = slotUniform(
    "clayOrigin",
    new Vector2(0, 0)
  ) as unknown as UniformNode<"vec2", Vector2>;
  const size = slotUniform(
    "claySize",
    new Vector2(1, 1)
  ) as unknown as UniformNode<"vec2", Vector2>;

  const seen = (n: V3, h: F): Seen => {
    const r = reflect(viewDirection(), n).toVar();
    // world (x, y, z) = data (x, −z, y): azimuth clockwise from north
    const az = mod(degrees(atan(r.x, r.z.negate())).add(360), 360);
    const el = degrees(asin(clamp(r.y, -1, 1)));
    // read where the street's ground stands in front of the wall
    const flat = vec2(n.x, n.z.negate());
    const out = flat.div(max(length(flat), 1e-3));
    const p = dataXY().add(out.mul(MIRROR_OFFSET_M));
    const uv = vec2(
      p.x.sub(origin.x).div(size.x),
      origin.y.sub(p.y).div(size.y)
    );
    const f = az.div(AZ_STEP);
    const k0 = mod(floor(f), HORIZON_AZIMUTHS);
    const k1 = mod(k0.add(1), HORIZON_AZIMUTHS);
    const t = fract(f);
    const near = mix(
      hzAngle(horizon, uv, k0, HORIZON_LAYERS, NEAR_MAX_DEG),
      hzAngle(horizon, uv, k1, HORIZON_LAYERS, NEAR_MAX_DEG),
      t
    );
    const far = mix(
      hzAngle(horizon, uv, k0, 0, HORIZON_MAX_DEG),
      hzAngle(horizon, uv, k1, 0, HORIZON_MAX_DEG),
      t
    );
    // seen from `h` up, the near skyline stands lower (none under 0°:
    // a skyline of 0 is open land)
    const nearUp = degrees(
      atan(tan(radians(near.min(89))).sub(h.div(NEAR_M)), float(1))
    ).mul(smoothstep(0.2, 1, near));
    const line = max(nearUp, far);
    const soft = fwidth(el).add(0.35);
    const house = float(1).sub(smoothstep(line.sub(soft), line.add(soft), el));
    // the far band's houses: further off, hazed into the sky
    const isFar = smoothstep(nearUp.sub(0.5), nearUp.add(0.5), far);
    // the house faces the mirror: lit when the sun stands behind the mirror
    const facing = normalize(
      vec3(r.x, 0, r.z)
        .negate()
        .add(vec3(0, 1e-4, 0))
    );
    const lit = smoothstep(-0.05, 0.25, facing.dot(sun)).mul(
      float(1).sub(sceneNight)
    );
    const wallTone = mix(MIRROR_TONE.shade, MIRROR_TONE.lit, lit);
    // its windows: rows up the house where the ray meets it, axes round
    // the mirror (a near house `NEAR_M` off), faded where they alias
    const hitH = h.add(tan(radians(el.clamp(-60, 60))).mul(NEAR_M));
    const along = radians(az).mul(NEAR_M);
    const row = hitH.div(MIRROR_WINDOW.storey);
    const axis = along.div(MIRROR_WINDOW.axis);
    // soft-edged: a reflection off a pane is never as crisp as the wall
    const inRow = smoothstep(0.2, 0.45, fract(row)).mul(
      float(1).sub(smoothstep(0.7, 0.92, fract(row)))
    );
    const inAxis = smoothstep(0.15, 0.4, fract(axis)).mul(
      float(1).sub(smoothstep(0.6, 0.85, fract(axis)))
    );
    const sharp = float(1).sub(
      smoothstep(0.25, 0.6, max(fwidth(row), fwidth(axis)))
    );
    // under its mean where too fine: a window is about a fifth of the wall
    const pane = mix(float(0.2), inRow.mul(inAxis), sharp).mul(
      float(1).sub(isFar)
    );
    const dayTone = mix(wallTone, wallTone.mul(MIRROR_TONE.window), pane);
    // after dark: a few of its windows lit, warm
    const cell = vec2(floor(row), floor(axis));
    const litWindow = smoothstep(0.72, 0.74, hash21(cell))
      .mul(inRow.mul(inAxis).mul(sharp))
      .mul(float(1).sub(isFar))
      .mul(sceneNight);
    const tone = vec3(dayTone)
      .mul(mix(float(1), float(MIRROR_FAR_HAZE).add(0.3), isFar))
      .add(vec3(1.6, 1.15, 0.6).mul(litWindow));
    return {
      house: house.mul(mix(float(1), MIRROR_FAR_HAZE, isFar)).toVar(),
      tone: tone.toVar(),
    };
  };

  return {
    at: (n, h) => {
      const s = seen(n, h);
      return {
        colour: (roughness) => {
          const sky = skyReflection(n, roughness);
          // the house takes the sky's colour at the horizon behind it
          const r = reflect(viewDirection(), n);
          const atHorizon = skyReflection(normalize(vec3(r.x, 0.02, r.z)), 0.6);
          return mix(sky, atHorizon.mul(s.tone), s.house);
        },
        tone: mix(vec3(1), s.tone, s.house),
      };
    },
  };
}

/**
 * A tile's horizon as its clay's slots — the raster only: its corner and
 * extent are the sky view's (`claySkySlots`), the same tile's.
 */
export const clayHorizonSlots = (
  raster: Texture,
  origin: [number, number],
  size: [number, number]
): Slots => ({
  clayHorizon: raster,
  clayOrigin: new Vector2(...origin),
  claySize: new Vector2(...size),
});

let noSkyline: DataArrayTexture | null = null;

/**
 * The 1×1 horizon "nothing stands round" (every angle 0) a clay tile binds
 * until its tile's horizon lands — of the raster's kind (RGBA8 layers,
 * LINEAR), so the swap keeps the graph's bindings. Never disposed: one
 * texel per layer, shared by every app.
 */
export function noSkylineTexture(): DataArrayTexture {
  if (!noSkyline) {
    const tex = new DataArrayTexture(
      new Uint8Array(4 * HORIZON_TEXTURE_LAYERS),
      1,
      1,
      HORIZON_TEXTURE_LAYERS
    );
    tex.format = RGBAFormat;
    tex.type = UnsignedByteType;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearFilter;
    tex.colorSpace = NoColorSpace;
    tex.flipY = false;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    noSkyline = tex;
  }
  return noSkyline;
}
