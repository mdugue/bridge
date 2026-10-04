/**
 * Modell (plan 055, ADR 0044): the city in parallel projection, as planners
 * draw it. The pure half: the views' table, the scale, where the camera
 * stands and how it is turned for a view, how a screen point maps to the
 * ground, pan / zoom / turn / tilt, the dolly-zoom in and out of the
 * perspective view, the footprint the shadow map has to cover, the scale bar
 * and the north arrow. No THREE, no DOM; the camera is model-camera.ts, the
 * rig that owns it model-rig.ts.
 *
 * World frame (Y-up) as lib/city/pose.ts: north = −Z, east = +X; a turn is a
 * compass heading (0 = north, clockwise), a tilt the angle below the
 * horizon (0 = level, 90 = straight down).
 *
 * The camera of a parallel view has no place that changes the picture —
 * only a direction, the point in the middle of the picture (the pivot, on
 * the ground) and a scale. It is put MODEL_STANDOFF back along the view so
 * that the scene's view vectors (built for the perspective camera, see
 * ADR 0044) are within a few degrees of the true direction.
 */
import { clamp } from "./math";
import { DEG2RAD, directionOf, RAD2DEG, type Xyz } from "./pose";

/** The views (the HUD's *Projektion* cards). Ids are persisted: never rename. */
export type ModelPresetId =
  | "bird"
  | "elevation"
  | "iso"
  | "military"
  | "plan"
  | "section";

export interface ModelPreset {
  id: ModelPresetId;
  /** the card's word (German, like the rest of the HUD) */
  label: string;
  /** one line for the card's title */
  description: string;
  /** degrees below the horizon */
  tiltDeg: number;
  /**
   * How the turn is chosen on entering the view: the compass headings it
   * snaps to (an offset and a step), or null for "keep the current turn".
   */
  turnSnap: { offset: number; step: number } | null;
  /** the shear of world up onto screen up (Militärperspektive), else 0 */
  shear: number;
  /** the near plane is the cut through the pivot (Ansicht, Schnitt) */
  cut: boolean;
  /** cut faces are filled and the ground drawn as a profile (Schnitt) */
  poche: boolean;
  /** where the pivot sits on screen, in NDC y (0 = the middle) */
  pivotNdcY: number;
  /** may the tilt be dragged (Vogelschau) */
  freeTilt: boolean;
}

/** arctan(1/√2): the true isometric's tilt — the 30° is the edges' angle on the sheet. */
export const ISO_TILT_DEG = Math.atan(1 / Math.SQRT2) * RAD2DEG;

export const MODEL_PRESETS: readonly ModelPreset[] = [
  {
    id: "iso",
    label: "Isometrie",
    description:
      "Die 30°-Isometrie: 35,26° geneigt, alle drei Achsen gleich verkürzt",
    tiltDeg: ISO_TILT_DEG,
    turnSnap: { offset: 45, step: 90 },
    shear: 0,
    cut: false,
    poche: false,
    pivotNdcY: 0,
    freeTilt: false,
  },
  {
    id: "bird",
    label: "Vogelschau",
    description: "Parallel von schräg oben, Neigung und Drehung frei",
    tiltDeg: 30,
    turnSnap: null,
    shear: 0,
    cut: false,
    poche: false,
    pivotNdcY: 0,
    freeTilt: true,
  },
  {
    id: "military",
    label: "Militär",
    description:
      "Militärperspektive: der Grundriss unverzerrt, Höhen senkrecht darüber",
    tiltDeg: 90,
    turnSnap: { offset: 30, step: 90 },
    shear: 1,
    cut: false,
    poche: false,
    pivotNdcY: 0,
    freeTilt: false,
  },
  {
    id: "plan",
    label: "Lageplan",
    description: "Senkrecht von oben, Norden oben",
    tiltDeg: 90,
    turnSnap: { offset: 0, step: 360 },
    shear: 0,
    cut: false,
    poche: false,
    pivotNdcY: 0,
    freeTilt: false,
  },
  {
    id: "elevation",
    label: "Ansicht",
    description:
      "Waagerecht auf die Schnittlinie durch die Bildmitte, alles davor weg",
    tiltDeg: 0,
    turnSnap: null,
    shear: 0,
    cut: true,
    poche: false,
    pivotNdcY: -0.5,
    freeTilt: false,
  },
  {
    id: "section",
    label: "Schnitt",
    description: "Die Ansicht mit gefüllten Schnittflächen und Geländeprofil",
    tiltDeg: 0,
    turnSnap: null,
    shear: 0,
    cut: true,
    poche: true,
    pivotNdcY: -0.5,
    freeTilt: false,
  },
];

