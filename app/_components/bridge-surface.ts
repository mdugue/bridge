import { Color, MeshStandardNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  dot,
  float,
  floor,
  fract,
  Fn,
  fwidth,
  materialColor,
  max,
  min,
  mix,
  normalize,
  normalWorldGeometry,
  positionWorld,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { LANDCOVER_CLASSES } from "@/lib/city/landcover";
import { MARKING_PATTERN } from "@/lib/city/markings";
import { gdBand, gdHash, gdNoise } from "./ground-detail";
import type { F, V3, V4 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * What a bridge is made of, drawn in world space (no texture, nothing of a
 * tile: every material here is scene-wide). Two looks:
 *
 * - **The deck's surface** (`deckMaterial`, per deck kind). The deck's top
 *   carries its frame as an attribute, `aDeck` = (station along the axis,
 *   offset across it, the outline's left and right offsets there;
 *   rail-layer.ts `deckFrame`), so the road bridge's top is laid out as
 *   the street it carries: footways along both parapets in the pavement's
 *   colour with their slabs, a kerb stone and a gutter at their edge, the
 *   carriageway in the road's colour with its grain and, on a wide one,
 *   the centre line's dashes (lib/city/markings.ts). A path bridge is sand
 *   with a kerb along the parapets, a rail bridge the track bed with its
 *   walkways, the rest stone paving. The deck's fascia is dressed stone, a
 *   shade darker (the shadow under the cornice), its underside darker
 *   still. Without a frame (an older file) the top keeps its colour and
 *   grain.
 * - **The stone** (`stoneMaterial`): fascia, parapets, piers and the
 *   masonry arches as ashlar — courses and running-bond joints on every
 *   upright face, along its own horizontal, each block a shade of its own,
 *   and a large weathering mottle over it all.
 *
 * Joints, kerbs and lines fade out by their pixel footprint (`fwidth`)
 * before they could alias; the footways, the carriageway and the
 * weathering stay at any scale, so a bridge still reads as a street over
 * the river from a Modell picture at 1 : 10 000. Branch-free (mixes and
 * steps), so the derivatives stay in uniform control flow.
 */

export type DeckKind = "other" | "path" | "rail" | "road";

const linear = (srgb: readonly [number, number, number]): V3 => {
  const c = new Color().setRGB(
    srgb[0] / 255,
    srgb[1] / 255,
    srgb[2] / 255,
    "srgb"
  );
  return vec3(c.r, c.g, c.b);
};

const classColour = (key: string): V3 => {
  const c = LANDCOVER_CLASSES.find((k) => k.key === key);
  return linear(c?.srgb ?? [200, 200, 206]);
};

/** The pavement's slabs beside a road: the built-up ground's pale clay. */
const PAVEMENT = classColour("builtup");
/** Road paint (road-markings.ts). */
const PAINT: V3 = linear([226, 223, 214]);

/** The pixel's footprint in metres. */
export const footprint = (): F => {
  const w = fwidth(positionWorld);
  return max(max(w.x, w.y), max(w.z, 0.002));
};

/** Distance (in units of `period`) to the nearest multiple of it. */
const toLine = (v: F, period: number): F =>
  abs(fract(v.div(period).add(0.5)).sub(0.5)).mul(period);

/** A joint line `2 · half` m wide every `period` m along `v`, anti-aliased
 *  over the pixel's footprint `aa`. */
const joint = (v: F, period: number, half: number, aa: F): F =>
  float(1).sub(
    smoothstep(max(float(half).sub(aa), 0), aa.add(half), toLine(v, period))
  );

/**
 * Ashlar on any face: courses `course` m high and blocks `block` m long
 * along the face's own horizontal (running bond), each block a shade of
 * its own, under a weathering mottle. Returns the albedo factor (~1).
 * Horizontal faces get the mottle only.
 */
export const ashlar = Fn(
  ([p, n, aa]: [V3, V3, F]): F => {
    const course = 0.55;
    const block = 1.15;
    const upright = float(1).sub(smoothstep(0.55, 0.85, abs(n.y)));
    const along = normalize(vec2(n.z.negate(), n.x).add(vec2(1e-5, 0)));
    const u = dot(p.xz, along);
    const row = floor(p.y.div(course));
    const ub = u.div(block).add(fract(row.mul(0.5)));
    // the joints as soft lines while a course is a few pixels high, the
    // blocks' shades while a block is
    const fine = float(1).sub(smoothstep(0.06, 0.3, aa));
    const lines = max(
      joint(p.y, course, 0.02, aa),
      joint(ub.mul(block), block, 0.02, aa)
    ).mul(fine);
    const shade = gdHash(vec2(floor(ub), row))
      .sub(0.5)
      .mul(0.14)
      .mul(float(1).sub(smoothstep(0.4, 1.2, aa)));
    const mottle = gdNoise(p.xz.mul(0.12).add(p.y.mul(0.31)))
      .sub(0.5)
      .mul(0.14);
    return float(1)
      .add(shade.mul(upright))
      .add(mottle)
      .sub(lines.mul(0.22).mul(upright));
  },
  { p: "vec3", n: "vec3", aa: "float", return: "float" }
);

/** The deck's frame at the fragment, or zeros where the mesh has none. */
const deckFrame = Fn((builder) =>
  builder.geometry.hasAttribute("aDeck")
    ? attribute("aDeck", "vec4")
    : vec4(0, 0, 0, 0)
) as unknown as () => V4;

interface Layout {
  /** 1 on the deck's top, laid out (a frame and a width) */
  laid: F;
  /** offset across the axis, and the deck's middle and width there */
  o: F;
  mid: F;
  width: F;
  /** distance to the nearer edge of the deck (m) */
  edge: F;
  /** station along the axis (m) */
  s: F;
}

function layout(): Layout {
  const d = deckFrame();
  const s = d.x;
  const o = d.y;
  const width = d.z.sub(d.w);
  return {
    laid: step(0.5, width),
    o,
    mid: d.z.add(d.w).mul(0.5),
    width,
    edge: max(min(d.z.sub(o), o.sub(d.w)), 0),
    s,
  };
}

/** A road bridge's top: footways, kerbs, carriageway, centre dashes. */
function roadTop(base: V3, l: Layout, aa: F): V3 {
  // footways on a deck of 6 m and more, wider with the deck
  const walkW = clamp(l.width.mul(0.18), 1.4, 3.2)
    .mul(step(9, l.width))
    .add(float(1.2).mul(step(6, l.width).sub(step(9, l.width))));
  const walk = float(1).sub(smoothstep(walkW.sub(aa), walkW.add(aa), l.edge));
  const near = float(1).sub(smoothstep(0.12, 0.5, aa));
  const fine = float(1).sub(smoothstep(0.02, 0.08, aa));
  // the pavement's slabs: a metre along, 0.8 m across
  const slabs = max(joint(l.s, 1, 0.012, aa), joint(l.edge, 0.8, 0.012, aa))
    .mul(fine)
    .mul(0.07);
  const pavement = PAVEMENT.mul(float(1).sub(slabs));
  // asphalt: a coarse mottle that stays, a grain that fades
  const p = positionWorld.xz;
  const grain = gdNoise(p.mul(2.3))
    .sub(0.5)
    .mul(0.05)
    .mul(fine)
    .add(gdNoise(p.mul(0.21)).sub(0.5).mul(0.06));
  const road = base.mul(grain.add(0.96));
  const top = mix(road, pavement, walk.mul(step(0.5, walkW)));
  // kerb: stone on the footway side, the gutter on the road side
  const kerb = gdBand(l.edge, walkW.sub(0.25), walkW, aa)
    .mul(near)
    .mul(step(0.5, walkW));
  const gutter = gdBand(l.edge, walkW, walkW.add(0.35), aa)
    .mul(near)
    .mul(step(0.5, walkW));
  const kerbed = mix(
    top,
    max(top.mul(1.08), PAVEMENT.mul(1.04)),
    kerb.mul(0.8)
  ).mul(float(1).sub(gutter.mul(0.12)));
  // the centre line's dashes on a carriageway of two lanes
  const P = MARKING_PATTERN;
  const lanes = step(5.5, l.width.sub(walkW.mul(2)));
  const dash = step(
    fract(l.s.div(P.centrePeriod)),
    float(P.centreDash / P.centrePeriod)
  );
  const line = gdBand(
    l.o.sub(l.mid),
    -P.centreHalfWidth,
    P.centreHalfWidth,
    max(aa, 0.01)
  )
    .mul(dash)
    .mul(lanes)
    .mul(float(1).sub(smoothstep(0.08, 0.3, aa)));
  return mix(kerbed, PAINT, line.mul(0.9));
}

/** A path bridge: sand with a kerb along the parapets. */
function pathTop(base: V3, l: Layout, aa: F): V3 {
  const near = float(1).sub(smoothstep(0.12, 0.5, aa));
  const kerb = gdBand(l.edge, 0, 0.3, aa).mul(near);
  const grain = gdNoise(positionWorld.xz.mul(1.6)).sub(0.5).mul(0.06);
  const sand = base.mul(grain.add(1));
  return mix(sand, PAVEMENT.mul(1.02), kerb.mul(0.7));
}

/** A rail bridge: the track bed with a walkway along each side. */
function railTop(base: V3, l: Layout, aa: F): V3 {
  const near = float(1).sub(smoothstep(0.12, 0.5, aa));
  const walkway = float(1).sub(smoothstep(0.8 - 0.05, 0.8 + 0.05, l.edge));
  const ballast = gdNoise(positionWorld.xz.mul(4.1))
    .sub(0.5)
    .mul(0.12)
    .mul(float(1).sub(smoothstep(0.03, 0.12, aa)));
  const bed = base.mul(ballast.add(0.97));
  return mix(bed, PAVEMENT.mul(0.92), walkway.mul(near.mul(0.5).add(0.5)));
}

/** Any other deck: stone paving, joints along and across the axis. */
function stoneTop(base: V3, l: Layout, aa: F): V3 {
  const fine = float(1).sub(smoothstep(0.02, 0.08, aa));
  const setts = max(joint(l.s, 0.6, 0.012, aa), joint(l.edge, 0.6, 0.012, aa))
    .mul(fine)
    .mul(0.08);
  return base.mul(float(1).sub(setts));
}

const TOPS: Record<DeckKind, (base: V3, l: Layout, aa: F) => V3> = {
  other: stoneTop,
  path: pathTop,
  rail: railTop,
  road: roadTop,
};

/**
 * The deck of one kind: its top laid out by its frame, its fascia dressed
 * stone, its underside in shade. Scene-wide (one build per kind and
 * layout).
 */
export function deckMaterial(
  kind: DeckKind,
  colour: number
): MeshStandardNodeMaterial {
  return sceneMaterial(`bridge-deck:${kind}:${colour.toString(16)}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(colour),
      roughness: 0.95,
    });
    m.name = `bridge-deck-${kind}`;
    const n = normalWorldGeometry;
    const aa = footprint();
    const l = layout();
    const base = materialColor;
    const top = mix(base.mul(0.97), TOPS[kind](base, l, aa), l.laid);
    const up = smoothstep(0.5, 0.8, n.y);
    const down = smoothstep(0.5, 0.8, n.y.negate());
    const side = base.mul(ashlar(positionWorld, n, aa)).mul(0.9);
    m.colorNode = mix(mix(side, top, up), base.mul(0.72), down);
    return m;
  });
}

/** Fascia, parapets, piers, masonry arches: dressed stone. Scene-wide. */
export function stoneMaterial(colour: number): MeshStandardNodeMaterial {
  return sceneMaterial(`bridge-stone:${colour.toString(16)}`, () => {
    const m = new MeshStandardNodeMaterial({
      color: new Color(colour),
      roughness: 0.95,
    });
    m.name = "bridge-stone";
    m.colorNode = materialColor.mul(
      ashlar(positionWorld, normalWorldGeometry, footprint())
    );
    return m;
  });
}
