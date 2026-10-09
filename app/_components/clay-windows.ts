import type { UniformNode, Vector3 } from "three/webgpu";
import {
  abs,
  cameraViewMatrix,
  clamp,
  dot,
  float,
  floor,
  fract,
  fwidth,
  max,
  min,
  mix,
  mod,
  normalize,
  sign,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  DOOR_GAP_M,
  DOOR_NONE_CODE,
  DOOR_SLOT,
  FACADE_SCALE_M,
  LOOSE_JITTER,
  WINDOW_DEPTH,
  WINDOW_LIFT,
  WINDOW_ROWS,
  WINDOW_SILL,
  WINDOW_STYLE,
} from "@/lib/city/windows";
import type { F, Live, V3, V4 } from "./shader-chunks";

/**
 * The parts round a window (m), drawn on the wall: the sill (Sohlbank)
 * under it — its height, how far it stands out, how far past the opening
 * it reaches either side; a Fasche — its width round the opening and how
 * far it stands out; a Verdachung over it — its height, the wall between
 * it and the opening (or the Fasche), how far it stands out and past.
 */
export const WINDOW_PARTS = {
  sill: { h: 0.06, proud: 0.045, past: 0.06 },
  frame: { w: 0.11, proud: 0.015 },
  lintel: { h: 0.09, gap: 0.07, proud: 0.05, past: 0.1 },
} as const;

/**
 * How the opening reads: its back (where the glass would be) the wall's
 * colour × this — darker and cooler, never black, never glass —, lit by
 * the sun only `backSun` as much as plaster (a pane takes little of it:
 * a window on a sunny front reads dark, its sunlit reveal bright); the
 * reveals the wall's plaster a shade darker; far off, where the windows
 * are a few pixels wide, the wall darker by `far` of the openings' share
 * (their mean tone).
 */
export const WINDOW_TONE = {
  back: [0.4, 0.43, 0.5] as [number, number, number],
  backSun: 0.25,
  far: 0.6,
  reveal: 0.93,
} as const;

/** The wall rolls into the opening at its sides and head over a quarter
 *  round this wide (m): soft plaster, a line of light where the sun
 *  catches it — drawn only where it spans a pixel or more. */
export const WINDOW_ARRIS_M = 0.03;

/** What the windows read per fragment (the clay's own nodes). */
export interface WindowInputs {
  /** the object's storey height and eave over its base (m) */
  eave: F;
  /** the `facade` attribute (lib/city/windows.ts `facadeAttribute`) */
  facade: V4;
  /** metres over the object's base */
  h: F;
  /** a per-building hash in −1…1 (its roughness jitter): a loose grid's
   *  offsets, the lit windows at night */
  seed: F;
  /** 1 where the ground floor is a shop's (OSM, or the photos' sign) */
  shop: F;
  /** the object's window row: axis, width, height, style */
  spec: V4;
  storey: F;
  /** the windows' strength (the *Fenster* row) */
  strength: Live;
  /** world, surface → sun */
  sun: UniformNode<"vec3", Vector3>;
  /** world, the view's direction through the fragment (unit, into the
   *  scene): from the camera in perspective, one for every pixel in
   *  Modell's parallel projection */
  view: V3;
  /** 1 on walls */
  wall: F;
  /** the flat world normal */
  wn: V3;
}

/** The windows' terms in the clay (`clayWindows`). */
export interface ClayWindows {
  /** a factor on the indirect light (the reveals', the sills' shade) */
  ao: F;
  /** the clay's colour with the windows */
  colour: (col: V3) => V3;
  /** the night's lit windows (× the dusk glow and night) */
  glow: V3;
  /** the normal to shade with in the opening (view space) and how much */
  normal: V3;
  normalMix: F;
  /** 1 in an opening (anti-aliased), near enough to be drawn */
  opening: F;
  /** a factor on the sun's light (the sills', the reveals' shadows) */
  sun: F;
}