export const MODEL_PRESET_BY_ID: Readonly<Record<ModelPresetId, ModelPreset>> =
  Object.fromEntries(MODEL_PRESETS.map((p) => [p.id, p])) as Record<
    ModelPresetId,
    ModelPreset
  >;

export function isModelPreset(v: unknown): v is ModelPresetId {
  return typeof v === "string" && v in MODEL_PRESET_BY_ID;
}

/** m from the pivot back to the camera along the view (see the header). */
export const MODEL_STANDOFF = 20_000;
/** m the scene may reach beyond the pivot, away from the camera. */
export const MODEL_DEPTH = 15_000;

/** One CSS pixel at 96 dpi, in metres (25.4 mm / 96). */
export const CSS_PX_M = 0.0254 / 96;

/** The scale series the HUD offers (denominators, at 96 dpi). */
export const MODEL_SCALES = [500, 1000, 2500, 5000, 10_000] as const;

/** The zoom range (denominators): free in between. */
export const MODEL_SCALE_MIN = 250;
export const MODEL_SCALE_MAX = 25_000;
/** On a phone the widest view stops here (the memory a whole site costs). */
export const MODEL_SCALE_MAX_PHONE = 10_000;

/** Metres per CSS pixel at a scale denominator. */
export function metresPerPixelOf(denominator: number): number {
  return denominator * CSS_PX_M;
}

/** The scale denominator (at 96 dpi) of a metres-per-CSS-pixel. */
export function scaleOf(metresPerPixel: number): number {
  return metresPerPixel / CSS_PX_M;
}

/** The view a parallel camera shows. */
export interface ModelView {
  /** the point in the middle of the picture (world, on the ground) */
  pivot: Xyz;
  preset: ModelPresetId;
  /** compass heading the view looks along, degrees */
  turnDeg: number;
  /** degrees below the horizon */
  tiltDeg: number;
  /** metres per CSS pixel */
  metresPerPixel: number;
  /** world up onto screen up (Militärperspektive), 0 = none */
  shear: number;
  /** the near plane sits on the pivot (Ansicht, Schnitt) */
  cut: boolean;
}

/** A view's camera: where it stands, its axes and its frustum. */
export interface ModelCameraGeometry {
  position: Xyz;
  /** unit axes in world space: screen right, screen up, the view direction */
  right: Xyz;
  up: Xyz;
  forward: Xyz;
  /** the frustum in view-space metres, and its depth range */
  left: number;
  rightEdge: number;
  top: number;
  bottom: number;
  near: number;
  far: number;
  shear: number;
}

const sub = (a: Xyz, b: Xyz): Xyz => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});
const add = (a: Xyz, b: Xyz): Xyz => ({
  x: a.x + b.x,
  y: a.y + b.y,
  z: a.z + b.z,
});
const scale = (a: Xyz, s: number): Xyz => ({
  x: a.x * s,
  y: a.y * s,
  z: a.z * s,
});
const dot = (a: Xyz, b: Xyz): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Xyz, b: Xyz): Xyz => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const normalize = (a: Xyz): Xyz => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return scale(a, 1 / l);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpXyz = (a: Xyz, b: Xyz, t: number): Xyz => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});

/** The view's axes: right, up and forward (the direction it looks). */
export function modelAxes(
  turnDeg: number,
  tiltDeg: number
): { forward: Xyz; right: Xyz; up: Xyz } {
  const h = turnDeg * DEG2RAD;
  const forward = directionOf(h, -tiltDeg * DEG2RAD);
  const right = { x: Math.cos(h), y: 0, z: Math.sin(h) };
  return { forward, right, up: normalize(cross(right, forward)) };
}

/** Half the picture's height in metres. */
export function halfHeightOf(
  view: ModelView,
  viewportCssHeight: number
): number {
  return (view.metresPerPixel * Math.max(viewportCssHeight, 1)) / 2;
}

