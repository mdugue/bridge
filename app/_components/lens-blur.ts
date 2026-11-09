import type { RenderTarget, Texture, UniformNode, Vector2 } from "three/webgpu";
import {
  clamp,
  float,
  Fn,
  max,
  min,
  mix,
  rtt,
  smoothstep,
  step,
  texture,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { F, Live, V2, V4 } from "./shader-chunks";
import type { ViewLens } from "./view-lens";

/**
 * The depth of field (desktop only; ADR 0047): each pixel blurred by its
 * own circle of confusion, a thin lens's (lib/city/lens.ts) — behind the
 * focus and before it — gathered at half resolution and laid over the
 * sharp frame where it is wider than a pixel.
 *
 * 1. The frame, copied (`input`; the motion blur draws into it while the
 *    lens rests), and at half resolution with each pixel's signed blur in
 *    alpha — of the nearest of its four depths, so a near edge keeps its
 *    blur (`prefilter`).
 * 2. The widest near blur in each 8 px tile, then in the tiles around it as
 *    far as the widest circle reaches (`tiles`, `reach`): how far a pixel
 *    must look for a blurred foreground that covers it.
 * 3. The gather: `TAPS` reads on a disc as wide as that, each counted where
 *    its own circle reaches the pixel. What lies behind may not reach
 *    farther than twice the pixel's own circle (a sharp edge does not take
 *    the blurred background's colour); what lies in front covers the pixel
 *    by its area over its circle's — the share of the lens a blurred
 *    foreground hides — and is laid over the rest.
 * 4. The composite at full resolution: the gather where the pixel's own
 *    circle is wider than a pixel or a foreground covers it, the sharp
 *    frame elsewhere.
 *
 * Three's `DepthOfFieldNode` drew this before: it mixes its blur in by the
 * circle's share of its widest, so a circle a fifth as wide as the widest
 * showed two fifths blurred over three fifths sharp — a near blur wide
 * enough to read left the background half sharp. Here a circle is drawn
 * as wide as the lens makes it, and fully.
 */

/** Reads per gathered pixel. */
const TAPS = 48;
/** Vogel's spiral: the golden angle. */
const GOLDEN = 2.39996323;
/** Full-resolution pixels a tile spans. */
const TILE = 8;
/** Tiles the reach looks out each way: the widest circle's radius (1.25 %
 *  of the frame's height) over a tile, on frames up to 2880 px tall. */
const REACH_TILES = 4;

export interface LensBlurInputs {
  /** focus distance (m) */
  focus: Live;
  /** the blur's diameter at the horizon (px), faded in */
  horizonPx: Live;
  /** the widest blur drawn (px, diameter) */
  capPx: Live;
  /** one full-resolution pixel in uv */
  pixel: UniformNode<"vec2", Vector2>;
}

export interface LensBlur {
  /** the frame with its depth of field, at the pixel */
  focused: V4;
  /** the target the composite is drawn into, each frame it runs */
  composite: Texture;
  /** the frame copy it blurs, idle while it does not run */
  input: RenderTarget;
  dispose: () => void;
}

/** The signed blur (px, diameter; negative before the focus) at `at`. */
function blurAt(depth: Texture, lens: ViewLens, u: LensBlurInputs, at: V2): F {
  const ahead = lens.distance(texture(depth, at).r).max(1e-3);
  const c = u.horizonPx.mul(float(1).sub(u.focus.div(ahead)));
  return clamp(c, u.capPx.negate(), u.capPx);
}

export function createLensBlur(
  lit: V4,
  depth: Texture,
  lens: ViewLens,
  u: LensBlurInputs
): LensBlur {
  const half = { depthBuffer: false, resolutionScale: 0.5 };
  const tile = { depthBuffer: false, resolutionScale: 1 / TILE };

  const input = rtt(lit, null, null, { depthBuffer: false });

  // 1. half resolution, the blur of the nearest of the four depths in alpha
  const prefilter = rtt(
    Fn(() => {
      const at = uv();
      const o = u.pixel.mul(0.5);
      const corners = [
        vec2(o.x.negate(), o.y.negate()),
        vec2(o.x, o.y.negate()),
        vec2(o.x.negate(), o.y),
        vec2(o.x, o.y),
      ];
      // the blur grows with depth: the least is the nearest's
      let c: F = float(1e4);
      for (const corner of corners) {
        c = min(c, blurAt(depth, lens, u, at.add(corner)));
      }
      return vec4(input.sample(at).rgb, c);
    })(),
    null,
    null,
    half
  );

  // 2. the widest near circle's radius in each tile, then around it
  const tiles = rtt(
    Fn(() => {
      const at = uv();
      let near: F = float(0);
      for (let y = 0; y < TILE / 2; y += 1) {
        for (let x = 0; x < TILE / 2; x += 1) {
          const step2 = vec2((x - 1.5) * 2, (y - 1.5) * 2).mul(u.pixel);
          near = max(near, prefilter.sample(at.add(step2)).a.negate());
        }
      }
      return vec4(near.mul(0.5), 0, 0, 1);
    })(),
    null,
    null,
    tile
  );
  const reach = rtt(
    Fn(() => {
      const at = uv();
      let near: F = float(0);
      for (let y = -REACH_TILES; y <= REACH_TILES; y += 1) {
        for (let x = -REACH_TILES; x <= REACH_TILES; x += 1) {
          const off = vec2(x * TILE, y * TILE).mul(u.pixel);
          near = max(near, tiles.sample(at.add(off)).r);
        }
      }
      return vec4(near, 0, 0, 1);
    })(),
    null,
    null,
    tile
  );

  // 3. the gather
  const gather = rtt(
    Fn(() => {
      const at = uv();
      const centre = prefilter.sample(at).toVar();
      const cC = centre.a.toVar();
      const rC = cC.abs().mul(0.5).toVar();
      // how far to look: the pixel's own circle, or a foreground's
      const radius = max(rC, reach.sample(at).r)
        .min(u.capPx.mul(0.5))
        .max(0.5)
        .toVar();
      // a tap's circle reaches the pixel over this soft edge (px)
      const edge = max(float(0.5), radius.mul(0.15)).toVar();
      // the area each tap stands for, over π
      const share = radius.mul(radius).div(TAPS).toVar();
      const back = centre.rgb.toVar();
      const backW = float(1).toVar();
      const front = vec3(0).toVar();
      const frontW = float(0).toVar();
      for (let i = 0; i < TAPS; i += 1) {
        const r = Math.sqrt((i + 0.5) / TAPS);
        const a = i * GOLDEN;
        const s = prefilter
          .sample(
            at.add(
              vec2(r * Math.cos(a), r * Math.sin(a))
                .mul(radius)
                .mul(u.pixel)
            )
          )
          .toVar();
        const rs = s.a.abs().mul(0.5);
        // behind the pixel (the blur grows with depth): no farther than
        // twice the pixel's own circle
        const behind = step(cC, s.a);
        const own = mix(rs, min(rs, rC.mul(2)), behind).toVar();
        const reaches = clamp(
          own.sub(radius.mul(r)).div(edge.mul(2)).add(0.5),
          0,
          1
        ).toVar();
        // in front of the pixel by more than a pixel's blur
        const ahead = float(1).sub(step(cC.sub(1), s.a));
        back.addAssign(s.rgb.mul(reaches.mul(float(1).sub(ahead))));
        backW.addAssign(reaches.mul(float(1).sub(ahead)));
        const covers = reaches
          .mul(ahead)
          .mul(min(float(1), share.div(max(own.mul(own), 1e-3))))
          .toVar();
        front.addAssign(s.rgb.mul(covers));
        frontW.addAssign(covers);
      }
      const behindColour = back.div(backW);
      const frontColour = front.div(max(frontW, 1e-4));
      const covered = clamp(frontW, 0, 1);
      return vec4(mix(behindColour, frontColour, covered), covered);
    })(),
    null,
    null,
    half
  );

  // 4. the composite
  const composite = rtt(
    Fn(() => {
      const at = uv();
      const sharp = input.sample(at);
      const blurred = gather.sample(at);
      const own = blurAt(depth, lens, u, at).abs().mul(0.5);
      const w = max(smoothstep(0.25, 0.75, own), blurred.a);
      return vec4(mix(sharp.rgb, blurred.rgb, w), sharp.a);
    })(),
    null,
    null,
    { depthBuffer: false }
  );

  const inputTarget = input.renderTarget;
  const compositeTarget = composite.renderTarget;
  if (!(inputTarget && compositeTarget)) {
    throw new Error("lens blur: a pass has no render target");
  }
  return {
    // reason: an rtt node is a texture node; its vec4 output at the pixel
    focused: composite,
    composite: compositeTarget.texture,
    input: inputTarget,
    dispose: () => {
      for (const node of [input, prefilter, tiles, reach, gather, composite]) {
        node.dispose();
      }
    },
  };
}