/** A hash in 0…1 of two numbers. */
const hash = (a: F, b: F): F =>
  fract(sin(a.mul(12.9898).add(b.mul(78.233))).mul(43_758.5453));

/** 1 where `x` > 0, its edge anti-aliased over `px` (m a pixel). */
const cover = (x: F, px: F): F => clamp(x.div(px).add(0.5), 0, 1);

/** A pixel's footprint on the wall (m): along it and up. A grazing view
 *  stretches it along the wall only, so each edge is smoothed over its own
 *  axis — one isotropic footprint blurred the rows of a street seen along
 *  its length into its sky. */
interface Px {
  u: F;
  v: F;
}

/** A style bit (WINDOW_STYLE). */
const bit = (style: F, b: number): F => mod(floor(style.div(b)), 2);

/** Where the fragment lies in the window grid (see `clayWindows`). */
interface Grid {
  /** the window's axis along the wall, from the wall's middle (m) */
  axis: F;
  /** the depth of its reveal (m) */
  depth: F;
  /** the window's half width and height (m) */
  half: F;
  tall: F;
  /** 1 where the fragment's storey and column have a window */
  here: F;
  /** its column and storey (for the hashes) */
  j: F;
  k: F;
  /** 1 within the facade's band of windows (the far tone) */
  band: F;
  /** the window's share of its storey cell (the far tone) */
  coverage: F;
  /** where the fragment is from the window's axis and its sill (m) */
  u: F;
  v: F;
  style: F;
}

/** The columns: centred on the wall at the axis spacing, the outer ones
 *  `WINDOW_ROWS.edge` in from its ends, a loose grid's a little off. */
function columns(i: WindowInputs, s: F, length: F) {
  const axis = max(i.spec.x, 0.1);
  const style = floor(i.spec.w.add(0.5));
  const room = length.sub(2 * WINDOW_ROWS.edge).sub(i.spec.y);
  // steps and mixes, never a select: three emits a select as if/else, and
  // what an arm builds first it builds again outside it
  const n = step(0, room).mul(floor(max(room, 0).div(axis).add(1e-4)).add(1));
  const off = n.sub(1).mul(0.5);
  const j = clamp(floor(s.div(axis).add(off).add(0.5)), 0, max(n.sub(1), 0));
  const free = clamp(
    axis.sub(i.spec.y).sub(WINDOW_ROWS.gap).mul(0.5),
    0,
    axis.mul(LOOSE_JITTER)
  );
  const jitter = hash(j, i.seed)
    .mul(2)
    .sub(1)
    .mul(free)
    .mul(bit(style, WINDOW_STYLE.loose));
  const centre = j.sub(off).mul(axis).add(jitter);
  const extent = off.mul(axis).add(i.spec.y.mul(0.5));
  return { axis, centre, extent, j, n, style };
}

/** 1 where a ground-floor window on `centre` (m along the wall), `half`
 *  wide either side, keeps `DOOR_GAP_M` of wall from the door a `_FACADE`
 *  door slot holds (`DOOR_SLOT`; 1 where it holds none) — the code's place
 *  and width class as lib/city/windows.ts `slotDoor` reads them, the test
 *  its `clearOfDoor`. */
function doorClear(slot: F, centre: F, half: F): F {
  const code = floor(slot.mul(DOOR_NONE_CODE).add(0.5));
  const place = floor(code.add(0.5).div(DOOR_SLOT.widths));
  const c = code.sub(place.mul(DOOR_SLOT.widths));
  const width = min(c, DOOR_SLOT.fine)
    .mul(DOOR_SLOT.wStep)
    .add(max(c.sub(DOOR_SLOT.fine), 0).mul(DOOR_SLOT.wideStep))
    .add(DOOR_SLOT.w0);
  const clear = step(
    width
      .mul(0.5)
      .add(DOOR_GAP_M + DOOR_SLOT.step / 2)
      .add(half),
    abs(centre.sub(place.mul(DOOR_SLOT.step)))
  );
  return max(clear, step(DOOR_NONE_CODE - 0.5, abs(code)));
}

