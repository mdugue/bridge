import {
  BoxGeometry,
  Color,
  Group,
  MeshStandardNodeMaterial,
  type Node,
  Object3D,
  type Texture,
  type UniformNode,
  type Vector4,
} from "three/webgpu";
import {
  and,
  cos,
  dot,
  float,
  floor,
  fract,
  Fn,
  If,
  ivec2,
  length,
  materialColor,
  max,
  min,
  mix,
  normalize,
  select,
  sin,
  smoothstep,
  step,
  texture,
  vec2,
  vec3,
} from "three/tsl";
import {
  COLONY_AXIS_STEPS,
  COLONY_EDGE_SCALE,
  COLONY_GARDEN as G,
  VINE_ROW,
} from "@/lib/city/cultivated";
import { epsgToWorld, type GroundContext } from "@/lib/city/ground-clamp";
import { srgbToLinear } from "@/lib/city/landcover";
import type { Point2 } from "@/lib/city/polyline";
import {
  byteOf,
  gdHash,
  gdNoise,
  type GroundColour,
  type GroundFields,
  type GroundInputs,
  texelAt,
  texelSize,
} from "./ground-detail";
import { instancePosition, Instances, instanceTint } from "./instancing";
import { hedgePieces } from "./low-vegetation-layer";
import { rmStripes } from "./road-markings";
import type { F, V2, V3 } from "./shader-chunks";
import { spLine } from "./sport-ground";
import { sceneMaterial } from "./three-utils";
import { bucketByCell, hash } from "./vegetation-layer";

/**
 * Cultivated land (pipeline/bake/cultivated.py, lib/city/cultivated.ts,
 * plan 028):
 *
 * - **Allotment colonies** in the terrain's colour node: little gardens
 *   over the class colour. The colony's outline is the baked signed
 *   distance to its garden land (paths, roads and water cut out), sampled
 *   LINEAR and faded over a metre with a slow wobble — a soft, organic
 *   edge, never the raster's staircase. Inside, everything is analytic in
 *   the data frame: plots are the cells of a jittered Voronoi in the
 *   colony's axis frame (≈12 × 17 m), their borders meandering and drawn
 *   as thin soft paths; each plot is a lawn in one of a few soft greens,
 *   a third with warm vegetable beds, some with sparse pastel flower dots,
 *   the rest with darker shrub mottles, and a faint hedge green inside the
 *   colony's rim. Every line and band is box-filtered over the pixel
 *   footprint, and the detail fades with distance to the plots' tones and
 *   then to the colony's one calm tone, so nothing shimmers from the air.
 *   Scales with *Bodendetail*.
 * - **Orchards**: their trees join the street-tree cadastre as the "small"
 *   archetype (tile-stream.ts), so they ride in the tree layer's chunks.
 * - **Vineyards**: each row a chain of low boxes, 1.3 m tall and 0.5 m
 *   wide, in foliage green, chunked into 250 m cells like the hedges.
 */

type I2 = Node<"ivec2">;

/** An sRGB byte triple as a linear colour node. */
const lin = (r: number, g: number, b: number): V3 =>
  vec3(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b));

const PLOT = [G.plotAlong, G.plotAcross] as const;

/** Coverage of |d| < hw over the footprint [d − w, d + w] (as `spLine`). */
const ctLine = spLine;

/** Coverage of bands [k p, k p + a) over [x − w, x + w], exactly. */
const ctBands = rmStripes;

/** A plot cell's seed point (m, the colony's frame): the cell centre
 *  jittered. */
const ctSeed = Fn(
  ([c]: [V2]): V2 => {
    const j = vec2(gdHash(c), gdHash(c.add(17.3))).sub(0.5);
    return c.add(0.5).add(j.mul(G.jitter)).mul(vec2(PLOT[0], PLOT[1]));
  },
  { c: "vec2", return: "vec2" }
);

/**
 * The plot at q (m, the colony's frame): its cell (xy) and the distance
 * (m) to its border (z) — a jittered Voronoi, the border exact. The two
 * 3×3 searches are unrolled.
 */
function ctPlot(q: V2): V3 {
  const c0 = floor(q.div(vec2(PLOT[0], PLOT[1]))).toVar();
  const best = float(1e9).toVar();
  const bc = vec2(c0).toVar();
  const bp = vec2(0).toVar();
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const c = c0.add(vec2(i, j)).toVar();
      const p = ctSeed(c).toVar();
      const e = q.sub(p);
      const d = dot(e, e);
      If(d.lessThan(best), () => {
        best.assign(d);
        bc.assign(c);
        bp.assign(p);
      });
    }
  }
  let edge: F = float(1e9);
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      if (i === 0 && j === 0) {
        continue;
      }
      const p = ctSeed(bc.add(vec2(i, j))).toVar();
      edge = min(edge, dot(bp.add(p).mul(0.5).sub(q), normalize(p.sub(bp))));
    }
  }
  return vec3(bc, edge);
}