/** Where the pivot sits on screen (NDC y) for a view. */
export function pivotNdcYOf(view: ModelView): number {
  return MODEL_PRESET_BY_ID[view.preset].pivotNdcY;
}

/**
 * The camera for a view in a viewport (CSS px). The pivot is on screen at
 * (0, pivotNdcY); `near` is the cut through the pivot for an Ansicht, else
 * just in front of the camera.
 */
export function modelCameraGeometry(
  view: ModelView,
  viewport: { width: number; height: number }
): ModelCameraGeometry {
  const { forward, right, up } = modelAxes(view.turnDeg, view.tiltDeg);
  const halfH = halfHeightOf(view, viewport.height);
  const halfW = halfH * (viewport.width / Math.max(viewport.height, 1));
  const c = pivotNdcYOf(view);
  return {
    position: sub(view.pivot, scale(forward, MODEL_STANDOFF)),
    right,
    up,
    forward,
    left: -halfW,
    rightEdge: halfW,
    top: halfH * (1 - c),
    bottom: -halfH * (1 + c),
    near: view.cut ? MODEL_STANDOFF : 1,
    far: MODEL_STANDOFF + MODEL_DEPTH,
    shear: view.shear,
  };
}

/** A ray in world space. */
export interface WorldRay {
  origin: Xyz;
  direction: Xyz;
}

/**
 * The ray through a screen point (NDC) of a view, from the plane through
 * the pivot square to the view: in a parallel view every ray has the same
 * direction — tilted towards screen up by the shear in a
 * Militärperspektive, where a point raised by h shows h higher.
 */
export function modelRay(
  view: ModelView,
  viewport: { width: number; height: number },
  ndc: { x: number; y: number }
): WorldRay {
  const g = modelCameraGeometry(view, viewport);
  const halfH = (g.top - g.bottom) / 2;
  const sx = ndc.x * g.rightEdge;
  const sy = (ndc.y - pivotNdcYOf(view)) * halfH;
  const origin = add(view.pivot, add(scale(g.right, sx), scale(g.up, sy)));
  return {
    origin,
    direction: normalize(add(g.forward, scale(g.up, view.shear))),
  };
}

/** Where a ray meets the level plane at `y`, or null (level or rising). */
export function rayAtLevel(ray: WorldRay, y: number): Xyz | null {
  if (ray.direction.y > -1e-4) {
    return null;
  }
  const t = (y - ray.origin.y) / ray.direction.y;
  return add(ray.origin, scale(ray.direction, t));
}

/** The view looks (nearly) level: a pan moves the picture, not the ground. */
export function isLevelView(view: ModelView): boolean {
  return view.tiltDeg < 12 && view.shear === 0;
}

/**
 * The view moved by a drag of (dx, dy) CSS px (y down, as the pointer
 * reports it): the ground under the pointer follows the pointer. A level
 * view (Ansicht) slides in its own plane instead.
 */
export function panned(view: ModelView, dxPx: number, dyPx: number): Xyz {
  const { forward, right, up } = modelAxes(view.turnDeg, view.tiltDeg);
  const onScreen = add(
    scale(right, dxPx * view.metresPerPixel),
    scale(up, -dyPx * view.metresPerPixel)
  );
  if (isLevelView(view)) {
    return sub(view.pivot, onScreen);
  }
  const direction = normalize(add(forward, scale(up, view.shear)));
  // slide the moved point back along the view onto the pivot's level
  const onGround = sub(onScreen, scale(direction, onScreen.y / direction.y));
  return sub(view.pivot, onGround);
}

/** A ground pan by a world vector in the level plane (keys, a glide). */
export function pannedBy(view: ModelView, dx: number, dz: number): Xyz {
  return { x: view.pivot.x + dx, y: view.pivot.y, z: view.pivot.z + dz };
}

/** The screen's right and its up, flattened onto the ground (unit, world). */
export function groundAxes(view: ModelView): { right: Xyz; ahead: Xyz } {
  const h = view.turnDeg * DEG2RAD;
  return {
    right: { x: Math.cos(h), y: 0, z: Math.sin(h) },
    ahead: { x: Math.sin(h), y: 0, z: -Math.cos(h) },
  };
}

/**
 * Zooming about a screen point: the point stays put, the scale changes by
 * `factor` (> 1 zooms in). Returns the new pivot and metres per pixel, the
 * scale clamped to [min, max] denominators.
 */
