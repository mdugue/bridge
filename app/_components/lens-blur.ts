import { NearestFilter, Vector2 } from "three/webgpu";
import type { RenderTarget, Texture } from "three/webgpu";
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
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { maxBlurPx } from "@/lib/city/lens";
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
 *    foreground hides — and is laid over the rest. A pixel blurred before
 *    the focus counts its own layer as that foreground, so at its edge
 *    what lies behind shows through.
 * 4. The composite at full resolution: the gather where the pixel's own
 *    circle is wider than about 4 px or a foreground covers it, the sharp
 *    frame below a pixel, the two mixed between.
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
/** The tallest frame the reach covers (px): a 5K screen's. A taller one
 *  draws the blur no wider than here (post-stack.ts caps it). */
export const LENS_TALLEST_PX = 2880;
/** Tiles the reach looks out each way: the widest circle's radius there,
 *  and a tile more for where in their tiles the two pixels lie. */
const REACH_TILES = Math.ceil((maxBlurPx(LENS_TALLEST_PX) / 2 + TILE) / TILE);
/** The composite's four gather texels around a pixel. */
const CORNERS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
] as const;

export interface LensBlurInputs {
  /** focus distance (m) */
  focus: Live;
  /** the blur's diameter at the horizon (px), faded in */
  horizonPx: Live;
  /** the widest blur drawn (px, diameter) */
  capPx: Live;
}

export interface LensBlur {
  /** the frame with its depth of field, at the pixel */
  focused: V4;
  /** the target the composite is drawn into, each frame it runs */
  composite: Texture;
  /** the frame copy it blurs, idle while it does not run */
  input: RenderTarget;
  /** Follows the drawing buffer: the copy (the motion blur draws there
   *  while the lens rests) and a pixel's size in uv. */
  setSize: (width: number, height: number) => void;
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
  // the half-resolution and tile targets are sized by `setSize`, never
  // to nothing (three's own scale floors a 7 px wide frame's tiles to 0)
  const small = { depthBuffer: false };
  // a full-resolution pixel and a half-resolution texel, in uv
  const pixel = uniform(new Vector2(1, 1));
  const halfTexel = uniform(new Vector2(1, 1));

  const input = rtt(lit, null, null, { depthBuffer: false });