/** One plot's garden: beds, flowers or shrubs over its green. */
function plotGarden(
  q: V2,
  plot: V3,
  tones: { col: V3; green: V3; inner: F; mid: F; near: F; w: F }
): void {
  const { col, green, inner, mid, near, w } = tones;
  const h = gdHash(plot.xy.add(3.7)).toVar();
  If(h.lessThan(0.34), () => {
    // vegetable beds: warm soil rows between green ones, in a patch
    const rows = select(gdHash(plot.xy.add(23.1)).greaterThan(0.5), q.x, q.y);
    const soil = ctBands(rows, G.bedWidth * 0.55, G.bedWidth, w);
    const patch = smoothstep(
      0.3,
      0.5,
      gdNoise(q.mul(0.16).add(plot.xy.mul(3.1)))
    );
    col.assign(
      mix(
        col,
        mix(green.mul(0.95), lin(200, 176, 146), soil),
        inner.mul(patch).mul(0.85)
      )
    );
  })
    .ElseIf(h.lessThan(0.6), () => {
      // flowers: sparse pastel dots on a jittered grid, a faint blush afar
      const fq = q.div(G.flowerSpacing).toVar();
      const fc = floor(fq).toVar();
      const fh = gdHash(fc.add(plot.xy.mul(1.7))).toVar();
      const fo = vec2(gdHash(fc.add(5.1)), gdHash(fc.add(9.7)))
        .sub(0.5)
        .mul(0.6);
      const fd = length(fract(fq).sub(0.5).sub(fo).mul(G.flowerSpacing));
      const dot0 = float(1)
        .sub(
          smoothstep(w.negate().add(G.flowerRadius), w.add(G.flowerRadius), fd)
        )
        .mul(step(0.6, fh));
      const flower = select(
        fh.lessThan(0.75),
        lin(228, 180, 184),
        select(fh.lessThan(0.9), lin(238, 218, 164), lin(198, 186, 218))
      );
      col.assign(mix(col, flower, dot0.mul(inner).mul(near).mul(0.8)));
      col.assign(mix(col, lin(228, 180, 184), mid.mul(0.05)));
    })
    .Else(() => {
      // shrubs and fruit bushes: soft darker mottles
      const m = smoothstep(
        0.55,
        0.8,
        gdNoise(q.mul(0.55).add(plot.xy.mul(7.3)))
      );
      col.assign(mix(col, green.mul(0.86), m.mul(inner).mul(0.7)));
    });
}

/** Inside the colony: plots, their gardens, the paths and the rim hedge. */
function colonyPlots(
  inp: GroundInputs,
  colony: { texture: Texture; uv: V2 },
  edge: F,
  w: F
): V3 {
  const size: I2 = texelSize(colony.texture, colony.uv).toVar();
  const code = byteOf(
    texelAt(colony.texture, ivec2(colony.uv.mul(vec2(size))), size).g
  );
  const axis = max(code.sub(1), 0).div(COLONY_AXIS_STEPS).mul(Math.PI);
  const u = vec2(cos(axis), sin(axis)).toVar();
  const q = vec2(dot(inp.xy, u), dot(inp.xy, vec2(u.y.negate(), u.x))).toVar();
  // the plot borders meander instead of running ruled
  q.addAssign(
    vec2(gdNoise(inp.xy.mul(0.09)), gdNoise(inp.xy.mul(0.09).add(5.2)))
      .sub(0.5)
      .mul(G.warp)
  );
  const plot = ctPlot(q).toVar();
  const h2 = gdHash(plot.xy.add(11.9)).toVar();
  const near = float(1)
    .sub(smoothstep(0.04, 0.2, inp.fw))
    .toVar(); // flowers
  const mid = float(1)
    .sub(smoothstep(0.6, 2.5, inp.fw))
    .toVar(); // plots, paths, beds
  // one of a few soft greens per plot; from afar the colony's one tone
  const m = inp.meadowColor;
  const green = select(
    h2.lessThan(0.3),
    mix(m, lin(160, 186, 140), 0.5),
    select(
      h2.lessThan(0.6),
      mix(m, lin(175, 195, 158), 0.6),
      select(h2.lessThan(0.85), mix(m, lin(210, 211, 160), 0.5), m)
    )
  ).toVar();
  const col = mix(mix(m, lin(175, 195, 158), 0.4), green, mid).toVar();
  // clear of the path between the plots
  const inner = smoothstep(0.8, 1.5, plot.z).mul(mid).toVar();
  plotGarden(q, plot, { col, green, inner, mid, near, w });
  // thin soft paths between the plots, a trodden lawn's colour
  const path = ctLine(plot.z, G.pathHalfWidth, w);
  col.assign(mix(col, lin(216, 210, 172), path.mul(mid).mul(0.75)));
  // a faint hedge green just inside the colony's rim
  const hedge = ctLine(edge.sub(1.1), 0.5, w).mul(mid);
  col.assign(mix(col, lin(150, 176, 138), hedge.mul(0.3)));
  return col;
}

