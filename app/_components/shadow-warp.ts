import { Matrix4, Vector3, Vector4 } from "three/webgpu";

/**
 * The sun's one shadow map, warped over the view from the air (light-space
 * perspective shadow maps, Wimmer et al. 2004). Pure math — the rig that
 * applies it is sun-rig.ts.
 *
 * From the air the camera sees the city out to the fog, 2–4 km. The square
 * frustum around the view's ground (lib/city/shadow-fit.ts) covers the first few
 * hundred metres of it: past that nothing casts but the baked horizon,
 * which knows a shadow's angle, not its shape, and none on a facade. A
 * square as large as the view would spread the map's texels evenly —
 * metres wide under the camera, where a pixel is a decimetre.
 *
 * The warp spends the same map unevenly: a perspective along the view's
 * heading as the sun sees it, so the texels are fine where the ground is
 * near and grow with the distance, as the screen's pixels do. The map is
 * no larger, the depth pass is still one pass, and three's shadow lookup
 * divides by w as it does for any projection. The warp follows the view,
 * so the map is fitted to the view's frustum widened by a margin and
 * stands until the view leaves what it covers (`warpCovers`): turning,
 * sliding and climbing within the margin draw no depth pass.
 *
 * Coordinates: world Y-up (the scene frame, never the rotated data group).
 */

/** Degrees added around the view's field on every side: what the view may
 *  turn before the map is fitted anew. */
export const WARP_MARGIN_DEG = 12;

/** Above this height over the ground (m) the map takes the warp … */
export const WARP_FROM_M = 30;
/** … and below this one it is the walker's square again (a switch is a
 *  depth pass, so hovering at one height must not flap). */
export const WARP_UNTIL_M = 20;

/** How far the warped map reaches along the view: this share of the fog's
 *  end (beyond it a shadow is all but fogged) … */
export const WARP_REACH_OF_FOG = 0.8;
/** … and never further (m). */
export const WARP_MAX_REACH_M = 2500;

/**
 * The warp's strength: a share of LiSPSM's n_opt (`warpDistance`). n_opt
 * balances the error along and across the view; half of it gives the
 * near ground (the first few hundred metres, where a shadow's shape still
 * reads) finer texels at the cost of the far field's, which the fog
 * covers. Measured in shadow-warp.test.ts.
 */
const WARP_STRENGTH = 0.5;

/** The nearest receiver the warp is focused on is never nearer (m). */
const MIN_NEAR_M = 10;

/** Receivers up to this height over the ground under the camera (m) are
 *  the near ground the warp is focused on (streets, yards, roofs). */
const NEAR_BAND_M = 25;

/** The view's direction as the sun sees it must be at least this long (sin
 *  of the angle between view and sun) to give the warp an axis; looking
 *  along the sun the map is the plain, unwarped fit. */
const MIN_SIN_GAMMA = 0.02;

/** Casters reach this high over the highest receiver (m): the depth range
 *  stretches toward the sun so that a tower outside the view still casts. */
const CASTER_RISE_M = 120;

/** The sun is never taken lower than this (sin of its elevation) for the
 *  caster extrusion, which grows as 1 / sin. */
const MIN_SUN_Y = 0.05;

/** The depth range never stretches further toward the sun than this (m). */
const MAX_EXTRUSION_M = 3000;

/** The depth bias (m) at the nearest receiver; it grows with the distance,
 *  as the texels do. The walker's −0.0003 is ~0.09 m at 121 m. */
const NEAR_BIAS_M = 0.15;

/** A fit is renewed when the nearest receiver came this much nearer (or
 *  went this much further): its texels no longer suit the view. */
const NEAREST_DRIFT = 1.6;

/** The far end of the view a fit must still cover, as a share of its
 *  reach: flying on, the last of it (deep in the fog) may run off the map
 *  before the map follows. */
const COVER_REACH = 0.85;

