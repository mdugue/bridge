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
  DORMER_WINDOW,
  DOOR_NONE_CODE,
  DOOR_SLOT,
  FACADE_SCALE_M,
  MEASURED_AXES,
  LOOSE_JITTER,
  WINDOW_DEPTH,
  WINDOW_LIFT,
  WINDOW_ROWS,
  WINDOW_SILL,
  WINDOW_STYLE,
} from "@/lib/city/windows";
import type { F, V3, V4 } from "./shader-chunks";

/**
 * The parts round a window (m), drawn on the wall: the sill (Sohlbank)
 * under it — its height, how far it stands out, how far past the opening
 * it reaches either side; a Fasche — its width round the opening and how
 * far it stands out; a Verdachung over it — its height, the wall between
 * it and the opening (or the Fasche), how far it stands out and past.
 */
export const WINDOW_PARTS = {
  sill: { h: 0.07, proud: 0.07, past: 0.06 },
  frame: { w: 0.11, proud: 0.015 },
  lintel: { h: 0.09, gap: 0.07, proud: 0.1, past: 0.1 },
} as const;

/**
 * How the opening reads: its back (where the glass would be) the wall's
 * colour × this — darker and cooler, never black —, lit by
 * the sun only `backSun` as much as plaster (a pane takes little of it:
 * a window on a sunny front reads dark, its sunlit reveal bright); the
 * reveals the wall's plaster a shade darker; far off, where the windows
 * are a few pixels wide, the wall darker by `far` of the openings' share
 * (their mean tone); a reveal's sky light at the opening's edge `revealSky`
 * of the wall's (`recess`).
 */
export const WINDOW_TONE = {
  back: [0.4, 0.43, 0.5] as [number, number, number],
  backSun: 0.5,
  far: 0.6,
  reveal: 0.93,
  revealSky: 0.55,
} as const;

/**
 * The sky an opening's back mirrors, as a shop window's pane does
 * (visual-style.ts `paneSky`): a little brighter towards its head (`up`),
 * and a Schlick Fresnel lift (`fresnel` of the sky at most) at a grazing
 * view — where a real pane turns from dark to bright and so tells its
 * depth behind the reveals. No pane, no mullion is drawn: only its light.
 */
export const WINDOW_PANE_ROUGHNESS = 0.25;

export const WINDOW_SKY = { up: 0.06, fresnel: 0.5 } as const;

/** The wall rolls into the opening at its sides and head over a quarter
 *  round this wide (m): soft plaster, a line of light where the sun
 *  catches it — drawn only where it spans a pixel or more. */
export const WINDOW_ARRIS_M = 0.06;

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
  /** the windows' strength (*Fenster*, visual-style.ts `WINDOWS`) */
  strength: F;
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
  /** 1 on the opening's back that the view sees: a pane, smooth (the
   *  clay's roughness drawn to `WINDOW_PANE_ROUGHNESS`, so the sun glints
   *  in it as in a shop window) */
  pane: F;
  /** the sky the opening's back mirrors, as much as a shop window's pane
   *  (`WINDOW_SKY`; × the sky's colour, dimmed at night by the clay) */
  sky: F;
  /** a factor on the sun's light (the sills', the reveals' shadows) */
  sun: F;
  /** the window's own number in 0…1 (its column, storey and seed): where
   *  in the niches' fade band it turns from drawn to real
   *  (visual-style.ts `nicheMask`) */
  pick: F;
}

/** A hash in 0…1 of two numbers. */
export const windowHash = (a: F, b: F): F =>
  fract(sin(a.mul(12.9898).add(b.mul(78.233))).mul(43_758.5453));

/** 1 where `x` > 0, its edge anti-aliased over `px` (m a pixel). */
const cover = (x: F, px: F): F => clamp(x.div(px).add(0.5), 0, 1);

/** 1 within `span` either side of `u` = 0 along the wall (m), its edges
 *  anti-aliased; where the footprint along the wall spans the axes
 *  (`Px.du` 0) the span's share of them, between the outer windows. */