export function zoomedAbout(
  view: ModelView,
  viewport: { width: number; height: number },
  ndc: { x: number; y: number },
  factor: number,
  maxDenominator: number = MODEL_SCALE_MAX
): { pivot: Xyz; metresPerPixel: number } {
  const mpp = clamp(
    view.metresPerPixel / Math.max(factor, 1e-6),
    metresPerPixelOf(MODEL_SCALE_MIN),
    metresPerPixelOf(maxDenominator)
  );
  const ratio = mpp / view.metresPerPixel;
  const ray = modelRay(view, viewport, ndc);
  const anchor = isLevelView(view)
    ? ray.origin
    : (rayAtLevel(ray, view.pivot.y) ?? ray.origin);
  return {
    pivot: add(anchor, scale(sub(view.pivot, anchor), ratio)),
    metresPerPixel: mpp,
  };
}

/** A turn snapped to the nearest `offset + k · step` degrees, in [0, 360). */
export function snapTurn(
  turnDeg: number,
  offset: number,
  step: number
): number {
  const k = Math.round((turnDeg - offset) / step);
  return wrapDeg(offset + k * step);
}

/**
 * The turn after a two-finger twist of `radians`, counter-clockwise on
 * screen: the ground turns with the fingers, as a map under them does.
 * Turning the view clockwise (a larger compass heading) turns the picture
 * counter-clockwise, so the twist adds.
 */
export function twistedTurn(turnDeg: number, radians: number): number {
  return wrapDeg(turnDeg + radians * RAD2DEG);
}

/** Degrees into [0, 360). */
export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** The tilts a free tilt snaps to (within SNAP_TILT_DEG). */
export const TILT_SNAPS = [30, ISO_TILT_DEG, 45, 60, 90] as const;
const SNAP_TILT_DEG = 2;
export const MIN_FREE_TILT = 5;

/** A dragged tilt: clamped, and caught by the presets' angles. */
export function snapTilt(tiltDeg: number): number {
  const t = clamp(tiltDeg, MIN_FREE_TILT, 90);
  const near = TILT_SNAPS.find((s) => Math.abs(s - t) <= SNAP_TILT_DEG);
  return near ?? t;
}

/** Shortest signed difference b − a between two headings (degrees). */
export function headingDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** A view switched to another preset: its tilt, shear and cut, and its
 *  turn as the preset snaps it. */
export function withPreset(view: ModelView, preset: ModelPresetId): ModelView {
  const p = MODEL_PRESET_BY_ID[preset];
  const turnDeg = p.turnSnap
    ? snapTurn(view.turnDeg, p.turnSnap.offset, p.turnSnap.step)
    : view.turnDeg;
  return {
    ...view,
    preset,
    turnDeg,
    tiltDeg: p.tiltDeg,
    shear: p.shear,
    cut: p.cut,
  };
}

// --- footprint and shadows -------------------------------------------------

/**
 * The ground the picture shows: where its four corners' rays meet the level
 * of the pivot. A level view (Ansicht) shows no ground area; it gets the
 * strip behind its cut, as deep as the picture is wide.
 */
export function modelFootprint(
  view: ModelView,
  viewport: { width: number; height: number }
): Xyz[] {
  if (isLevelView(view)) {
    const g = modelCameraGeometry(view, viewport);
    const ahead = groundAxes(view).ahead;
    const halfW = g.rightEdge;
    const a = add(view.pivot, scale(g.right, -halfW));
    const b = add(view.pivot, scale(g.right, halfW));
    const deep = scale(ahead, 2 * halfW);
    return [a, b, add(b, deep), add(a, deep)];
  }
  const corners = [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
  ];
  return corners.map(
    (ndc) =>
      rayAtLevel(modelRay(view, viewport, ndc), view.pivot.y) ?? view.pivot
  );
}

/** The circle around a footprint (world x/z, m). */
export function footprintCircle(points: readonly Xyz[]): {
  x: number;
  z: number;
  radius: number;
} {
  const n = Math.max(points.length, 1);
  const x = points.reduce((s, p) => s + p.x, 0) / n;
  const z = points.reduce((s, p) => s + p.z, 0) / n;
  const radius = points.reduce(
    (r, p) => Math.max(r, Math.hypot(p.x - x, p.z - z)),
    0
  );
  return { x, z, radius };
}