/** The window grid at the fragment: its column (`columns`) and its storey
 *  row — the ground floor's from the base, each upper one's from its
 *  storey line, none past the eave's clearance; the ground floor's only
 *  where no shop, shopfront or door stands. */
function grid(i: WindowInputs): Grid {
  const s = i.facade.x.mul(FACADE_SCALE_M);
  const signed = i.facade.y.mul(FACADE_SCALE_M);
  const length = abs(signed);
  const c = columns(i, s, length);
  const depth = float(WINDOW_DEPTH.base).add(
    mod(floor(c.style.div(WINDOW_STYLE.depth)), WINDOW_DEPTH.classes).mul(
      WINDOW_DEPTH.step
    )
  );
  const sill = float(WINDOW_SILL.base).add(
    mod(floor(c.style.div(WINDOW_STYLE.sill)), WINDOW_SILL.classes).mul(
      WINDOW_SILL.step
    )
  );
  const storey = max(i.storey, 0.5);
  const first = max(storey, WINDOW_ROWS.firstLine);
  const tall = min(i.spec.z, storey.sub(sill).sub(WINDOW_ROWS.lintel));
  const k = step(first, i.h).mul(
    floor(max(i.h.sub(first), 0).div(storey)).add(1)
  );
  const line = step(0.5, k).mul(first.add(k.sub(1).mul(storey)));
  // the ground floor's windows start higher (a Hochparterre, over the
  // plinth), their heads where the upper floors' are
  const lift = mod(floor(c.style.div(WINDOW_STYLE.lift)), WINDOW_LIFT.classes)
    .mul(WINDOW_LIFT.step)
    .mul(step(k, 0.5));
  // a top floor's windows end at the eave's clearance, shorter if they must
  const top = i.eave.sub(WINDOW_ROWS.eaveClear);
  const height = min(line.add(sill).add(tall), top)
    .sub(line)
    .sub(sill)
    .sub(lift);
  const half = i.spec.y.mul(0.5);
  const groundOk = float(1)
    .sub(bit(c.style, WINDOW_STYLE.noGround))
    .mul(float(1).sub(i.shop))
    .mul(step(-0.01, signed))
    .mul(doorClear(i.facade.z, c.centre, half))
    .mul(doorClear(i.facade.w, c.centre, half))
    .mul(step(sill.add(tall), first.sub(WINDOW_ROWS.lintel)));
  const rows = step(0.5, c.n)
    .mul(step(WINDOW_ROWS.min, height))
    .mul(step(0.05, i.spec.x))
    .mul(step(0.5, length))
    .mul(mix(1, groundOk, step(k, 0.5)));
  const here = rows;
  return {
    axis: c.centre,
    band: here.mul(step(abs(s), c.extent)),
    coverage: i.spec.y.mul(tall).div(max(c.axis.mul(storey), 0.1)),
    depth,
    half,
    here,
    j: c.j,
    k,
    style: c.style,
    tall: height,
    u: s.sub(c.centre),
    v: i.h.sub(line).sub(sill).sub(lift),
  };
}

/** The wall's frame in world space: along it (the way `s` runs), out of
 *  it (horizontal), up. */
function wallFrame(wn: V3) {
  const along = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  return {
    t: vec3(along.x, 0, along.y),
    out: normalize(vec3(wn.x, 0, wn.z).add(vec3(1e-5, 0, 0))),
    up: vec3(0, 1, 0),
  };
}

/**
 * Inside the opening: the view ray from the fragment into the recess —
 * through the opening, `depth` deep to its back — and what it meets first:
 * the back, a side reveal or the head or sill's reveal; there its normal,
 * how deep it lies, and whether the sun reaches it through the opening.
 * Where a reveal gives way to the back is smoothed over the pixel's
 * footprint (a step there aliased into speckle on small or grazing
 * windows), and so is the sun's edge inside. The sun reaches in only
 * where it falls on the wall at a fair angle: a grazing sun lights a
 * sliver of a reveal at most, and the shadow map, read on the wall's
 * plane, is noise there.
 */