const along = (g: Grid, span: F, u: F, px: Px): F =>
  mix(
    clamp(span.mul(2).div(max(g.spacing, 0.1)), 0, 1).mul(g.inside),
    cover(span.sub(abs(u)), px.u),
    px.du
  );

/** The view in the wall's frame: how far it runs along the wall (`ku`)
 *  and up it (`kv`) per metre into it. */
function wallView(view: V3, wn: V3) {
  const f = wallFrame(wn);
  const vd = max(dot(view, f.out).negate(), 0.05);
  return { f, ku: dot(view, f.t).div(vd), kv: view.y.div(vd) };
}

/** A pixel's footprint on the wall (m): along it and up. A grazing view
 *  stretches it along the wall only, so each edge is smoothed over its own
 *  axis — one isotropic footprint blurred the rows of a street seen along
 *  its length into its sky. */
interface Px {
  u: F;
  v: F;
  /** 1 where a window's width spans enough pixels for its sides to be
   *  drawn, 0 where the footprint along the wall spans a window or more:
   *  there each row is drawn as its mean across the axes (`along`), its
   *  heights still drawn — a street seen along its length kept its rows
   *  when a frontal footprint alone decided, and lost them all to one
   *  flat tone. */
  du: F;
}

/** A style bit (WINDOW_STYLE). */
const bit = (style: F, b: number): F => mod(floor(style.div(b)), 2);

