import type { Texture, UniformNode, Vector2 } from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  Fn,
  If,
  max,
  min,
  select,
  smoothstep,
  sqrt,
  step,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { F, V2, V4 } from "./shader-chunks";

/**
 * FXAA over the frame as the post stack holds it — linear, half-float,
 * above 1 in the sun's glow — for the phone's last pass (post-stack.ts,
 * scene-profile.ts `PostProfile`). SMAA needs three full-resolution
 * targets and a copy of the frame to read; this needs none: it runs
 * inside the pass that finishes the frame, on a texture already there.
 *
 * The algorithm is three's FXAANode (examples/jsm/tsl/display, MIT, after
 * Jasper Flick's "FXAA" for Catlike Coding): find where the luma jumps,
 * which way the edge runs, how far along it the jump ends, and shift the
 * sample towards the other side by the share of a pixel that leaves. Two
 * changes. Its luma is perceptual: three's node expects an sRGB frame and
 * its thresholds are tuned to one, so the frame's linear luma goes through
 * a square root (close to the sRGB curve) — fed linear values, it misses
 * the edges in the shade and over-blends the bright ones. And its samples
 * name their level (the frame has no mips): no derivatives inside the
 * branches, on either backend.
 */

/** Steps along an edge, in texels: the first, then the five after it. */
const EDGE_STEPS = [1, 1.5, 2, 2, 2, 4];
/** Where the edge is taken to end when the last step found no end. */
const EDGE_GUESS = 8;
/** Below this luma contrast (or this share of the brightest) no edge. */
const CONTRAST_THRESHOLD = 0.0312;
const RELATIVE_THRESHOLD = 0.063;
/** How much of the sub-pixel blend is used (1 = all). */
const SUBPIXEL_BLENDING = 1;

/**
 * The antialiased colour of `source` at the pass's uv. `texel` is one
 * pixel of it in uv (1 / its size), kept current by the caller.
 */
export function fxaa(source: Texture, texel: UniformNode<"vec2", Vector2>): V4 {
  const sample = (at: V2): V4 => texture(source, at, float(0));
  const luma = (at: V2): F =>
    sqrt(max(dot(sample(at).rgb, vec3(0.3, 0.59, 0.11)), 0));

  return Fn(() => {
    const at = uv();
    const lumaAt = (du: number, dv: number): F =>
      luma(at.add(texel.mul(vec2(du, dv)))).toVar();
    const m = lumaAt(0, 0);
    const n = lumaAt(0, -1);
    const e = lumaAt(1, 0);
    const s = lumaAt(0, 1);
    const w = lumaAt(-1, 0);
    const highest = max(s, e, n, w, m);
    const contrast = highest.sub(min(s, e, n, w, m)).toVar();
    const finalUv = vec2(at).toVar();

    If(
      contrast.greaterThanEqual(
        max(CONTRAST_THRESHOLD, highest.mul(RELATIVE_THRESHOLD))
      ),
      () => {
        // the corners only where there is an edge to place
        const ne = lumaAt(1, -1);
        const nw = lumaAt(-1, -1);
        const se = lumaAt(1, 1);
        const sw = lumaAt(-1, 1);

        // how far the pixel stands out of its neighbourhood
        const average = s
          .add(e)
          .add(n)
          .add(w)
          .mul(2)
          .add(se.add(sw).add(ne).add(nw))
          .div(12);
        const ramp = smoothstep(
          0,
          1,
          clamp(abs(average.sub(m)).div(contrast), 0, 1)
        );
        const pixelBlend = ramp.mul(ramp).mul(SUBPIXEL_BLENDING);

        // which way the edge runs, and to which side of the pixel
        const horizontal = abs(s.add(n).sub(m.mul(2)))
          .mul(2)
          .add(abs(se.add(ne).sub(e.mul(2))))
          .add(abs(sw.add(nw).sub(w.mul(2))));
        const vertical = abs(e.add(w).sub(m.mul(2)))
          .mul(2)
          .add(abs(se.add(sw).sub(s.mul(2))))
          .add(abs(ne.add(nw).sub(n.mul(2))));
        const isHorizontal = horizontal.greaterThanEqual(vertical).toVar();
        const pLuma = select(isHorizontal, s, e);
        const nLuma = select(isHorizontal, n, w);
        const pGradient = abs(pLuma.sub(m));
        const nGradient = abs(nLuma.sub(m));
        const towardN = pGradient.lessThan(nGradient).toVar();
        const pixelStep = select(isHorizontal, texel.y, texel.x)
          .mul(select(towardN, float(-1), float(1)))
          .toVar();
        const edgeLuma = m
          .add(select(towardN, nLuma, pLuma))
          .mul(0.5)
          .toVar();
        const threshold = select(towardN, nGradient, pGradient)
          .mul(0.25)
          .toVar();

        // along the edge both ways, to where the luma leaves it
        const half = pixelStep.mul(0.5);
        const onEdge = select(
          isHorizontal,
          vec2(at.x, at.y.add(half)),
          vec2(at.x.add(half), at.y)
        ).toVar();
        const along = select(
          isHorizontal,
          vec2(texel.x, 0),
          vec2(0, texel.y)
        ).toVar();
        const search = (sign: 1 | -1) => {
          const end = onEdge.add(along.mul(EDGE_STEPS[0] * sign)).toVar();
          const delta = luma(end).sub(edgeLuma).toVar();
          const found = abs(delta).greaterThanEqual(threshold).toVar();
          for (const step of EDGE_STEPS.slice(1)) {
            If(found.not(), () => {
              end.addAssign(along.mul(step * sign));
              delta.assign(luma(end).sub(edgeLuma));
              found.assign(abs(delta).greaterThanEqual(threshold));
            });
          }
          If(found.not(), () => {
            end.addAssign(along.mul(EDGE_GUESS * sign));
          });
          return { end, delta };
        };
        const p = search(1);
        const q = search(-1);
        const pDistance = select(
          isHorizontal,
          p.end.x.sub(at.x),
          p.end.y.sub(at.y)
        ).toVar();
        const qDistance = select(
          isHorizontal,
          at.x.sub(q.end.x),
          at.y.sub(q.end.y)
        ).toVar();
        const pCloser = pDistance.lessThanEqual(qDistance);
        const shortest = select(pCloser, pDistance, qDistance);
        // the end on the pixel's own side of the edge blends nothing (the
        // signs agree: both at or above the edge's luma, or both below)
        const sameSide = step(0, select(pCloser, p.delta, q.delta)).equal(
          step(0, m.sub(edgeLuma))
        );
        const edgeBlend = select(
          sameSide,
          float(0),
          float(0.5).sub(shortest.div(pDistance.add(qDistance)))
        );
        const shift = pixelStep.mul(max(pixelBlend, edgeBlend));
        finalUv.assign(
          select(
            isHorizontal,
            vec2(at.x, at.y.add(shift)),
            vec2(at.x.add(shift), at.y)
          )
        );
      }
    );
    return sample(finalUv);
  })();
}