function recess(g: Grid, view: V3, wn: V3, sun: V3, px: Px) {
  const f = wallFrame(wn);
  const vd = max(dot(view, f.out).negate(), 0.05);
  const ku = dot(view, f.t).div(vd);
  const kv = view.y.div(vd);
  // how deep the ray leaves the opening's side, and its head or sill (far
  // where it runs along them)
  const far = 1e4;
  const up = step(0, kv);
  const zu = min(g.half.sub(sign(ku).mul(g.u)).div(max(abs(ku), 1e-4)), far);
  const zv = min(mix(g.v, g.tall.sub(g.v), up).div(max(abs(kv), 1e-4)), far);
  // a side reveal is seen where the ray leaves the opening's side before
  // the back; the head's or the sill's likewise
  const sideSeen = cover(
    sign(ku)
      .mul(g.u)
      .sub(g.half.sub(g.depth.mul(abs(ku)))),
    px.u
  );
  const rowSeen = mix(
    cover(g.depth.mul(kv.negate()).sub(g.v), px.v),
    cover(g.v.sub(g.tall.sub(g.depth.mul(kv))), px.v),
    up
  );
  const sideFirst = step(zu, zv);
  const side = sideSeen.mul(mix(float(1).sub(rowSeen), 1, sideFirst));
  const row = rowSeen.mul(mix(1, float(1).sub(sideSeen), sideFirst));
  const back = clamp(float(1).sub(side).sub(row), 0, 1);
  const z = side
    .mul(min(zu, g.depth))
    .add(row.mul(min(zv, g.depth)))
    .add(back.mul(g.depth));
  const normal = normalize(
    f.out
      .mul(back)
      .add(f.t.mul(sign(ku).negate()).mul(side))
      .add(f.up.mul(sign(kv).negate()).mul(row))
  );
  const uh = g.u.add(ku.mul(z));
  const vh = g.v.add(kv.mul(z));
  // the sun's way out of the recess, from the point the view meets
  const sd = dot(sun, f.out);
  const sdx = max(sd, 1e-3);
  const ue = uh.add(dot(sun, f.t).div(sdx).mul(z));
  const ve = vh.add(sun.y.div(sdx).mul(z));
  const pen = max(z.mul(0.08).add(0.008), max(px.u, px.v));
  const lit = smoothstep(pen.negate(), pen, g.half.sub(abs(ue)))
    .mul(smoothstep(pen.negate(), pen, ve))
    .mul(smoothstep(pen.negate(), pen, g.tall.sub(ve)))
    .mul(smoothstep(0.02, 0.2, sd));
  // the recess darker the deeper, its back darker into its corners and
  // under the head, which hides the sky from it (a band three reveals
  // deep)
  const edge = min(g.half.sub(abs(uh)), min(vh, g.tall.sub(vh)));
  const underHead = smoothstep(0, g.depth.mul(3), g.tall.sub(vh));
  const ao = mix(1, 0.6, z.div(g.depth)).mul(
    mix(
      1,
      mix(0.8, 1, smoothstep(0, 0.12, edge)).mul(mix(0.75, 1, underHead)),
      back
    )
  );
  return { ao, back, lit, normal };
}

/** A ledge standing `proud` out of the wall whose underside lies `under`
 *  m below the fragment's level `v`: the sun's shadow it throws down the
 *  wall (`span`: its half length along the wall, centred on `u`), and its
 *  soft contact shade under it. */