/** What the warp is fitted to: the camera and the band receivers lie in. */
export interface WarpView {
  /** the camera's aspect (width / height) */
  aspect: number;
  /** the highest receiver (world y, m): roofs over the high ground */
  ceilingY: number;
  /** the eye (world) */
  eye: Vector3;
  /** the lowest receiver (world y, m): the site's low ground */
  floorY: number;
  /** the camera's look direction (world, unit) */
  forward: Vector3;
  /** vertical field of view (degrees) */
  fovDeg: number;
  /** the terrain under the eye (world y, m) */
  groundY: number;
  /** how far along the look direction the map reaches (m) */
  reach: number;
  /** the camera's up (world, unit, at right angles to `forward`) */
  up: Vector3;
}

/** The shadow camera a warp fit asks for. */
export interface WarpFit {
  /** the shadow bias (three's `LightShadow.bias`, in depth units) that is
   *  `NEAR_BIAS_M` at the nearest receiver */
  bias: number;
  /** the ortho box over the warped coordinates (three's
   *  OrthographicCamera left, right, top, bottom, near, far) */
  box: {
    bottom: number;
    far: number;
    left: number;
    near: number;
    right: number;
    top: number;
  };
  /** world → the map's clip space (x, y in −1…1 on the map), for
   *  `warpCovers` */
  clip: Matrix4;
  /** the nearest receiver's depth along the view (m) */
  nearest: number;
  /** the farthest the map reaches from the eye (m, in plan): where the
   *  horizon's near band takes over */
  reachPlan: number;
  /** the light's target (world): the light stands one metre toward the sun */
  target: Vector3;
  /** the shadow camera's up (world): the view's direction as the sun sees it */
  up: Vector3;
  /** light view (the shadow camera's view space) → warped homogeneous
   *  coordinates; the ortho box applies after it */
  warp: Matrix4;
}

/**
 * The view's far end, widened by `marginDeg`: nine points `reach` from the
 * eye (the field's corners, its edges' middles and its centre) — the fog
 * lies at a distance, so the corners reach no further than the centre.
 */
function farPoints(view: WarpView, marginDeg: number): Vector3[] {
  const margin = (marginDeg * Math.PI) / 180;
  const halfV = (view.fovDeg * Math.PI) / 360;
  const halfH = Math.atan(view.aspect * Math.tan(halfV));
  const tanV = Math.tan(Math.min(halfV + margin, 1.45));
  const tanH = Math.tan(Math.min(halfH + margin, 1.45));
  const right = new Vector3().crossVectors(view.forward, view.up).normalize();
  const points: Vector3[] = [];
  const ray = new Vector3();
  for (const sx of [-1, 0, 1]) {
    for (const sy of [-1, 0, 1]) {
      ray
        .copy(view.forward)
        .addScaledVector(right, sx * tanH)
        .addScaledVector(view.up, sy * tanV)
        .normalize();
      points.push(view.eye.clone().addScaledVector(ray, view.reach));
    }
  }
  return points;
}

/**
 * The body spanned by `points` (their convex hull) cut to the band
 * `lo ≤ y ≤ hi`: the points inside the band and where the segments between
 * any two cross its planes. Every vertex of the cut hull is among them and
 * every one of them lies in it, so their extremes are the cut body's.
 */
export function cutToBand(
  points: readonly Vector3[],
  lo: number,
  hi: number
): Vector3[] {
  const cut = points
    .filter((p) => p.y >= lo && p.y <= hi)
    .map((p) => p.clone());
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      for (const h of [lo, hi]) {
        if ((a.y - h) * (b.y - h) < 0) {
          cut.push(a.clone().lerp(b, (h - a.y) / (b.y - a.y)));
        }
      }
    }
  }
  return cut;
}

/** The receivers a view sees (the frustum widened by `marginDeg`, cut to
 *  the receivers' band) and the nearest of the near ground's along the
 *  look direction (m). Null when it sees none (looking at the sky). */
function viewBody(
  view: WarpView,
  marginDeg: number
): { body: Vector3[]; nearest: number } | null {
  const hull = [view.eye, ...farPoints(view, marginDeg)];
  const body = cutToBand(hull, view.floorY, view.ceilingY);
  if (body.length < 3) {
    return null;
  }
  // the near ground the warp is focused on: where the view first meets the
  // streets and roofs, not the air round the eye
  const ground = cutToBand(
    hull,
    view.floorY,
    Math.min(view.ceilingY, view.groundY + NEAR_BAND_M)
  );
  const d = new Vector3();
  let nearest = Number.POSITIVE_INFINITY;
  for (const p of ground.length >= 3 ? ground : body) {
    nearest = Math.min(nearest, d.subVectors(p, view.eye).dot(view.forward));
  }
  return { body, nearest: Math.max(nearest, MIN_NEAR_M) };
}

