/** SMAA over the frame as the post stack holds it, in two small targets. */
import {
  DataTexture,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGFormat,
  UnsignedByteType,
  Vector2,
} from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import {
  abs,
  Break,
  dot,
  float,
  Fn,
  If,
  int,
  Loop,
  max,
  mix,
  rtt,
  sign,
  sqrt,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import {
  SMAA_AREA_SIZE,
  SMAA_SEARCH_HEIGHT,
  SMAA_SEARCH_WIDTH,
  smaaAreaTable,
  smaaSearchTable,
} from "@/lib/city/smaa-tables";
import type { F, V2, V4 } from "./shader-chunks";

/**
 * SMAA 1x (Jimenez et al. 2012; the preset three's SMAANode runs: colour
 * edges, eight search steps, no diagonals) for the desktop's frame
 * (post-stack.ts, scene-profile.ts `PostProfile`) — linear, half-float,
 * above 1 in the sun's glow. Three's node drew it before; three things
 * differ:
 *
 * - **Its targets hold what the passes write.** The edges are two flags
 *   and the weights four bytes; three's node kept both, and the blended
 *   frame, in half-float RGBA at full resolution — 24 bytes a pixel, 107
 *   MiB at 2880 × 1620. Here the edges are RG8 and the weights RGBA8, and
 *   the third pass (the blend) has no target: like the phone's FXAA
 *   (fxaa.ts) it runs inside the pass that reads it. 6 bytes a pixel.
 * - **The edges are found on perceptual values.** SMAA's threshold is
 *   tuned to a gamma frame; fed the linear one, a step of 0.1 is most of
 *   the range in the shade and at night (their edges stayed stairs) and
 *   nothing in the sun. The colours go through a square root first, as
 *   fxaa.ts's luma does.
 * - **Its two tables are worked out** (lib/city/smaa-tables.ts), not
 *   decoded from pictures in the bundle.
 *
 * Every read names its level (the targets have no mips): no derivatives
 * inside the branches and loops, on either backend.
 */

/** A colour step (in square-rooted values) that counts as an edge. */
const THRESHOLD = 0.1;
/** How far along an edge its ends are searched, in steps of two pixels. */
const SEARCH_STEPS = 8;
/** An area table's block of distances per crossing-edge pattern. */
const AREA_BLOCK = 16;
/** A bilinear read of two edge texels at a quarter's offset is past this
 *  only where both are set: the edge goes on. */
const EDGE_GOES_ON = 0.8281;

export interface Smaa {
  /** the antialiased colour at the pass's uv (the blend, run in place) */
  color: V4;
  /** a pixel of the frame in uv follows the drawing buffer */
  setSize: (size: Vector2) => void;
  dispose: () => void;
}

/** A texture's first level at `at`. */
const read = (node: TextureNode, at: V2): V4 => node.sample(at).level(float(0));

/** The tables as textures: the area's two weights, the search's one byte. */
function tables(): { area: DataTexture; search: DataTexture } {
  const area = new DataTexture(
    smaaAreaTable(),
    SMAA_AREA_SIZE,
    SMAA_AREA_SIZE,
    RGFormat,
    UnsignedByteType
  );
  area.name = "SMAA.area";
  area.minFilter = LinearFilter;
  area.magFilter = LinearFilter;
  area.needsUpdate = true;
  const search = new DataTexture(
    smaaSearchTable(),
    SMAA_SEARCH_WIDTH,
    SMAA_SEARCH_HEIGHT,
    RedFormat,
    UnsignedByteType
  );
  search.name = "SMAA.search";
  search.minFilter = NearestFilter;
  search.magFilter = NearestFilter;
  // (its rows are 66 bytes: not a multiple of four)
  search.unpackAlignment = 1;
  search.needsUpdate = true;
  return { area, search };
}

/**
 * The antialiased `input` — a texture node whose `value` the caller may
 * switch between frames (the passes read whatever it holds).
 */
export function createSmaa(input: TextureNode, size: Vector2): Smaa {
  const texel = uniform(new Vector2(1 / size.x, 1 / size.y));
  const { area, search } = tables();
  const frame = (at: V2): V4 => read(input, at);
  const byte = { depthBuffer: false, type: UnsignedByteType };

  // 1. the edges to the left of and above each pixel
  const edges = rtt(
    Fn(() => {
      const at = uv();
      const seen = (dx: number, dy: number) =>
        sqrt(max(frame(at.add(texel.mul(vec2(dx, dy)))).rgb, 0));
      const c = seen(0, 0).toVar();
      const stepTo = (dx: number, dy: number): F => {
        const t = abs(c.sub(seen(dx, dy)));
        return max(t.r, max(t.g, t.b));
      };
      const delta = vec2(stepTo(-1, 0), stepTo(0, -1)).toVar();
      const found = step(vec2(THRESHOLD, THRESHOLD), delta).toVar();
      If(found.x.add(found.y).greaterThan(0), () => {
        // local contrast: an edge half as strong as one right beside it
        // is that one's flank, not an edge of its own
        const strongest = max(
          max(delta.x, delta.y),
          max(
            max(stepTo(1, 0), stepTo(0, 1)),
            max(stepTo(-2, 0), stepTo(0, -2))
          )
        );
        found.mulAssign(step(strongest.mul(0.5), delta));
      });
      return vec4(found, 0, 1);
    })(),
    null,
    null,
    { ...byte, format: RGFormat }
  );
  edges.value.name = "SMAA.edges";

  const edgesAt = (at: V2): V4 => read(edges, at);
  /** How many pixels a search's last step overshot, from the search table. */
  const overshoot = (e: V2, bias: number): F =>
    texture(search, vec2(e.x.mul(0.5).add(bias), e.y), float(0)).r.mul(255);
  /** A pattern's two weights at `distance` (√px to either end). */
  const areaOf = (distance: V2, e1: F, e2: F): V2 =>
    texture(
      area,
      vec2(e1, e2)
        .mul(4)
        .round()
        .mul(AREA_BLOCK)
        .add(distance)
        .add(0.5)
        .div(SMAA_AREA_SIZE),
      float(0)
    ).rg;
  /**
   * Where the edge through `from` ends, along x or y, towards `towards`
   * (−1: left or up): two pixels a step, each a bilinear read between
   * four edge texels, until the edge stops, a crossing edge is met or
   * `stop` is reached; then the overshoot of the last step taken back.
   */
  const searched = (axis: "x" | "y", towards: -1 | 1, from: V2, stop: F): F => {
    const along = axis === "x" ? vec2(1, 0) : vec2(0, 1);
    const e = (axis === "x" ? vec2(0, 1) : vec2(1, 0)).toVar();
    const at = vec2(from).toVar();
    const end = float(stop).toVar();
    const stride = along
      .mul(texel)
      .mul(2 * towards)
      .toVar();
    Loop(
      { start: int(0), end: int(SEARCH_STEPS), type: "int", condition: "<" },
      () => {
        e.assign(edgesAt(at).rg);
        at.addAssign(stride);
        const here = axis === "x" ? at.x : at.y;
        const own = axis === "x" ? e.y : e.x;
        const crossing = axis === "x" ? e.x : e.y;
        const reached =
          towards < 0 ? here.lessThanEqual(end) : here.greaterThanEqual(end);
        If(
          reached.or(own.lessThanEqual(EDGE_GOES_ON)).or(crossing.notEqual(0)),
          () => {
            Break();
          }
        );
      }
    );
    const px = axis === "x" ? texel.x : texel.y;
    const here = axis === "x" ? at.x : at.y;
    // the quarter's offset the read was made at, the step's bias of one
    // pixel and the last step's two — less what the table says of them
    const back = float(3.25).sub(
      overshoot(axis === "x" ? e : e.yx, towards < 0 ? 0 : 0.5)
    );
    return here.sub(px.mul(back).mul(towards));
  };

  // 2. how much of each edge pixel its line covers
  const weights = rtt(
    Fn(() => {
      const at = uv();
      const pixel = at.div(texel);
      const both = vec4(at, at);
      const scale = vec4(texel, texel);
      // the reads between four edge texels, for the searches…
      const o0 = both.add(scale.mul(vec4(-0.25, -0.125, 1.25, -0.125))).toVar();
      const o1 = both.add(scale.mul(vec4(-0.125, -0.25, -0.125, 1.25))).toVar();
      // …and where they give up
      const ends = vec4(o0.x, o0.z, o1.y, o1.w)
        .add(
          vec4(-2, 2, -2, 2)
            .mul(vec4(texel.x, texel.x, texel.y, texel.y))
            .mul(SEARCH_STEPS)
        )
        .toVar();
      const out = vec4(0, 0, 0, 0).toVar();
      const e = edgesAt(at).rg.toVar();
      If(e.y.greaterThan(0), () => {
        // an edge above: its ends to the left and right, and the edges
        // crossing it there
        const left = searched("x", -1, o0.xy, ends.x).toVar();
        const e1 = edgesAt(vec2(left, o1.y)).r.toVar();
        const right = searched("x", 1, o0.zw, ends.y).toVar();
        const e2 = edgesAt(vec2(right.add(texel.x), o1.y)).r.toVar();
        const d = vec2(left, right).div(texel.x).sub(pixel.x);
        out.rg.assign(areaOf(sqrt(abs(d)), e1, e2));
      });
      If(e.x.greaterThan(0), () => {
        // an edge to the left: its ends above and below
        const up = searched("y", -1, o1.xy, ends.z).toVar();
        const e1 = edgesAt(vec2(o0.x, up)).g.toVar();
        const down = searched("y", 1, o1.zw, ends.w).toVar();
        const e2 = edgesAt(vec2(o0.x, down.add(texel.y))).g.toVar();
        const d = vec2(up, down).div(texel.y).sub(pixel.y);
        out.ba.assign(areaOf(sqrt(abs(d)), e1, e2));
      });
      return out;
    })(),
    null,
    null,
    byte
  );
  weights.value.name = "SMAA.weights";

  // 3. the blend, in the pass that reads it: each pixel mixed with the
  // neighbour across its strongest line
  const color = Fn(() => {
    const at = uv();
    const own = read(weights, at);
    const a = vec4(
      own.x,
      read(weights, at.add(vec2(0, 1).mul(texel))).g,
      own.z,
      read(weights, at.add(vec2(1, 0).mul(texel))).a
    ).toVar();
    const result = frame(at).toVar();
    If(dot(a, vec4(1, 1, 1, 1)).greaterThanEqual(1e-5), () => {
      // left against right, above against below (1 where the first is
      // the greater), then the stronger of the two directions
      const x = mix(a.z.negate(), a.w, float(1).sub(step(a.w, a.z))).toVar();
      const y = mix(a.x.negate(), a.y, float(1).sub(step(a.y, a.x))).toVar();
      const horizontal = float(1).sub(step(abs(x), abs(y)));
      const offset = vec2(x.mul(horizontal), y.mul(float(1).sub(horizontal)));
      const across = frame(at.add(sign(offset).mul(texel)));
      result.assign(mix(result, across, max(abs(offset.x), abs(offset.y))));
    });
    return result;
  })();

  return {
    color,
    setSize: (next) => {
      texel.value.set(1 / next.x, 1 / next.y);
    },
    dispose: () => {
      edges.renderTarget?.dispose();
      weights.renderTarget?.dispose();
      area.dispose();
      search.dispose();
    },
  };
}