/** The shadow frustum's half-size never goes below the walker's. */
export const MODEL_SHADOW_MIN = 110;
/** …and stops here on a desktop: 1 600 m over 3 072² ≈ 1 m texels. */
export const MODEL_SHADOW_MAX = 1600;
/** Half-octave steps, and how far past a boundary a change waits. */
const SHADOW_STEPS_PER_OCTAVE = 2;
const SHADOW_HYSTERESIS = 0.3;

/**
 * The shadow frustum's half-size for a footprint radius: in half-octave
 * steps from MODEL_SHADOW_MIN, with hysteresis (a step is a full redraw of
 * the depth pass), capped at `max`.
 */
export function fitModelShadow(
  radius: number,
  current: number,
  max: number = MODEL_SHADOW_MAX
): number {
  const want = Math.max(radius, MODEL_SHADOW_MIN);
  const level = (r: number) =>
    Math.log2(r / MODEL_SHADOW_MIN) * SHADOW_STEPS_PER_OCTAVE;
  const now = level(Math.max(current, MODEL_SHADOW_MIN));
  const wanted = level(want);
  const step =
    wanted > now + SHADOW_HYSTERESIS || wanted < now - 1 - SHADOW_HYSTERESIS
      ? Math.ceil(wanted - 1e-9)
      : Math.round(now);
  return Math.min(
    MODEL_SHADOW_MIN * 2 ** (Math.max(step, 0) / SHADOW_STEPS_PER_OCTAVE),
    max
  );
}

// --- scale-keyed looks ----------------------------------------------------

/** The perspective view's vertical FOV the equivalents are measured with. */
const REFERENCE_FOV_DEG = 55;

/**
 * The distance a perspective camera (55°) would look from to show the same
 * picture height: what the distance-keyed looks (tree tiers, the map's
 * marks, the styles' far field) read in a parallel view.
 */
export function equivalentDistance(
  metresPerPixel: number,
  viewportCssHeight: number
): number {
  const halfH = (metresPerPixel * Math.max(viewportCssHeight, 1)) / 2;
  return halfH / Math.tan((REFERENCE_FOV_DEG * DEG2RAD) / 2);
}

// --- the HUD's instruments -------------------------------------------------

/** A scale bar: its length in metres and CSS px, and its labels. */
export interface ScaleBar {
  metres: number;
  px: number;
  /** the tick labels at 0, ½ and the end (the end with its unit) */
  labels: [string, string, string];
}

/** A length in the bar's unit: km from a kilometre on, with a comma. */
function lengthLabel(m: number, inKm: boolean): string {
  const v = inKm ? m / 1000 : m;
  return `${Number.isInteger(v) ? v : Number(v.toFixed(2))}`.replace(".", ",");
}

/**
 * The longest round length (1, 2 or 5 × 10ⁿ m) that fits `maxPx` CSS px at
 * this scale. The bar measures every length parallel to the picture plane.
 */
export function scaleBarFor(metresPerPixel: number, maxPx = 160): ScaleBar {
  const raw = metresPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(raw));
  const metres = [5, 2, 1].map((f) => f * power).find((m) => m <= raw) ?? power;
  const inKm = metres >= 1000;
  return {
    metres,
    px: metres / metresPerPixel,
    labels: [
      "0",
      lengthLabel(metres / 2, inKm),
      `${lengthLabel(metres, inKm)} ${inKm ? "km" : "m"}`,
    ],
  };
}

/** "1 : 2 500" — a denominator, rounded to two significant digits. */
export function scaleLabel(denominator: number): string {
  const digits = Math.max(Math.floor(Math.log10(denominator)) - 1, 0);
  const round = Math.round(denominator / 10 ** digits) * 10 ** digits;
  return `1 : ${round.toLocaleString("de-DE").replace(/\./g, " ")}`;
}

/** Degrees the north arrow turns on screen (clockwise, as CSS rotate). */
export function northArrowDeg(view: Pick<ModelView, "turnDeg">): number {
  return wrapDeg(-view.turnDeg);
}

// --- in and out of the perspective view -----------------------------------

