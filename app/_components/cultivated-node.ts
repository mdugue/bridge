import type { Texture } from "three";
import {
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  If,
  ivec2,
  length,
  max,
  min,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  step,
  texture,
  textureLoad,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "three/webgpu";
import {
  COLONY_AXIS_STEPS,
  COLONY_EDGE_SCALE,
  COLONY_GARDEN as G,
} from "@/lib/city/cultivated";
import { srgbToLinear } from "@/lib/city/landcover";
import {
  type Fields,
  type GroundInputs,
  hash,
  MEADOW_LINEAR,
  type MeadowVars,
  noise,
} from "./ground-detail-node";

/**
 * SPIKE (plan 020): the allotment gardens of cultivated-layer.ts
 * (`COLONY_GARDEN_GLSL`) in TSL, term for term; the GLSL is the source of
 * truth. The edge is read at level 0 and the axis with `textureLoad`, so
 * nothing inside the `If`s takes an implicit derivative; `ctPlot`'s 3×3
 * Voronoi loops are unrolled here.
 */

type F = Node<"float">;
type V2 = Node<"vec2">;
type V3 = Node<"vec3">;

/** The GLSL's `lin`: an sRGB byte triple as linear RGB, to four places. */
const lin = (r: number, g: number, b: number): V3 =>
  vec3(...[r, g, b].map((c) => Number(srgbToLinear(c).toFixed(4))));

const MEADOW = (): V3 => vec3(...MEADOW_LINEAR);
const plotSize = (): V2 => vec2(G.plotAlong, G.plotAcross);

const texSize = (t: Texture): [number, number] => {
  const img = t.image as { height: number; width: number };
  return [img.width, img.height];
};

/** ctLine: coverage of |d| < hw over the footprint [d − w, d + w]. */
function line(d: F, hw: number, w: F): F {
  return max(0, min(d.add(w), hw).sub(max(d.sub(w), -hw))).div(w.mul(2));
}

/** ctCum: the bands' cumulative coverage up to t. */
function cum(t: F, a: number, p: number): F {
  const k = floor(t.div(p));
  return k.mul(a).add(min(t.sub(k.mul(p)), a));
}

/** ctBands: coverage of bands [k p, k p + a) over [x − w, x + w]. */
function bands(x: F, a: number, p: number, w: F): F {
  return cum(x.add(w), a, p)
    .sub(cum(x.sub(w), a, p))
    .div(w.mul(2));
}

/** ctSeed: the plot cell's jittered seed (m, the colony's frame). */
function seed(c: V2): V2 {
  const j = vec2(hash(c), hash(c.add(17.3))).sub(0.5);
  return c.add(0.5).add(j.mul(G.jitter)).mul(plotSize());
}

const NEIGHBOURS: [number, number][] = [];
for (let j = -1; j <= 1; j++) {
  for (let i = -1; i <= 1; i++) {
    NEIGHBOURS.push([i, j]);
  }
}

/**
 * ctPlot: the plot at q (m, the colony's frame) — its cell (xy) and the
 * distance (m) to its border (z); a jittered Voronoi, the border exact.
 */
function plot(q: V2): V3 {
  const c0 = floor(q.div(plotSize())).toVar();
  const best = float(1e9).toVar();
  const bc = vec2(c0).toVar();
  const bp = vec2(0).toVar();
  for (const [i, j] of NEIGHBOURS) {
    const c = c0.add(vec2(i, j)).toVar();
    const p = seed(c).toVar();
    const d = dot(q.sub(p), q.sub(p)).toVar();
    If(d.lessThan(best), () => {
      best.assign(d);
      bc.assign(c);
      bp.assign(p);
    });
  }
  const edge = float(1e9).toVar();
  for (const [i, j] of NEIGHBOURS) {
    if (i === 0 && j === 0) {
      continue;
    }
    const p = seed(bc.add(vec2(i, j))).toVar();
    edge.assign(
      min(edge, dot(bp.add(p).mul(0.5).sub(q), normalize(p.sub(bp))))
    );
  }
  return vec3(bc, edge);
}

interface Plot {
  green: V3;
  inner: F;
  near: F;
  p: V3;
  q: V2;
  w: F;
}

/** Vegetable beds: warm soil rows between green ones, in a patch. */
function beds(pl: Plot, col: V3): void {
  const rows = select(hash(pl.p.xy.add(23.1)).greaterThan(0.5), pl.q.x, pl.q.y);
  const soil = bands(rows, G.bedWidth * 0.55, G.bedWidth, pl.w);
  const patch = smoothstep(
    0.3,
    0.5,
    noise(pl.q.mul(0.16).add(pl.p.xy.mul(3.1)))
  );
  col.assign(
    mix(
      col,
      mix(pl.green.mul(0.95), lin(200, 176, 146), soil),
      pl.inner.mul(patch).mul(0.85)
    )
  );
}

/** Flowers: sparse pastel dots on a jittered grid, a faint blush afar. */
function flowers(pl: Plot, mid: F, col: V3): void {
  const f = pl.q.div(G.flowerSpacing).toVar();
  const fc = floor(f).toVar();
  const fh = hash(fc.add(pl.p.xy.mul(1.7))).toVar();
  const fo = vec2(hash(fc.add(5.1)), hash(fc.add(9.7)))
    .sub(0.5)
    .mul(0.6);
  const fd = length(fract(f).sub(0.5).sub(fo).mul(G.flowerSpacing));
  const spot = float(1)
    .sub(
      smoothstep(
        pl.w.negate().add(G.flowerRadius),
        pl.w.add(G.flowerRadius),
        fd
      )
    )
    .mul(step(0.6, fh));
  const flower = select(
    fh.lessThan(0.75),
    lin(228, 180, 184),
    select(fh.lessThan(0.9), lin(238, 218, 164), lin(198, 186, 218))
  );
  col.assign(mix(col, flower, spot.mul(pl.inner).mul(pl.near).mul(0.8)));
  col.assign(mix(col, lin(228, 180, 184), mid.mul(0.05)));
}

/** Shrubs and fruit bushes: soft darker mottles. */
function shrubs(pl: Plot, col: V3): void {
  const m = smoothstep(0.55, 0.8, noise(pl.q.mul(0.55).add(pl.p.xy.mul(7.3))));
  col.assign(mix(col, pl.green.mul(0.86), m.mul(pl.inner).mul(0.7)));
}

/** One of a few soft greens per plot (ctGreen). */
function plotGreen(h2: F): V3 {
  return select(
    h2.lessThan(0.3),
    mix(MEADOW(), lin(160, 186, 140), 0.5),
    select(
      h2.lessThan(0.6),
      mix(MEADOW(), lin(175, 195, 158), 0.6),
      select(
        h2.lessThan(0.85),
        mix(MEADOW(), lin(210, 211, 160), 0.5),
        MEADOW()
      )
    )
  ).toVar();
}

/** The garden inside the colony: the colour (ctCol) at the fragment. */
function garden(g: GroundInputs, fw: F, axisCode: F, w: F, edge: F): V3 {
  const axis = max(axisCode.sub(1), 0).div(COLONY_AXIS_STEPS).mul(Math.PI);
  const u = vec2(cos(axis), sin(axis)).toVar();
  // the plot borders meander instead of running ruled
  const warp = vec2(noise(g.xy.mul(0.09)), noise(g.xy.mul(0.09).add(5.2)))
    .sub(0.5)
    .mul(G.warp);
  const q = vec2(dot(g.xy, u), dot(g.xy, vec2(u.y.negate(), u.x)))
    .add(warp)
    .toVar();
  const p = plot(q).toVar();
  const h = hash(p.xy.add(3.7)).toVar();
  const near = float(1)
    .sub(smoothstep(0.04, 0.2, fw))
    .toVar(); // flowers
  const mid = float(1)
    .sub(smoothstep(0.6, 2.5, fw))
    .toVar(); // plots, paths, beds
  // one of a few soft greens per plot; from afar the colony's one tone
  const green = plotGreen(hash(p.xy.add(11.9)));
  const col = mix(mix(MEADOW(), lin(175, 195, 158), 0.4), green, mid).toVar();
  // clear of the path between the plots
  const inner = smoothstep(0.8, 1.5, p.z).mul(mid).toVar();
  const pl: Plot = { green, inner, near, p, q, w };
  If(h.lessThan(0.34), () => {
    beds(pl, col);
  })
    .ElseIf(h.lessThan(0.6), () => {
      flowers(pl, mid, col);
    })
    .Else(() => {
      shrubs(pl, col);
    });
  // thin soft paths between the plots, a trodden lawn's colour
  const path = line(p.z, G.pathHalfWidth, w);
  col.assign(mix(col, lin(216, 210, 172), path.mul(mid).mul(0.75)));
  // a faint hedge green just inside the colony's rim
  const hedge = line(edge.sub(1.1), 0.5, w).mul(mid);
  col.assign(mix(col, lin(150, 176, 138), hedge.mul(0.3)));
  return col;
}

/** Paints the allotment gardens into baseCol (vec3 var), as COLONY_GARDEN_GLSL. Call right after the ground detail, before the sports grounds. */
export function colonyGarden(
  g: GroundInputs,
  fd: Fields,
  m: MeadowVars,
  baseCol: Node<"vec3">,
  colonies: { rect: [number, number, number, number]; texture: Texture }
): void {
  const tex = colonies.texture;
  const on = uniform(g.groundDetail.value).onRenderUpdate(
    () => g.groundDetail.value
  );
  const rect = vec4(...colonies.rect);
  const uv = g.uv.sub(rect.xy).div(rect.zw).toVar();
  const inside = uv.x
    .greaterThan(0)
    .and(uv.y.greaterThan(0))
    .and(uv.x.lessThan(1))
    .and(uv.y.lessThan(1));
  const [sw, sh] = texSize(tex);
  If(on.greaterThan(0).and(inside), () => {
    // explicit LOD: implicit derivatives are undefined in non-uniform
    // control flow (the texture has no mips; level 0 is what it read)
    const r = texture(tex, uv).level(float(0)).r.mul(255).toVar();
    // metres inside the garden land's edge (0: farther outside than held)
    const d = select(
      r.greaterThan(0.5),
      r.sub(128).div(COLONY_EDGE_SCALE),
      float(-10)
    );
    const w = max(fd.w, 0.01).toVar();
    // a soft edge that wanders a little, as hedges and fences do
    const edge = d.add(noise(g.xy.mul(0.35)).sub(0.5).mul(0.8)).toVar();
    const into = smoothstep(w.negate().sub(0.3), w.add(0.5), edge).toVar();
    If(into.greaterThan(0), () => {
      const at = ivec2(uv.mul(vec2(sw, sh)));
      const code = floor(
        textureLoad(
          tex,
          // reason: @types/three types clamp for float vectors; WGSL/GLSL
          // clamp takes ivec2 fine (as in ground-detail-node.ts).
          clamp(
            at as never,
            ivec2(0, 0) as never,
            ivec2(sw - 1, sh - 1) as never
          )
        )
          .g.mul(255)
          .add(0.5)
      );
      const col = garden(g, m.fw, code, w, edge);
      const strength = min(on.div(0.7), 1).mul(G.strength);
      baseCol.assign(mix(baseCol, col, into.mul(strength)));
    });
  });
}