/** Where the fragment lies in the window grid (see `clayWindows`). */
interface Grid {
  /** the window's axis along the wall, from the wall's middle (m) */
  axis: F;
  /** the axes' spacing (m) */
  spacing: F;
  /** 1 between the outer windows' outer sides (anti-aliased) */
  inside: F;
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
 *  `WINDOW_ROWS.edge` in from its ends (a dormer's front: `DORMER_WINDOW`'s),
 *  a loose grid's a little off; on a wall whose axes the drives placed, its
 *  own count and spacing from the length slot (lib/city/windows.ts
 *  `MEASURED_AXES`, `slotAxes`). */
function columns(i: WindowInputs, s: F, length: F) {
  const units = floor(abs(i.facade.y).mul(32_767).add(0.5));
  const measured = step(MEASURED_AXES.base - 0.5, units);
  const code = max(units.sub(MEASURED_AXES.base), 0);
  const nMeasured = floor(code.add(0.5).div(MEASURED_AXES.perN));
  const axisMeasured = code
    .sub(nMeasured.mul(MEASURED_AXES.perN))
    .mul(MEASURED_AXES.step)
    .add(MEASURED_AXES.axis0);
  const axis = mix(max(i.spec.x, 0.1), axisMeasured, measured);
  // a measured wall's window never wider than its spacing leaves room for
  // (lib/city/windows.ts `measuredAxes`)
  const w = mix(i.spec.y, min(i.spec.y, axis.sub(WINDOW_ROWS.gap)), measured);
  const style = floor(i.spec.w.add(0.5));
  const dormer = bit(style, WINDOW_STYLE.dormer);
  const edge = mix(float(WINDOW_ROWS.edge), float(DORMER_WINDOW.edge), dormer);
  const room = length.sub(edge.mul(2)).sub(w);
  // steps and mixes, never a select: three emits a select as if/else, and
  // what an arm builds first it builds again outside it
  const n = mix(
    step(0, room).mul(floor(max(room, 0).div(axis).add(1e-4)).add(1)),
    nMeasured,
    measured
  );
  const off = n.sub(1).mul(0.5);
  const j = clamp(floor(s.div(axis).add(off).add(0.5)), 0, max(n.sub(1), 0));
  const free = clamp(
    axis.sub(w).sub(WINDOW_ROWS.gap).mul(0.5),
    0,
    axis.mul(LOOSE_JITTER)
  );
  // no sine in this hash: the niches behind the openings place the same
  // jitter on the CPU (lib/city/window-niches.ts `jitterHash`)
  const jitter = fract(j.mul(0.618034).add(i.seed.mul(0.7548777)))
    .mul(2)
    .sub(1)
    .mul(free)
    .mul(bit(style, WINDOW_STYLE.loose))
    // where the drives placed the axes they stay put
    .mul(float(1).sub(measured));
  const centre = j.sub(off).mul(axis).add(jitter);
  const extent = off.mul(axis).add(w.mul(0.5));
  return { axis, centre, dormer, extent, j, n, style, w };
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
 *  storey line, none past the eave's clearance nor under the ground in
 *  front of a wall without ground-floor windows; the ground floor's only
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
  // a dormer's front: its one row DORMER_WINDOW.sill over its foot
  const sill = mix(
    float(WINDOW_SILL.base).add(
      mod(floor(c.style.div(WINDOW_STYLE.sill)), WINDOW_SILL.classes).mul(
        WINDOW_SILL.step
      )
    ),
    float(DORMER_WINDOW.sill),
    c.dormer
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
  const top = i.eave.sub(
    mix(float(WINDOW_ROWS.eaveClear), float(DORMER_WINDOW.eaveClear), c.dormer)
  );
  const height = min(line.add(sill).add(tall), top)
    .sub(line)
    .sub(sill)
    .sub(lift);
  const half = c.w.mul(0.5);
  const groundOk = float(1)
    .sub(bit(c.style, WINDOW_STYLE.noGround))
    .mul(float(1).sub(i.shop))
    .mul(step(-0.01, signed))
    .mul(doorClear(i.facade.z, c.centre, half))
    .mul(doorClear(i.facade.w, c.centre, half))
    .mul(step(sill.add(tall), first.sub(WINDOW_ROWS.lintel)));
  // on a wall without ground-floor windows the ground in front (its first
  // door slot): no window under it
  const buried = mix(
    float(-1e3),
    i.facade.z.mul(FACADE_SCALE_M),
    float(1).sub(step(-0.01, signed))
  );
  const rows = step(0.5, c.n)
    .mul(step(buried.add(WINDOW_ROWS.plinthGap), line.add(sill).add(lift)))
    .mul(step(WINDOW_ROWS.min, height))
    .mul(step(0.05, i.spec.x))
    .mul(step(0.5, length))
    .mul(mix(1, groundOk, step(k, 0.5)));
  const here = rows;
  return {
    axis: c.centre,
    spacing: c.axis,
    inside: cover(c.extent.sub(abs(s)), max(fwidth(s), 1e-4)),
    band: here.mul(step(abs(s), c.extent)),
    coverage: c.w.mul(tall).div(max(c.axis.mul(storey), 0.1)),
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
  const t = normalize(vec2(wn.z.negate(), wn.x).add(1e-5));
  return {
    t: vec3(t.x, 0, t.y),
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
  const { f, ku, kv } = wallView(view, wn);
  // where the axes are averaged (px.du 0) the ray from the window's axis:
  // the side reveal then by its share of the opening's width
  const u = g.u.mul(px.du);
  // how deep the ray leaves the opening's side, and its head or sill (far
  // where it runs along them)
  const far = 1e4;
  const up = step(0, kv);
  const zu = min(g.half.sub(sign(ku).mul(u)).div(max(abs(ku), 1e-4)), far);
  const zv = min(mix(g.v, g.tall.sub(g.v), up).div(max(abs(kv), 1e-4)), far);
  // a side reveal is seen where the ray leaves the opening's side before
  // the back; the head's or the sill's likewise
  const sideSeen = mix(
    clamp(g.depth.mul(abs(ku)).div(max(g.half.mul(2), 0.1)), 0, 1),
    cover(
      sign(ku)
        .mul(g.u)
        .sub(g.half.sub(g.depth.mul(abs(ku)))),
      px.u
    ),
    px.du
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
  const uh = u.add(ku.mul(z));
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
  const underHead = smoothstep(0, max(g.depth.mul(3), 0.4), g.tall.sub(vh));
  // a reveal sees the sky only past the wall it turns from (the
  // quarter of it a wall sees, not half), so it starts `revealSky` as
  // light as the wall — at 1 a shaded front's reveals read as plain wall
  const ao = mix(
    mix(1, WINDOW_TONE.revealSky, float(1).sub(back)),
    0.6,
    z.div(g.depth)
  ).mul(
    mix(
      1,
      mix(0.6, 1, smoothstep(0, 0.2, edge)).mul(mix(0.55, 1, underHead)),
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
  g: Grid,
  u: F,
  under: F,
  span: F,
  proud: number,
  i: WindowInputs,
  px: Px
) {
  const f = wallFrame(i.wn);
  const sd = dot(i.sun, f.out);
  const sdx = max(sd, 1e-3);
  const drop = float(proud).mul(max(i.sun.y, 0)).div(sdx);
  const shift = float(proud).mul(dot(i.sun, f.t)).div(sdx).mul(px.du);
  const shadow = along(g, span, u.add(shift), px)
    .mul(cover(under, px.v))
    .mul(cover(drop.sub(under), px.v))
    .mul(step(0, sd));
  const contact = along(g, span, u, px)
    .mul(cover(under, px.v))
    .mul(float(1).sub(smoothstep(0, 0.09, under)));
  return { contact, shadow };
}

/** How far a ledge's front may seem to move off its place on the wall
 *  (m): seen almost along the wall a few centimetres of ledge would cover
 *  a metre of it, where its ends — not drawn — would show instead. */
const LEDGE_REACH_M = 0.3;

/**
 * A ledge `proud` out of the wall, its front from `vb` to `vt` over the
 * sill line and `span` either side of the window's axis, as the view sees
 * it: its front where the ray meets it (`proud` nearer the eye than the
 * wall, so moved up the wall when the eye is under it, down when over it,
 * and along it), and between the front and the wall its underside or its
 * top (`face`: its normal down when the eye is under it — `under` 1 —,
 * else up). Seen from under it a sill covers the bottom of its window;
 * from over it its top is lit by the sky. `cover` 1 where either is (in
 * height only: the window's own width lies within the ledge's).
 */
function ledge(
  g: Grid,
  k: { ku: F; kv: F },
  part: { vb: F; vt: F; span: F; proud: number },
  px: Px
) {
  const lift = clamp(k.kv.mul(part.proud), -LEDGE_REACH_M, LEDGE_REACH_M);
  const slide = clamp(k.ku.mul(part.proud), -LEDGE_REACH_M, LEDGE_REACH_M).mul(
    px.du
  );
  const under = step(0, lift);
  const fb = part.vb.add(lift);
  const ft = part.vt.add(lift);
  const frontV = cover(g.v.sub(fb), px.v).mul(cover(ft.sub(g.v), px.v));
  // the face between: [vb, vb + lift] seen from under, [vt + lift, vt]
  // from over
  const lo = mix(ft, part.vb, under);
  const hi = mix(part.vt, fb, under);
  const faceV = cover(g.v.sub(lo), px.v)
    .mul(cover(hi.sub(g.v), px.v))
    .mul(float(1).sub(frontV));
  return {
    front: along(g, part.span, g.u.sub(slide), px).mul(frontV),
    face: along(
      g,
      part.span.add(abs(slide).mul(0.5)),
      g.u.sub(slide.mul(0.5)),
      px
    ).mul(faceV),
    cover: max(frontV, faceV),
    under,
  };
}

/** The parts round the opening (`WINDOW_PARTS`): where each is (1 on its
 *  front; `face` 1 on a sill's or Verdachung's top or underside the view
 *  sees, `faceUp` its normal's sign), the sun's shadows they throw, their
 *  contact shade, and how much of the opening the sill hides (`hides`). */
function parts(g: Grid, i: WindowInputs, px: Px) {
  const P = WINDOW_PARTS;
  const au = abs(g.u);
  const k = wallView(i.view, i.wn);
  const frameOn = bit(g.style, WINDOW_STYLE.frame);
  const lintelOn = bit(g.style, WINDOW_STYLE.lintel);
  const sillSpan = g.half.add(P.sill.past);
  const sill = ledge(
    g,
    k,
    { vb: float(-P.sill.h), vt: float(0), span: sillSpan, proud: P.sill.proud },
    px
  );
  const underSill = ledgeShadow(
    g,
    g.u,
    g.v.add(P.sill.h).negate(),
    sillSpan,
    P.sill.proud,
    i,
    px
  );
  const fw = P.frame.w;
  const inOpening = cover(g.half.sub(au), px.u).mul(
    cover(g.tall.sub(g.v), px.v)
  );
  // the Fasche stands 1.5 cm out: drawn only where its sides are
  const frame = cover(g.half.add(fw).sub(au), px.u)
    .mul(cover(g.v, px.v))
    .mul(cover(g.tall.add(fw).sub(g.v), px.v))
    .mul(float(1).sub(inOpening))
    .mul(frameOn)
    .mul(px.du);
  // the Fasche's outer edge: a hairline of contact shade on the wall
  const frameEdge = cover(g.half.add(fw + 0.02).sub(au), px.u)
    .mul(cover(g.v.add(0.02), px.v))
    .mul(cover(g.tall.add(fw + 0.02).sub(g.v), px.v))
    .mul(float(1).sub(frame))
    .mul(float(1).sub(cover(g.half.sub(au), px.u).mul(cover(g.v, px.v))))
    .mul(frameOn)
    .mul(px.du);
  const lintelBase = g.tall.add(P.lintel.gap).add(frameOn.mul(fw));
  const lintelSpan = g.half.add(P.lintel.past).add(frameOn.mul(fw));
  const lintel = ledge(
    g,
    k,
    {
      vb: lintelBase,
      vt: lintelBase.add(P.lintel.h),
      span: lintelSpan,
      proud: P.lintel.proud,
    },
    px
  );
  const underLintel = ledgeShadow(
    g,
    g.u,
    lintelBase.sub(g.v),
    lintelSpan,
    P.lintel.proud,
    i,
    px
  );
  return {
    sill: sill.front,
    frame,
    lintel: lintel.front.mul(lintelOn),
    face: max(sill.face, lintel.face.mul(lintelOn)),
    faceUp: float(1).sub(sill.under.mul(2)),
    hides: sill.cover,
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

/** The share of windows lit at night, and a lit one's light (× the dusk
 *  light and the night): a quarter, softly — two in five at full light
 *  made every street a wall of lamps. */
export const NIGHT_WINDOWS = { lit: 0.25, light: 0.6 } as const;

/**
 * The windows on the clay (lib/city/windows.ts gives each building's
 * rhythm and each wall vertex its place along the wall): per storey a row
 * of openings on the axes — a recess the view looks into (`recess`), its
 * reveals plaster, its back the wall's colour darker and cooler, lit by
 * the sun only where it reaches in through the opening — with a slim sill
 * under each, and where the style says a Fasche round it or a Verdachung
 * over it, each standing a few centimetres out of the wall and throwing
 * the sun's shadow down it; the back mirrors a little sky as its pane
 * would (`WINDOW_SKY`). No panes, no mullions, no frames.
 *
 * Every edge is anti-aliased by its pixel footprint; once a window is a few
 * pixels wide the drawing hands over to the facade's mean tone (the
 * openings' share of a storey, darker), so a far street never shimmers.
 * At night a quarter of the windows is lit, warm (`glow`, at the dusk
 * light's strength; far off the facade's mean of them, `NIGHT_WINDOWS`).
 * Branch-free: fwidth needs uniform control flow.
 */
export function clayWindows(i: WindowInputs): ClayWindows {
  const pu = max(fwidth(i.facade.x.mul(FACADE_SCALE_M)), 1e-4);
  const g = grid(i);
  const px: Px = {
    u: pu,
    v: max(fwidth(i.h), 1e-4),
    // the window's width in pixels along the wall: its sides drawn from
    // 6, under 2.5 its row's mean across the axes
    du: smoothstep(2.5, 6, i.spec.y.div(pu)),
  };
  // … and its height up the wall: drawn from 6, the storey's mean tone
  // under 2.5 — a grazing view stretches the footprint along the wall
  // only, so the rows stay where the columns can no longer be told apart
  const detail = smoothstep(2.5, 6, max(g.tall, 0.01).div(px.v));
  const on = i.strength.mul(i.wall).mul(g.here);
  const near = on.mul(detail);
  const p = parts(g, i, px);
  const opening = along(g, g.half, g.u, px)
    .mul(cover(g.v, px.v))
    .mul(cover(g.tall.sub(g.v), px.v))
    .mul(float(1).sub(p.hides))
    .mul(near);
  const r = recess(g, i.view, i.wn, i.sun, px);
  const round = arris(g, i.wn, px);
  const rounded = round.weight.mul(near).mul(px.du).mul(float(1).sub(opening));
  const ledgeFace = p.face.mul(near).mul(float(1).sub(opening));
  // which windows are lit: by their own hash where they are told apart,
  // their mean where the row is averaged (a column's hash per pixel
  // speckled a street seen along its length)
  const lit = mix(
    float(NIGHT_WINDOWS.lit),
    step(
      1 - NIGHT_WINDOWS.lit,
      windowHash(g.j.add(g.k.mul(17.31)), i.seed.add(3.7))
    ),
    px.du
  );
  const glowNear = opening.mul(r.back).mul(lit);
  const glowFar = float(1)
    .sub(detail)
    .mul(i.strength)
    .mul(i.wall)
    .mul(g.band)
    .mul(g.coverage)
    .mul(NIGHT_WINDOWS.lit);
  const farTone = float(1).sub(
    g.coverage
      .mul(WINDOW_TONE.far)
      .mul(float(1).sub(detail))
      .mul(i.strength)
      .mul(i.wall)
      .mul(g.band)
  );
  const up = vec3(0, 1, 0);
  const wallSide = normalize(
    mix(
      round.normal,
      up.mul(p.faceUp),
      ledgeFace.div(max(ledgeFace.add(rounded), 1e-3))
    )
  );
  const world = normalize(mix(wallSide, r.normal, opening));
  const fres = float(1).sub(clamp(abs(dot(i.view, i.wn)), 0, 1));
  const f2 = fres.mul(fres);
  const schlick = float(0.04).add(float(0.96).mul(f2.mul(f2).mul(fres)));
  const head = clamp(g.v.div(max(g.tall, 0.1)), 0, 1).mul(px.du);
  return {
    opening,
    pane: opening.mul(r.back),
    pick: windowHash(g.j.mul(7.13).add(g.k.mul(3.71)), i.seed.add(9.1)),
    sky: opening
      .mul(r.back)
      .mul(r.ao)
      .mul(head.mul(WINDOW_SKY.up).add(schlick.mul(WINDOW_SKY.fresnel))),
    normal: normalize(cameraViewMatrix.mul(vec4(world, 0)).xyz),
    normalMix: max(opening, max(rounded, ledgeFace)),
    ao: mix(1, r.ao, opening).mul(float(1).sub(p.contact.mul(near))),
    sun: mix(1, r.lit.mul(mix(1, WINDOW_TONE.backSun, r.back)), opening).mul(
      float(1).sub(p.shadow.mul(near))
    ),
    glow: vec3(1, 0.78, 0.48).mul(
      glowNear.add(glowFar).mul(NIGHT_WINDOWS.light)
    ),
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