function ledgeShadow(
  u: F,
  under: F,
  span: F,
  proud: number,
  wn: V3,
  sun: V3,
  px: Px
) {
  const f = wallFrame(wn);
  const sd = dot(sun, f.out);
  const sdx = max(sd, 1e-3);
  const drop = float(proud).mul(max(sun.y, 0)).div(sdx);
  const shift = float(proud).mul(dot(sun, f.t)).div(sdx);
  const shadow = cover(span.sub(abs(u.add(shift))), px.u)
    .mul(cover(under, px.v))
    .mul(cover(drop.sub(under), px.v))
    .mul(step(0, sd));
  const contact = cover(span.sub(abs(u)), px.u)
    .mul(cover(under, px.v))
    .mul(float(1).sub(smoothstep(0, 0.09, under)));
  return { contact, shadow };
}

/** The parts round the opening (`WINDOW_PARTS`): where each is (1 on its
 *  face), the sun's shadows they throw and their contact shade. */
function parts(g: Grid, i: WindowInputs, px: Px) {
  const P = WINDOW_PARTS;
  const au = abs(g.u);
  const frameOn = bit(g.style, WINDOW_STYLE.frame);
  const lintelOn = bit(g.style, WINDOW_STYLE.lintel);
  const sillSpan = g.half.add(P.sill.past);
  const sill = cover(sillSpan.sub(au), px.u)
    .mul(cover(g.v.add(P.sill.h), px.v))
    .mul(cover(g.v.negate(), px.v));
  const underSill = ledgeShadow(
    g.u,
    g.v.add(P.sill.h).negate(),
    sillSpan,
    P.sill.proud,
    i.wn,
    i.sun,
    px
  );
  const fw = P.frame.w;
  const inOpening = cover(g.half.sub(au), px.u).mul(
    cover(g.tall.sub(g.v), px.v)
  );
  const frame = cover(g.half.add(fw).sub(au), px.u)
    .mul(cover(g.v, px.v))
    .mul(cover(g.tall.add(fw).sub(g.v), px.v))
    .mul(float(1).sub(inOpening))
    .mul(frameOn);
  // the Fasche's outer edge: a hairline of contact shade on the wall
  const frameEdge = cover(g.half.add(fw + 0.02).sub(au), px.u)
    .mul(cover(g.v.add(0.02), px.v))
    .mul(cover(g.tall.add(fw + 0.02).sub(g.v), px.v))
    .mul(float(1).sub(frame))
    .mul(float(1).sub(cover(g.half.sub(au), px.u).mul(cover(g.v, px.v))))
    .mul(frameOn);
  const lintelBase = g.tall.add(P.lintel.gap).add(frameOn.mul(fw));
  const lintelSpan = g.half.add(P.lintel.past).add(frameOn.mul(fw));
  const lintel = cover(lintelSpan.sub(au), px.u)
    .mul(cover(g.v.sub(lintelBase), px.v))
    .mul(cover(lintelBase.add(P.lintel.h).sub(g.v), px.v))
    .mul(lintelOn);
  const underLintel = ledgeShadow(
    g.u,
    lintelBase.sub(g.v),
    lintelSpan,
    P.lintel.proud,
    i.wn,
    i.sun,
    px
  );
  return {
    sill,
    frame,
    lintel,
    shadow: max(underSill.shadow, underLintel.shadow.mul(lintelOn)),
    contact: max(
      underSill.contact.mul(0.3),
      max(underLintel.contact.mul(0.25).mul(lintelOn), frameEdge.mul(0.12))
    ),
  };
}

/** The quarter round where the wall turns into the opening
 *  (`WINDOW_ARRIS_M`), outside it at its sides and head: its weight (1 at
 *  the opening's edge, 0 a round's width out) and its normal, the wall's
 *  tilted towards the opening. */
function arris(g: Grid, wn: V3, px: Px) {
  const f = wallFrame(wn);
  const r = WINDOW_ARRIS_M;
  const side = abs(g.u).sub(g.half);
  const head = g.v.sub(g.tall);
  const round = (d: F, p: F) =>
    float(1)
      .sub(smoothstep(0, r, d))
      .mul(step(0, d))
      .mul(float(1).sub(smoothstep(r * 0.5, r * 1.5, p)));
  const s = round(side, px.u)
    .mul(cover(g.v, px.v))
    .mul(cover(g.tall.sub(g.v), px.v));
  const t = round(head, px.v).mul(cover(g.half.sub(abs(g.u)), px.u));
  return {
    normal: normalize(
      f.out.add(f.t.mul(sign(g.u).negate()).mul(s)).sub(f.up.mul(t))
    ),
    weight: max(s, t),
  };
}