/** The light's basis: z toward the sun, y `axis` as the sun sees it,
 *  x = y × z (three's lookAt with `up` = y). */
function lightBasis(
  sun: Vector3,
  axis: Vector3,
  fallbackUp: Vector3
): { sinGamma: number; x: Vector3; y: Vector3; z: Vector3 } {
  const z = sun.clone().normalize();
  const y = axis.clone().addScaledVector(z, -axis.dot(z));
  let sinGamma = y.length();
  if (sinGamma < MIN_SIN_GAMMA) {
    // looking along the sun: any axis across it, and no warp
    y.copy(fallbackUp).addScaledVector(z, -fallbackUp.dot(z));
    if (y.lengthSq() < 1e-6) {
      y.set(1, 0, 0).addScaledVector(z, -z.x);
    }
    sinGamma = 0;
  }
  y.normalize();
  const x = new Vector3().crossVectors(y, z).normalize();
  return { sinGamma, x, y, z };
}

/**
 * The warp's eye distance behind the body's near side, in the light's
 * plane (m): `WARP_STRENGTH` × LiSPSM's n_opt = (z_n + √(z_n z_f)) / sin γ,
 * with the nearest receiver for z_n. Looking along the sun (sin γ → 0) it
 * runs to infinity, which is the plain, unwarped fit; it is capped where
 * the perspective is as good as parallel.
 */
export function warpDistance(
  nearest: number,
  farthest: number,
  sinGamma: number
): number {
  const zn = Math.max(nearest, MIN_NEAR_M);
  const zf = Math.max(farthest, zn);
  const n = (WARP_STRENGTH * (zn + Math.sqrt(zn * zf))) / sinGamma;
  return Number.isFinite(n) ? Math.min(n, 1e6) : 1e6;
}

/** World → light view for a light at `light` with basis x, y, z: the
 *  inverse of the light's world matrix, as three's lookAt builds it. */
function lightView(
  light: Vector3,
  x: Vector3,
  y: Vector3,
  z: Vector3
): Matrix4 {
  return new Matrix4().makeBasis(x, y, z).setPosition(light).invert();
}

/** The ranges a body takes in the warped coordinates. */
interface WarpedBox {
  /** d of the nearest receiver: the bias is fixed there */
  dNear: number;
  left: number;
  right: number;
  bottom: number;
  top: number;
  sMin: number;
  sMax: number;
}

/**
 * The body's box after the warp — u = (x − cx) / d, v = −1 / d, s = z / d
 * with d = y − y0 — its depth stretched toward the sun to the casters'
 * top (`rise`, m along the light, per point).
 */
function warpedBox(
  points: readonly Vector3[],
  rise: readonly number[],
  cx: number,
  y0: number,
  nearIndex: number
): WarpedBox {
  const box: WarpedBox = {
    dNear: points[nearIndex].y - y0,
    left: Number.POSITIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
    bottom: Number.POSITIVE_INFINITY,
    top: Number.NEGATIVE_INFINITY,
    sMin: Number.POSITIVE_INFINITY,
    sMax: Number.NEGATIVE_INFINITY,
  };
  for (let i = 0; i < points.length; i++) {
    const { x, y, z } = points[i];
    const d = y - y0;
    const u = (x - cx) / d;
    const v = -1 / d;
    box.left = Math.min(box.left, u);
    box.right = Math.max(box.right, u);
    box.bottom = Math.min(box.bottom, v);
    box.top = Math.max(box.top, v);
    box.sMin = Math.min(box.sMin, z / d);
    box.sMax = Math.max(box.sMax, (z + rise[i]) / d);
  }
  return box;
}

/**
 * Fits the warped shadow camera to `view` for a sun at `sun` (world, unit,
 * surface → sun). Null when no receiver is in view (looking at the sky).
 */