/** A perspective pose (the walk/fly camera). */
export interface PerspectivePose {
  position: Xyz;
  headingDeg: number;
  pitchDeg: number;
  fovDeg: number;
}

/** The FOV the dolly zoom closes to before the parallel camera takes over. */
export const DOLLY_END_FOV_DEG = 2;

/** One frame of the dolly zoom (the perspective camera's pose). */
export interface DollyFrame extends PerspectivePose {
  near: number;
  far: number;
  /** distance from the camera to the point it looks at (m) */
  distance: number;
}

/**
 * The dolly zoom between a perspective pose and a parallel view, at `t`
 * (0 = the pose, 1 = the view as a near-parallel perspective): the camera
 * backs away while the FOV closes, so the point it looks at keeps its size
 * on screen. `lookDistance` is how far along the pose's view that point
 * lies at t = 0.
 */
export function dollyFrame(
  pose: PerspectivePose,
  lookDistance: number,
  view: ModelView,
  viewportCssHeight: number,
  t: number
): DollyFrame {
  const e = t * t * (3 - 2 * t);
  const from = directionOf(pose.headingDeg * DEG2RAD, pose.pitchDeg * DEG2RAD);
  const look = lerpXyz(
    add(pose.position, scale(from, lookDistance)),
    view.pivot,
    e
  );
  const headingDeg =
    pose.headingDeg + headingDelta(pose.headingDeg, view.turnDeg) * e;
  const pitchDeg = lerp(pose.pitchDeg, -view.tiltDeg, e);
  const fromHeight = 2 * lookDistance * Math.tan((pose.fovDeg * DEG2RAD) / 2);
  const toHeight = 2 * halfHeightOf(view, viewportCssHeight);
  const height = lerp(fromHeight, toHeight, e);
  const fovDeg = Math.exp(
    lerp(Math.log(pose.fovDeg), Math.log(DOLLY_END_FOV_DEG), e)
  );
  const distance = height / (2 * Math.tan((fovDeg * DEG2RAD) / 2));
  const dir = directionOf(headingDeg * DEG2RAD, pitchDeg * DEG2RAD);
  const reach = Math.max(height * 3, 2000);
  return {
    position: sub(look, scale(dir, distance)),
    headingDeg: wrapDeg(headingDeg),
    pitchDeg,
    fovDeg,
    distance,
    near: Math.max(0.3, distance - reach),
    far: distance + MODEL_DEPTH,
  };
}

/**
 * Entering Modell from a perspective pose: the parallel view of the same
 * place and size — the pivot where the view axis meets the ground (or
 * `ground` ahead, for a level view), the preset's tilt, the turn snapped
 * as the preset wants it, the scale the picture has at the pivot now.
 */
export function enteringView(
  pose: PerspectivePose,
  pivot: Xyz,
  preset: ModelPresetId,
  viewportCssHeight: number,
  maxDenominator: number = MODEL_SCALE_MAX
): ModelView {
  const distance = Math.hypot(
    pivot.x - pose.position.x,
    pivot.y - pose.position.y,
    pivot.z - pose.position.z
  );
  const height = 2 * distance * Math.tan((pose.fovDeg * DEG2RAD) / 2);
  const mpp = clamp(
    height / Math.max(viewportCssHeight, 1),
    metresPerPixelOf(MODEL_SCALE_MIN),
    metresPerPixelOf(maxDenominator)
  );
  return withPreset(
    {
      pivot,
      preset,
      turnDeg: wrapDeg(pose.headingDeg),
      tiltDeg: 0,
      metresPerPixel: mpp,
      shear: 0,
      cut: false,
    },
    preset
  );
}

/** Leaving from far away, the fly vantage over the pivot looks down so far. */
const LEAVE_PITCH_MIN = 20;
const LEAVE_PITCH_MAX = 60;
/** …from this far (m) at least and at most. */
const LEAVE_DISTANCE_MIN = 60;
const LEAVE_DISTANCE_MAX = 1500;

/**
 * Leaving Modell when the pivot has moved away from where it was entered:
 * a fly vantage over the pivot, looking the same way, at the scale the
 * picture has now.
 */