/**
 * The windows on the clay (lib/city/windows.ts gives each building's
 * rhythm and each wall vertex its place along the wall): per storey a row
 * of openings on the axes — a recess the view looks into (`recess`), its
 * reveals plaster, its back the wall's colour darker and cooler, lit by
 * the sun only where it reaches in through the opening — with a slim sill
 * under each, and where the style says a Fasche round it or a Verdachung
 * over it, each standing a few centimetres out of the wall and throwing
 * the sun's shadow down it. No glass, no mullions, no frames.
 *
 * Every edge is anti-aliased by its pixel footprint; once a window is a few
 * pixels wide the drawing hands over to the facade's mean tone (the
 * openings' share of a storey, darker), so a far street never shimmers.
 * At night a share of the windows is lit, warm (`glow`, on the dusk light's
 * row). Branch-free: fwidth needs uniform control flow.
 */
export function clayWindows(i: WindowInputs): ClayWindows {
  const g = grid(i);
  const px: Px = {
    u: max(fwidth(i.facade.x.mul(FACADE_SCALE_M)), 1e-4),
    v: max(fwidth(i.h), 1e-4),
  };
  // the window's width in pixels: drawn from 6, the mean tone under 2.5
  const detail = smoothstep(2.5, 6, i.spec.y.div(px.u));
  const on = i.strength.mul(i.wall).mul(g.here);
  const near = on.mul(detail);
  const opening = cover(g.half.sub(abs(g.u)), px.u)
    .mul(cover(g.v, px.v))
    .mul(cover(g.tall.sub(g.v), px.v))
    .mul(near);
  const r = recess(g, i.view, i.wn, i.sun, px);
  const p = parts(g, i, px);
  const round = arris(g, i.wn, px);
  const rounded = round.weight.mul(near).mul(float(1).sub(opening));
  const lit = step(0.6, hash(g.j.add(g.k.mul(17.31)), i.seed.add(3.7)));
  const glowNear = opening.mul(r.back).mul(lit);
  const glowFar = float(1)
    .sub(detail)
    .mul(i.strength)
    .mul(i.wall)
    .mul(g.band)
    .mul(g.coverage)
    .mul(0.4);
  const farTone = float(1).sub(
    g.coverage
      .mul(WINDOW_TONE.far)
      .mul(float(1).sub(detail))
      .mul(i.strength)
      .mul(i.wall)
      .mul(g.band)
  );
  const world = normalize(mix(round.normal, r.normal, opening));
  return {
    opening,
    normal: normalize(cameraViewMatrix.mul(vec4(world, 0)).xyz),
    normalMix: max(opening, rounded),
    ao: mix(1, r.ao, opening).mul(float(1).sub(p.contact.mul(near))),
    sun: mix(1, r.lit.mul(mix(1, WINDOW_TONE.backSun, r.back)), opening).mul(
      float(1).sub(p.shadow.mul(near))
    ),
    glow: vec3(1, 0.78, 0.48).mul(glowNear.add(glowFar)),
    colour: (col: V3) => {
      const face = col.mul(
        float(1)
          .add(p.sill.mul(0.05))
          .add(p.frame.mul(0.035))
          .add(p.lintel.mul(0.05).mul(float(1).sub(p.sill)))
          .mul(near)
          .add(float(1).sub(near))
      );
      const inside = mix(
        col.mul(WINDOW_TONE.reveal),
        col.mul(vec3(...WINDOW_TONE.back)),
        r.back
      );
      return mix(face, inside, opening).mul(farTone);
    },
  };
}