  // 1. half resolution, the blur of the nearest of the four depths in alpha
  const prefilter = rtt(
    Fn(() => {
      const at = uv();
      const o = pixel.mul(0.5);
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
    1,
    1,
    small
  );
  // read texel by texel: a blur interpolated across a depth edge is one no
  // pixel has (a sharp post's edge read as half the background's blur,
  // and laid over it as a foreground)
  prefilter.value.minFilter = NearestFilter;
  prefilter.value.magFilter = NearestFilter;

  // 2. the widest near circle's radius in each tile, then around it
  const tiles = rtt(
    Fn(() => {
      const at = uv();
      let near: F = float(0);
      for (let y = 0; y < TILE / 2; y += 1) {
        for (let x = 0; x < TILE / 2; x += 1) {
          const step2 = vec2((x - 1.5) * 2, (y - 1.5) * 2).mul(pixel);
          near = max(near, prefilter.sample(at.add(step2)).a.negate());
        }
      }
      return vec4(near.mul(0.5), 0, 0, 1);
    })(),
    1,
    1,
    small
  );
  const reach = rtt(
    Fn(() => {
      const at = uv();
      let near: F = float(0);
      for (let y = -REACH_TILES; y <= REACH_TILES; y += 1) {
        for (let x = -REACH_TILES; x <= REACH_TILES; x += 1) {
          const off = vec2(x * TILE, y * TILE).mul(pixel);
          const { r } = tiles.sample(at.add(off));
          // only as far as its circle reaches: the nearest two pixels of
          // tiles this many apart lie a tile less apart
          const apart = (Math.max(Math.abs(x), Math.abs(y)) - 1) * TILE;
          near = apart > 0 ? max(near, r.mul(step(apart, r))) : max(near, r);
        }
      }
      return vec4(near, 0, 0, 1);
    })(),
    1,
    1,
    small
  );

  // texel by texel too: a tile's reach blended with its neighbours' (0
  // past the dilation) fell short where a near blur's rim ends, cutting it
  // in tile steps
  for (const node of [tiles, reach]) {
    node.value.minFilter = NearestFilter;
    node.value.magFilter = NearestFilter;
  }

  // 3. the gather
  const gather = rtt(
    Fn(() => {
      const at = uv();
      const centre = prefilter.sample(at).toVar();
      const cC = centre.a.toVar();
      const rC = cC.abs().mul(0.5).toVar();
      // how far to look: the pixel's own circle, or a foreground's
      // (a seventh past the own circle: its soft rim, ±0.15 of it, is
      // sampled whole, so a surface at one depth covers itself fully)
      const radius = max(rC.mul(1.15), reach.sample(at).r)
        .min(u.capPx.mul(0.575))
        .max(0.5)
        .toVar();
      // the area each tap stands for, over π
      const share = radius.mul(radius).div(TAPS).toVar();
      // a pixel itself blurred before the focus is a foreground's own:
      // its layer (what lies as near or nearer) covers it by the share of
      // the lens it fills, and what lies behind shows through the rest —
      // at a near blur's silhouette, half — as a lens sees past an edge
      const selfFront = smoothstep(1, 3, cC.negate()).toVar();
      const backW = mix(float(1), float(1e-3), selfFront).toVar();
      const back = centre.rgb.mul(backW).toVar();
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
                .mul(pixel)
            )
          )
          .toVar();
        const rs = s.a.abs().mul(0.5);
        // behind the pixel (the blur grows with depth): no farther than
        // twice the pixel's own circle
        const behind = step(cC, s.a);
        const own = mix(rs, min(rs, rC.mul(2)), behind).toVar();
        // its circle reaches the pixel over a soft edge 0.3 of its radius
        // wide (px, ±0.15): its own, so a wide search fringes no narrow
        // circle
        const edge = max(float(0.5), own.mul(0.15));
        const reaches = clamp(
          own.sub(radius.mul(r)).div(edge.mul(2)).add(0.5),
          0,
          1
        ).toVar();
        // in front of the pixel by more than a pixel's blur; for a near
        // blur's own pixel, its layer: as near, within a pixel's blur
        const ahead = mix(
          float(1).sub(step(cC.sub(1), s.a)),
          float(1).sub(step(cC.add(1), s.a)),
          selfFront
        ).toVar();
        // what lies behind: where its circle reaches the pixel, or for a
        // near blur's own pixel, all of it within the pixel's own circle
        // (it shows through where the foreground's circles leave the lens
        // open; a wider search for a nearer foreground looks past it)
        const inOwn = clamp(rC.sub(radius.mul(r)).add(0.5), 0, 1);
        const fill = mix(reaches, inOwn, selfFront)
          .mul(float(1).sub(ahead))
          .toVar();
        back.addAssign(s.rgb.mul(fill));
        backW.addAssign(fill);
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
    1,
    1,
    small
  );

  // 4. the composite: the gather's four texels around the pixel, each by
  // its bilinear share, a texel nearer than the pixel held off by how
  // much — a pixel behind a sharp silhouette takes none of its colour —
  // and the frame's own detail kept by the share
  // the pixel's circle and a foreground leave sharp: the gather holds
  // behind · (1 − covered) + front · covered, and its "behind" is, for a
  // pixel this sharp, the half-resolution frame
  const composite = rtt(
    Fn(() => {
      const at = uv();
      const sharp = input.sample(at);
      const c = blurAt(depth, lens, u, at).toVar();
      const p = at.div(halfTexel).sub(0.5);
      const base = p.floor().toVar();
      const f = p.sub(base).toVar();
      const weight = float(0).toVar();
      const gathered = vec4(0).toVar();
      const low = vec3(0).toVar();
      // the half-resolution path (its 2 × 2 prefilter, the upsample) is
      // itself about a 3 px blur: a circle under that keeps the frame's
      // detail in part, so a slight blur is not drawn wider than it is
      const ownW = smoothstep(0.5, 2, c.abs().mul(0.5)).toVar();
      for (const [x, y] of CORNERS) {
        const texel = base.add(vec2(x + 0.5, y + 0.5)).mul(halfTexel);
        const g = gather.sample(texel);
        const pre = prefilter.sample(texel).toVar();
        const share = (x ? f.x : f.x.oneMinus()).mul(y ? f.y : f.y.oneMinus());
        // a texel apart in blur by more than half a pixel's is held off:
        // a nearer one always, a farther one only from a pixel that keeps
        // its detail — a sharp silhouette takes no blurred background
        // (nor its blur's residue on its detail), while a blurred edge's
        // own pixels take the texels behind them, whose gather the edge
        // already covers (weighing both ways drew it in half-resolution
        // steps). Never quite nothing: four texels all far off in blur
        // still average by their shares instead of darkening the pixel.
        const apart = max(c.sub(pre.a).sub(0.5), 0).add(
          max(pre.a.sub(c).sub(0.5), 0).mul(ownW.oneMinus())
        );
        const near = float(1).div(apart.mul(apart).add(1)).add(1e-6);
        const w = share.mul(near).toVar();
        weight.addAssign(w);
        gathered.addAssign(g.mul(w));
        low.addAssign(pre.rgb.mul(w));
      }
      const norm = max(weight, 1e-8);
      const blurred = gathered.div(norm).toVar();
      const keep = ownW.oneMinus().mul(blurred.a.oneMinus());
      const detail = sharp.rgb.sub(low.div(norm)).mul(keep);
      return vec4(blurred.rgb.add(detail), sharp.a);
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
    focused: composite,
    composite: compositeTarget.texture,
    input: inputTarget,
    setSize: (width, height) => {
      inputTarget.setSize(width, height);
      pixel.value.set(1 / width, 1 / height);
      // rounded up: a target a texel short would step its texels a
      // fraction wider than 2 (and the tiles' wider than 8) px, and skip a
      // row of the frame where the fractions add up to one
      const halfW = Math.max(Math.ceil(width / 2), 1);
      const halfH = Math.max(Math.ceil(height / 2), 1);
      prefilter.setSize(halfW, halfH);
      gather.setSize(halfW, halfH);
      halfTexel.value.set(1 / halfW, 1 / halfH);
      const tileW = Math.max(Math.ceil(width / TILE), 1);
      const tileH = Math.max(Math.ceil(height / TILE), 1);
      tiles.setSize(tileW, tileH);
      reach.setSize(tileW, tileH);
    },
    dispose: () => {
      for (const node of [input, prefilter, tiles, reach, gather, composite]) {
        node.dispose();
      }
    },
  };
}