export function fitWarpedShadow(view: WarpView, sun: Vector3): WarpFit | null {
  const seen = viewBody(view, WARP_MARGIN_DEG);
  if (!seen) {
    return null;
  }
  const { body, nearest } = seen;
  // the warp runs along the view's heading, not its look direction: what
  // it covers is the ground, which runs on level however far the camera
  // looks down (with the sun behind and to the side, the look direction
  // put the warp's axis askew to the ground and its texels at 2–3 ×)
  const heading = new Vector3(view.forward.x, 0, view.forward.z);
  const basis = lightBasis(
    sun,
    heading.lengthSq() > 1e-6 ? heading.normalize() : view.forward,
    view.up
  );
  const target = new Vector3(view.eye.x, view.groundY, view.eye.z);
  const light = target.clone().add(basis.z);
  const toLight = lightView(light, basis.x, basis.y, basis.z);
  const sunY = Math.max(sun.y, MIN_SUN_Y);
  const ceiling = view.ceilingY + CASTER_RISE_M;
  const d = new Vector3();
  let farthest = 0;
  let nearIndex = 0;
  let nearDepth = Number.POSITIVE_INFINITY;
  let reachPlan = 0;
  const local: Vector3[] = [];
  const rise: number[] = [];
  for (const [i, p] of body.entries()) {
    const depth = d.subVectors(p, view.eye).dot(view.forward);
    farthest = Math.max(farthest, depth);
    if (p.y <= view.groundY + NEAR_BAND_M && depth < nearDepth) {
      nearDepth = depth;
      nearIndex = i;
    }
    reachPlan = Math.max(reachPlan, Math.hypot(d.x, d.z));
    local.push(p.clone().applyMatrix4(toLight));
    rise.push(Math.min(Math.max(ceiling - p.y, 0) / sunY, MAX_EXTRUSION_M));
  }
  const yMin = Math.min(...local.map((p) => p.y));
  const y0 = yMin - warpDistance(nearest, farthest, basis.sinGamma);
  const cx = view.eye.clone().applyMatrix4(toLight).x;
  // rows: x − cx, −1, z, w = d = y − y0
  const warp = new Matrix4().set(
    1,
    0,
    0,
    -cx,
    0,
    0,
    0,
    -1,
    0,
    0,
    1,
    0,
    0,
    1,
    0,
    -y0
  );
  const w = warpedBox(local, rise, cx, y0, nearIndex);
  const box = {
    left: w.left,
    right: w.right,
    top: w.top,
    bottom: w.bottom,
    near: -w.sMax,
    far: -w.sMin,
  };
  const clip = new Matrix4()
    .makeOrthographic(
      box.left,
      box.right,
      box.top,
      box.bottom,
      box.near,
      box.far
    )
    .multiply(warp)
    .multiply(toLight);
  return {
    // the depth range in metres at d is (sMax − sMin) · d
    bias: -NEAR_BIAS_M / Math.max((w.sMax - w.sMin) * w.dNear, 1e-6),
    box,
    clip,
    nearest,
    reachPlan,
    target,
    up: basis.y,
    warp,
  };
}

/**
 * Whether `fit` still serves `view`: every receiver the view sees (without
 * the margin) lies on the map — across it and within its depth, so a view
 * over lower ground than the fit's is fitted anew too — and the nearest of
 * them is about as near as it was fitted for. Else the map is fitted anew:
 * one depth pass.
 */
export function warpCovers(fit: WarpFit, view: WarpView): boolean {
  const seen = viewBody({ ...view, reach: view.reach * COVER_REACH }, 0);
  if (!seen) {
    // nothing to shadow in view: whatever the map holds will do
    return true;
  }
  const ratio = seen.nearest / fit.nearest;
  if (ratio > NEAREST_DRIFT || ratio < 1 / NEAREST_DRIFT) {
    return false;
  }
  const q = new Vector4();
  return seen.body.every((p) => {
    q.set(p.x, p.y, p.z, 1).applyMatrix4(fit.clip);
    const edge = q.w * 1.0001;
    return (
      q.w > 0 &&
      Math.abs(q.x) <= edge &&
      Math.abs(q.y) <= edge &&
      Math.abs(q.z) <= edge
    );
  });
}
