import type {
  Texture,
  TextureNode,
  Vector2,
  Node,
  UniformNode,
} from "three/webgpu";
import {
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  int,
  ivec2,
  mix,
  positionWorld,
  smoothstep,
  texture,
  textureLoad,
  textureSize,
  vec2,
  vec3,
} from "three/tsl";

/**
 * The TSL pieces every layer's node material shares: the data frame, and
 * the helpers the chunks compute with (a raster's texels, the hashes and
 * the noise).
 *
 * The data frame (x east, y north, z up, recentered) comes from world
 * space, never from `position`: the streamed glTF positions are quantised
 * with the dequantisation on the node, and the viewer's `world` group only
 * rotates −90° about X, so world (x, y, z) is data (x, −z, y) exactly — the
 * same expression on the Z-up tiles and the Y-up dressing.
 */

export type F = Node<"float">;
export type I = Node<"int">;
export type V2 = Node<"vec2">;
export type V3 = Node<"vec3">;
export type V4 = Node<"vec4">;
export type I2 = Node<"ivec2">;

/** A float uniform the look (or the sun rig) writes; `.value` is live. */
export type Live = UniformNode<"float", number>;

/** The fragment's (or vertex's) data-frame XY: world (x, −z). */
export const dataXY = (): V2 => vec2(positionWorld.x, positionWorld.z.negate());

/** The data-frame position: world (x, −z, y). */
export const dataPosition = (): V3 =>
  vec3(positionWorld.x, positionWorld.z.negate(), positionWorld.y);

/**
 * A tile raster's uv at data-frame `xy` (v grows southward). The corner is
 * a uniform, not a constant: every tile then builds the same shader (the
 * tiles share their size), and a tile flown into reuses the pipeline the
 * first one built.
 */
export function rasterUv(
  xy: V2,
  origin: UniformNode<"vec2", Vector2>,
  size: [number, number]
): V2 {
  return vec2(xy.x.sub(origin.x).div(size[0]), origin.y.sub(xy.y).div(size[1]));
}

/** A texture's pixel size. */
export const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};

/**
 * A texture a chunk samples: the texture itself, or a node standing for it
 * (a slot of a graph shared by every tile, material-slots.ts) — TSL's
 * `texture()` and `textureLoad()` take either.
 */
export type Tex = Texture | TextureNode;

// --- what the chunks compute with ---------------------------------------------

/** GLSL's `mod`: floored, so negative values wrap like the bake's. */
export const floorMod = (x: F, y: F | number): F =>
  x.sub(floor(x.div(y)).mul(y));

/** A raster's size in texels (level 0). */
export const texelSize = (t: Tex, uv: V2): I2 =>
  // reason: TextureSizeNode is typed as a bare Node; it is a uvec2.
  ivec2(textureSize(texture(t, uv), int(0)) as unknown as Node<"uvec2">);

// reason: TSL's clamp runs on integer vectors (WGSL clamp on vec2<i32>),
// but its typings only cover float ones.
const clampI2 = clamp as unknown as (x: I2, lo: I2, hi: I2) => I2;

/** The texel at `p`, clamped into the raster (`size` from `texelSize`). */
export const texelAt = (t: Tex, p: I2, size: I2): V4 =>
  textureLoad(t, clampI2(p, ivec2(0, 0), size.sub(ivec2(1, 1))));

/** The texel at `p` of a table texture (the row lookups: always inside). */
export const loadTexel = (t: Tex, p: I2): V4 => textureLoad(t, p);

/** A byte of a UNORM8 channel as a float 0..255 (rounded). */
export const byteOf = (v: F): F => floor(v.mul(255).add(0.5));

// The helpers every chunk calls many times are shader functions (a layout
// each), not inlined node trees: inlined, the ~100 hash calls of the ground,
// garden and pitch terms blew the fragment shader up several times over.

/** Hash without sin (stable at large coordinates), Dave Hoskins' hash12. */
export const gdHash = Fn(
  ([p]: [V2]): F => {
    const a = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
    a.addAssign(dot(a, a.yzx.add(33.33)));
    return fract(a.x.add(a.y).mul(a.z));
  },
  { p: "vec2", return: "float" }
);

/** Value noise on the hash. */
export const gdNoise = Fn(
  ([p]: [V2]): F => {
    const i = floor(p).toVar();
    const f0 = fract(p).toVar();
    const f = f0
      .mul(f0)
      .mul(vec2(3).sub(f0.mul(2)))
      .toVar();
    return mix(
      mix(gdHash(i), gdHash(i.add(vec2(1, 0))), f.x),
      mix(gdHash(i.add(vec2(0, 1))), gdHash(i.add(vec2(1, 1))), f.x),
      f.y
    );
  },
  { p: "vec2", return: "float" }
);

/** `gdNoise`'s gradient at `p` (per unit of `p`), analytic: its four
 *  corner hashes once, not a noise read per difference. */
export const gdNoiseSlope = Fn(
  ([p]: [V2]): V2 => {
    const i = floor(p).toVar();
    const f0 = fract(p).toVar();
    const u = f0
      .mul(f0)
      .mul(vec2(3).sub(f0.mul(2)))
      .toVar();
    const du = f0.mul(float(1).sub(f0)).mul(6);
    const a = gdHash(i).toVar();
    const b = gdHash(i.add(vec2(1, 0)))
      .sub(a)
      .toVar();
    const c = gdHash(i.add(vec2(0, 1)))
      .sub(a)
      .toVar();
    const d = gdHash(i.add(vec2(1, 1)))
      .sub(a)
      .sub(b)
      .sub(c);
    return du.mul(vec2(b.add(d.mul(u.y)), c.add(d.mul(u.x))));
  },
  { p: "vec2", return: "vec2" }
);

/** 1 inside [a, b] (m), anti-aliased over w on either edge. */
export const gdBand = Fn(
  ([d, a, b, w]: [F, F, F, F]): F =>
    smoothstep(a.sub(w), a.add(w), d).sub(smoothstep(b.sub(w), b.add(w), d)),
  { d: "float", a: "float", b: "float", w: "float", return: "float" }
);

/** A cheap 2D hash: the paper's grain, the picture styles' noise and dashes. */
export function hash21(p: V2): F {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}