/**
 * The gardens (after `groundDetail`; reads the ground fields). `rect` is
 * where the (cropped) raster lies in the tile's uv — a uniform, so every
 * tile builds the same node code.
 */
export function colonyGarden(
  inp: GroundInputs,
  col: GroundColour,
  g: GroundFields,
  colonies: { rect: UniformNode<"vec4", Vector4>; texture: Texture }
): void {
  const { rect } = colonies;
  const uv = inp.uv.sub(rect.xy).div(rect.zw).toVar();
  const inTile = and(
    uv.x.greaterThan(0),
    uv.y.greaterThan(0),
    uv.x.lessThan(1),
    uv.y.lessThan(1)
  );
  If(and(inp.groundDetail.greaterThan(0), inTile), () => {
    // explicit level: implicit derivatives are undefined in non-uniform
    // control flow (the texture has no mips; level 0 is what it read)
    const r = texture(colonies.texture, uv).level(float(0)).r.mul(255).toVar();
    // metres inside the garden land's edge (0: farther outside than held)
    const d = select(
      r.greaterThan(0.5),
      r.sub(128).div(COLONY_EDGE_SCALE),
      -10
    );
    const w = max(g.w, 0.01).toVar();
    // a soft edge that wanders a little, as hedges and fences do
    const edge = d.add(gdNoise(inp.xy.mul(0.35)).sub(0.5).mul(0.8)).toVar();
    const inside = smoothstep(float(-0.3).sub(w), w.add(0.5), edge).toVar();
    If(inside.greaterThan(0), () => {
      const garden = colonyPlots(
        inp,
        { texture: colonies.texture, uv },
        edge,
        w
      );
      const on = min(inp.groundDetail.div(0.7), 1).mul(G.strength);
      col.baseCol.assign(mix(col.baseCol, garden, inside.mul(on)));
    });
  });
}

// --- vineyards --------------------------------------------------------------------

/** vine boxes are sunk this far so the terrain's facets never show a gap */
const SINK_M = 0.2;
const OVERLAP_M = 0.3;

interface VineInstance {
  len: number;
  rot: number;
  tint: number;
  x: number;
  y: number;
  z: number;
}

/** A tile's vine rows as box instances in the Y-up frame, stood on the
 *  ground. Pure but for the height sampler; exported for tests. */
export function vineInstances(
  rows: Point2[][],
  ctx: GroundContext
): VineInstance[] {
  const out: VineInstance[] = [];
  for (const row of rows) {
    for (const piece of hedgePieces(row, VINE_ROW.h, VINE_ROW.w)) {
      const ground = ctx.heightAt(piece.x, piece.y);
      if (ground === null) {
        continue;
      }
      const world = epsgToWorld(piece.x, piece.y, ctx.offset);
      out.push({
        x: world.x,
        y: ground - SINK_M,
        z: world.z,
        rot: piece.angle,
        len: piece.len + OVERLAP_M,
        tint: hash(piece.x * 0.31 + piece.y * 0.17) - 0.5,
      });
    }
  }
  return out;
}

/** The vine rows' material: scene-wide (it carries no per-tile data),
 *  each instance's box and tint applied in the node. */
function vineMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("vine-rows", () => {
    const material = new MeshStandardNodeMaterial({
      color: 0xff_ff_ff,
      roughness: 0.95,
    });
    material.positionNode = instancePosition();
    material.colorNode = vec3(materialColor).mul(instanceTint());
    return material;
  });
}

/**
 * One tile's vine rows onto a Y-up group (add it to the tile's content
 * root). Empty input → an empty group; freed with the scene
 * (disposeObject3D).
 */
export function buildVineyards(rows: Point2[][], ctx: GroundContext): Group {
  const group = new Group();
  group.name = "vineyards";
  const items = vineInstances(rows, ctx);
  if (items.length === 0) {
    return group;
  }
  const geo = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = vineMaterial();
  const dummy = new Object3D();
  const col = new Color();
  for (const cell of bucketByCell(items)) {
    const mesh = new Instances(geo, mat, cell.length);
    mesh.name = "vine-rows";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    cell.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.len, VINE_ROW.h + SINK_M, VINE_ROW.w);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      col.setHSL(0.25 + p.tint * 0.03, 0.36, 0.42 + p.tint * 0.06);
      mesh.setColorAt(i, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceTints) {
      mesh.instanceTints.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