export function leavingPose(
  view: ModelView,
  viewportCssHeight: number,
  fovDeg: number
): PerspectivePose & { lookDistance: number } {
  const pitchDeg = -clamp(view.tiltDeg, LEAVE_PITCH_MIN, LEAVE_PITCH_MAX);
  const height = 2 * halfHeightOf(view, viewportCssHeight);
  const lookDistance = clamp(
    height / (2 * Math.tan((fovDeg * DEG2RAD) / 2)),
    LEAVE_DISTANCE_MIN,
    LEAVE_DISTANCE_MAX
  );
  const dir = directionOf(view.turnDeg * DEG2RAD, pitchDeg * DEG2RAD);
  return {
    position: sub(view.pivot, scale(dir, lookDistance)),
    headingDeg: view.turnDeg,
    pitchDeg,
    fovDeg,
    lookDistance,
  };
}

/** How near (m) the pivot must still be to the entry's for Modell to
 *  return to the pose it was entered from. */
export const RETURN_RADIUS_M = 150;

/** A view between two views (a preset switch, a turn glide), at `t`. */
export function viewBetween(a: ModelView, b: ModelView, t: number): ModelView {
  const e = t * t * (3 - 2 * t);
  return {
    pivot: lerpXyz(a.pivot, b.pivot, e),
    preset: t < 1 ? a.preset : b.preset,
    turnDeg: wrapDeg(a.turnDeg + headingDelta(a.turnDeg, b.turnDeg) * e),
    tiltDeg: lerp(a.tiltDeg, b.tiltDeg, e),
    metresPerPixel: Math.exp(
      lerp(Math.log(a.metresPerPixel), Math.log(b.metresPerPixel), e)
    ),
    shear: lerp(a.shear, b.shear, e),
    cut: t < 1 ? a.cut && b.cut : b.cut,
  };
}

/** The view's ground point under its pivot and the axes, for tests and QA. */
export function screenOfPoint(
  view: ModelView,
  viewport: { width: number; height: number },
  point: Xyz
): { x: number; y: number } {
  const g = modelCameraGeometry(view, viewport);
  const rel = sub(point, view.pivot);
  // the point slid along the view onto the pivot's view plane
  const along = dot(rel, g.forward);
  const sx = dot(rel, g.right);
  const sy = dot(rel, g.up) - view.shear * along;
  const halfH = (g.top - g.bottom) / 2;
  return {
    x: sx / g.rightEdge,
    y: sy / halfH + pivotNdcYOf(view),
  };
}

// --- the Projektion cards' glyphs -------------------------------------------

/** The cards' turns: each glyph shows a cube as its view draws one. */
const GLYPH_VIEW: Readonly<
  Record<ModelPresetId, { turnDeg: number; tiltDeg: number }>
> = {
  iso: { turnDeg: 45, tiltDeg: ISO_TILT_DEG },
  bird: { turnDeg: 30, tiltDeg: 30 },
  military: { turnDeg: 30, tiltDeg: 90 },
  plan: { turnDeg: 0, tiltDeg: 90 },
  elevation: { turnDeg: 0, tiltDeg: 0 },
  section: { turnDeg: 0, tiltDeg: 0 },
};

/** A glyph's line, in a 2 × 2 box (x right, y down, centred). */
export type GlyphLine = readonly [number, number, number, number];

const CUBE_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 3],
  [3, 2],
  [2, 0],
  [4, 5],
  [5, 7],
  [7, 6],
  [6, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * A unit cube's twelve edges as a preset draws them (the plan and the
 * elevations collapse onto a square), scaled to fill a 2 × 2 box.
 */
export function presetGlyph(id: ModelPresetId): GlyphLine[] {
  const { turnDeg, tiltDeg } = GLYPH_VIEW[id];
  const { forward, right, up } = modelAxes(turnDeg, tiltDeg);
  const shear = MODEL_PRESET_BY_ID[id].shear;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
    const p = { x: (i & 1) - 0.5, y: (i >> 2) - 0.5, z: ((i >> 1) & 1) - 0.5 };
    return {
      x: dot(p, right),
      y: -(dot(p, up) - shear * dot(p, forward)),
    };
  });
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const half =
    Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys)
    ) / 2 || 1;
  const at = (i: number) => ({
    x: (corners[i].x - cx) / half,
    y: (corners[i].y - cy) / half,
  });
  return CUBE_EDGES.map(([a, b]) => {
    const p = at(a);
    const q = at(b);
    return [p.x, p.y, q.x, q.y] as const;
  });
}
