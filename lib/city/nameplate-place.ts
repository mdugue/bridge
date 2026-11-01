/**
 * Where the nameplate stands (app/_components/nameplate-layer.ts): a sign
 * of the building's, not a label of the screen. It snaps to one of the
 * building's main axes and turns only when the view along it grows too
 * flat; it looks for free sky or free ground beside the building, never
 * inside it, and keeps its place while that stays good.
 *
 * Four layings by where the camera is, in the building's size S (its
 * height, or half its width where that is more):
 *
 *   air     the camera higher than `AIR_HEIGHT` S above the building's
 *           top, or looking down on it steeper than `AIR_PITCH_DEG`, or
 *           Modell's parallel view: flat on the free ground beside it,
 *           along the axis nearest the screen's horizontal, never upside
 *           down — map lettering
 *   street  between: upright in the sky beside or above it, parallel to
 *           the facade that faces the camera most, a hairline down to an
 *           anchor on it
 *   near    nearer than `NEAR` S: an inscription in front of its plinth
 *   far     beyond `FAR` S: as `street`, the name alone
 *
 * A laying is entered at its threshold and left only past it moved by
 * `HYSTERESIS` (a band, so nothing flips at the line); the facade
 * only when the view along the current one is flatter than
 * `TURN_ANGLE_DEG`. Which candidate place: `chooseNameplate` (a few times
 * a second; it casts rays through `seen`), how large and where exactly:
 * `nameplatePose` (every frame, cheap). Positions are world space, Y up.
 * No THREE, no DOM.
 */

import { minimumRectangle } from "./open-roofs";

export type Vec3 = [number, number, number];

/** The building as the plate reads it: its footprint's minimum-area
 *  rectangle, its height span and its highest point. */
export interface NameplateBody {
  /** the rectangle's centre (x, z) */
  center: [number, number];
  /** the long axis (x, z), unit; `v` is it turned a quarter */
  u: [number, number];
  v: [number, number];
  /** half extents along u and v (m) */
  half: [number, number];
  /** lowest and highest y (m) */
  base: number;
  top: number;
  /** the highest vertex */
  peak: Vec3;
}

export type NameplateMode = "air" | "street" | "near" | "far";

/** One of the four facades: ±u (0, 2) or ±v (1, 3). */
export type NameplateSide = 0 | 1 | 2 | 3;

export type NameplateSpot = "above" | "right" | "left" | "front" | "back";

/** What `chooseNameplate` decides; what `nameplatePose` lays out. */
export interface NameplateLayout {
  mode: NameplateMode;
  side: NameplateSide;
  spot: NameplateSpot;
}

export interface NameplateCamera {
  /** the camera's position (a parallel camera's is far back) */
  position: Vec3;
  /** where it looks, unit */
  forward: Vec3;
  /** its right, unit */
  right: Vec3;
  /** Modell's parallel view */
  ortho: boolean;
  /** CSS px per metre at one metre's distance (perspective: the focal
   *  length in px), or per metre anywhere (parallel) */
  pxPerM: number;
}

/** The block of text, in cap heights: its width and its height (the title
 *  and the lines with their leading). */
export interface NameplateBlock {
  height: number;
  width: number;
}

/** How large the title's capitals show on screen (CSS px), by rank and
 *  device: the sign grows as one walks up to it, between these. */
export interface CapRange {
  max: number;
  min: number;
}

export interface NameplatePose {
  /** the leader's foot on the building (street, near: none on the ground) */
  anchor: Vec3 | null;
  /** the title's capital height (m) */
  cap: number;
  /** 0…1: the plate fades as the camera comes up against it */
  fade: number;
  /** the block's lower left corner */
  origin: Vec3;
  /** along the text, unit */
  right: Vec3;
  /** up the text, unit (in the plate's plane) */
  up: Vec3;
}

export const AIR_HEIGHT = 1.5;
export const AIR_PITCH_DEG = 35;
export const NEAR = 1;
export const FAR = 8;
export const HYSTERESIS = 0.2;
export const TURN_ANGLE_DEG = 25;
/** The title's capitals: this share of the footprint's long side (m),
 *  whichever side the plate is on (its size does not jump when the facade
 *  turns), then clamped on screen (`CapRange`). */
export const CAP_SHARE = 0.07;
/** Gaps between the plate and the building, in cap heights. */
const GAP_CAPS = 0.8;
/** How far in front of the facade the plate stands (m). */
const STAND_OFF_M = 1.5;
/** An inscription's foot above the ground (m). */
const NEAR_FOOT_M = 2.5;
/** The plate fades out this near (m) to its plane, and is gone nearer
 *  than `FADE_GONE_M`; an inscription, read close up, only as one walks
 *  into it. */
const FADE_FULL_M = 6;
const FADE_GONE_M = 4;
const NEAR_FADE_FULL_M = 2.5;
const NEAR_FADE_GONE_M = 1;
/** A ground plate floats this high (m): above the kerbs and markings. */
const GROUND_LIFT_M = 0.4;
/** A candidate's score: what it pays per share of the plate off screen,
 *  hidden, over the HUD, over its own building; and its place's own
 *  standing (the order a draw is broken in), and the kept place's bonus. */
const COST = {
  offscreen: 3,
  hidden: 2.5,
  hud: 2,
  overBody: 0.6,
  kept: 0.25,
} as const;
const SPOT_COST: Record<NameplateSpot, number> = {
  above: 0,
  right: 0.05,
  left: 0.08,
  front: 0,
  back: 0.1,
};
/** The screen's margin (NDC) a plate keeps clear of. */
const SCREEN_MARGIN = 0.92;

// --- small vector helpers ------------------------------------------------

export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const scale = (a: Vec3, s: number): Vec3 => [
  a[0] * s,
  a[1] * s,
  a[2] * s,
];
export const sub = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const dot = (a: Vec3, b: Vec3) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

// --- the body ------------------------------------------------------------

/** A footprint vertex's decimetre cell as one number (|x|, |z| < 50 km). */
const cellKey = (x: number, z: number) =>
  Math.round(x * 10) * 1_048_576 + Math.round(z * 10);

/**
 * The body from world-space triangle positions (x, y, z per vertex, as
 * the selection outline gets them): the footprint's minimum-area
 * rectangle (`minimumRectangle`), its long side `u`. Null for fewer than
 * three vertices.
 */
export function nameplateBody(positions: Float32Array): NameplateBody | null {
  const n = Math.floor(positions.length / 3);
  if (n < 3) {
    return null;
  }
  // the footprint on a decimetre grid: a landmark has many thousands of
  // vertices, most over the same few corners
  const seen = new Set<number>();
  const pts: [number, number][] = [];
  let base = Number.POSITIVE_INFINITY;
  let top = Number.NEGATIVE_INFINITY;
  let peak: Vec3 = [positions[0], positions[1], positions[2]];
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    base = Math.min(base, y);
    if (y > top) {
      top = y;
      peak = [x, y, z];
    }
    const key = cellKey(x, z);
    if (!seen.has(key)) {
      seen.add(key);
      pts.push([x, z]);
    }
  }
  const rect = minimumRectangle(pts);
  if (rect && rect.length > 1e-6) {
    return {
      center: [rect.centre[0], rect.centre[1]],
      u: [rect.u[0], rect.u[1]],
      v: [rect.v[0], rect.v[1]],
      half: [rect.length / 2, rect.width / 2],
      base,
      top,
      peak,
    };
  }
  // a single point or a line: a square metre round it
  const [x, z] = pts[0] ?? [peak[0], peak[2]];
  return {
    center: [x, z],
    u: [1, 0],
    v: [0, 1],
    half: [0.5, 0.5],
    base,
    top,
    peak,
  };
}

/** The building's size the layings are measured in (m). */
export function bodySize(body: NameplateBody): number {
  return Math.max(body.top - body.base, body.half[0], 4);
}

/** A side's outward normal (x, 0, z) and its half width along the facade,
 *  and the half depth to it from the centre. */
export function sideFrame(
  body: NameplateBody,
  side: NameplateSide
): { normal: Vec3; halfWidth: number; depth: number } {
  const axis = side % 2 === 0 ? body.u : body.v;
  const sign = side < 2 ? 1 : -1;
  return {
    normal: [axis[0] * sign, 0, axis[1] * sign],
    halfWidth: side % 2 === 0 ? body.half[1] : body.half[0],
    depth: side % 2 === 0 ? body.half[0] : body.half[1],
  };
}

const centre3 = (body: NameplateBody, y: number): Vec3 => [
  body.center[0],
  y,
  body.center[1],
];

// --- the laying ------------------------------------------------------------

/** The laying for this camera, kept within `HYSTERESIS` of its threshold. */
export function nameplateMode(
  body: NameplateBody,
  camera: NameplateCamera,
  previous: NameplateMode | null
): NameplateMode {
  if (camera.ortho) {
    return "air";
  }
  const s = bodySize(body);
  const mid = centre3(body, (body.base + body.top) / 2);
  const to = sub(mid, camera.position);
  const distance = Math.max(len(to), 1e-3);
  const pitch = (Math.asin(-to[1] / distance) * 180) / Math.PI;
  const above = (camera.position[1] - body.top) / s;
  // the way out of a laying is its threshold moved by the hysteresis
  const keep = (mode: NameplateMode, f: number) =>
    previous === mode ? 1 + f * HYSTERESIS : 1;
  if (
    above > AIR_HEIGHT * keep("air", -1) ||
    pitch > AIR_PITCH_DEG * keep("air", -1)
  ) {
    return "air";
  }
  const d = distance / s;
  if (d < NEAR * keep("near", 1)) {
    return "near";
  }
  if (d > FAR * keep("far", -1)) {
    return "far";
  }
  return "street";
}

/** The facade the camera sees best; the current one while its view stays
 *  steeper than `TURN_ANGLE_DEG`. */
export function nameplateSide(
  body: NameplateBody,
  camera: NameplateCamera,
  previous: NameplateSide | null,
  mode: NameplateMode = "street"
): NameplateSide {
  // from above, the side towards the screen's foot (cross(right, Y): it
  // holds looking straight down, too); else the side towards the camera
  const c = centre3(body, camera.position[1]);
  const to = sub(camera.position, c);
  const flat: Vec3 =
    mode === "air" ? [-camera.right[2], 0, camera.right[0]] : [to[0], 0, to[2]];
  const l = Math.max(len(flat), 1e-6);
  const facing = (side: NameplateSide) =>
    dot(sideFrame(body, side).normal, flat) / l;
  if (
    previous !== null &&
    facing(previous) > Math.sin((TURN_ANGLE_DEG * Math.PI) / 180)
  ) {
    return previous;
  }
  let best: NameplateSide = 0;
  for (const side of [1, 2, 3] as const) {
    if (facing(side) > facing(best)) {
      best = side;
    }
  }
  return best;
}

/** The ground plate's text direction: along the side the screen's foot
 *  faces (`nameplateSide`), reading left to right from there — a quarter
 *  turn only when that side changes, with its hysteresis. */
function groundRight(body: NameplateBody, side: NameplateSide): Vec3 {
  const n = sideFrame(body, side).normal;
  return [n[2], 0, -n[0]];
}

/** The ground plate's half extents of the body along its right and up. */
function groundExtents(
  body: NameplateBody,
  right: Vec3
): { along: number; across: number } {
  const onU = Math.abs(right[0] * body.u[0] + right[2] * body.u[1]) > 0.5;
  return onU
    ? { along: body.half[0], across: body.half[1] }
    : { along: body.half[1], across: body.half[0] };
}

/** The capital height (m) for a plate this far, clamped on screen. */
export function capHeight(
  body: NameplateBody,
  camera: NameplateCamera,
  at: Vec3,
  range: CapRange
): number {
  const width = 2 * Math.max(body.half[0], body.half[1]);
  const wanted = Math.max(width * CAP_SHARE, 0.3);
  const distance = camera.ortho
    ? 1
    : Math.max(dot(sub(at, camera.position), camera.forward), 0.5);
  const px = (wanted * camera.pxPerM) / distance;
  const clamped = Math.min(Math.max(px, range.min), range.max);
  return (clamped * distance) / camera.pxPerM;
}

export const NAMEPLATE_SPOTS: Record<NameplateMode, NameplateSpot[]> = {
  air: ["front", "right", "left", "back"],
  street: ["above", "right", "left"],
  near: ["front"],
  far: ["above", "right", "left"],
};

/**
 * The plate's pose for a layout: where its block's lower left corner is,
 * which way it reads, how large. `groundAt` is the ground's height under a
 * point (the ground plate lies on it).
 */
export function nameplatePose(
  body: NameplateBody,
  layout: NameplateLayout,
  camera: NameplateCamera,
  block: NameplateBlock,
  range: CapRange,
  groundAt: (x: number, z: number) => number
): NameplatePose {
  if (layout.mode === "air") {
    return groundPose(body, layout, camera, block, range, groundAt);
  }
  const { normal, halfWidth, depth } = sideFrame(body, layout.side);
  // the facade's right seen from outside: cross(Y, n)
  const r: Vec3 = [normal[2], 0, -normal[0]];
  const up: Vec3 = [0, 1, 0];
  const face = add(
    centre3(body, body.base),
    scale(normal, depth + STAND_OFF_M)
  );
  const probe = add(face, [0, (body.top - body.base) * 0.6, 0]);
  const cap = capHeight(body, camera, probe, range);
  const w = block.width * cap;
  // from far the block is the title alone (the layer lays it out so)
  const h = block.height * cap;
  const gap = GAP_CAPS * cap;
  const height = body.top - body.base;
  let origin: Vec3;
  let anchor: Vec3 | null = null;
  const spot = layout.mode === "near" ? "front" : layout.spot;
  switch (spot) {
    case "front":
    case "back": {
      origin = add(face, add(scale(r, -w / 2), [0, NEAR_FOOT_M, 0]));
      break;
    }
    case "above": {
      // over the highest point, as seen on this facade's plane
      const along = dot(sub(body.peak, face), r);
      const centreAlong = Math.max(Math.min(along, halfWidth), -halfWidth);
      origin = add(
        face,
        add(scale(r, centreAlong - w / 2), [0, height + gap, 0])
      );
      // the leader's foot: the top, on the plate's plane
      anchor = add(face, add(scale(r, centreAlong), [0, height, 0]));
      break;
    }
    case "right":
    case "left": {
      const sign = spot === "right" ? 1 : -1;
      const centreY = Math.max(height * 0.62, h / 2 + 2 * gap);
      const x = sign > 0 ? halfWidth + gap : -halfWidth - gap - w;
      origin = add(face, add(scale(r, x), [0, centreY - h / 2, 0]));
      // the leader: from the plate's inner foot down to the facade's edge
      const edgeY = Math.min(centreY - h / 2 - gap * 1.5, height);
      anchor = add(
        face,
        add(scale(r, sign * halfWidth), [0, Math.max(edgeY, height * 0.3), 0])
      );
      break;
    }
  }
  const camToPlane = Math.abs(dot(sub(camera.position, face), normal));
  return {
    origin,
    right: r,
    up,
    cap,
    anchor,
    fade:
      layout.mode === "near"
        ? smooth(NEAR_FADE_GONE_M, NEAR_FADE_FULL_M, camToPlane)
        : smooth(FADE_GONE_M, FADE_FULL_M, camToPlane),
  };
}

function groundPose(
  body: NameplateBody,
  { side, spot }: NameplateLayout,
  camera: NameplateCamera,
  block: NameplateBlock,
  range: CapRange,
  groundAt: (x: number, z: number) => number
): NameplatePose {
  const right = groundRight(body, side);
  // up the text on the ground: away from the camera, cross(Y, right)
  const up: Vec3 = [right[2], 0, -right[0]];
  const { along, across } = groundExtents(body, right);
  const c = centre3(body, body.base);
  const cap = capHeight(body, camera, c, range);
  const w = block.width * cap;
  const h = block.height * cap;
  const gap = GAP_CAPS * cap;
  let centre: Vec3;
  switch (spot) {
    case "back":
      centre = add(c, scale(up, across + gap + h / 2));
      break;
    case "right":
      centre = add(c, scale(right, along + gap + w / 2));
      break;
    case "left":
      centre = add(c, scale(right, -(along + gap + w / 2)));
      break;
    case "above":
    case "front":
      centre = add(c, scale(up, -(across + gap + h / 2)));
  }
  // over the highest ground under it, so no corner sinks into a slope
  // (a level sheet of lettering, not a part standing on the ground: it
  // joins nothing, ADR 0030)
  const y =
    highestGround(centre, right, up, w / 2, h / 2, groundAt) + GROUND_LIFT_M;
  const origin = add(
    [centre[0], y, centre[2]],
    add(scale(right, -w / 2), scale(up, -h / 2))
  );
  return { origin, right, up, cap, anchor: null, fade: 1 };
}

/** The ground's height at a rectangle's centre and corners, the highest. */
function highestGround(
  centre: Vec3,
  right: Vec3,
  up: Vec3,
  halfW: number,
  halfH: number,
  groundAt: (x: number, z: number) => number
): number {
  let top = groundAt(centre[0], centre[2]);
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const p = add(centre, add(scale(right, a * halfW), scale(up, b * halfH)));
    top = Math.max(top, groundAt(p[0], p[2]));
  }
  return top;
}

// --- choosing ----------------------------------------------------------------

/** What `chooseNameplate` asks of the scene. */
export interface NameplateScene {
  camera: NameplateCamera;
  /** a world point on screen: NDC (x, y in −1…1) and whether in front */
  project: (p: Vec3) => { x: number; y: number; front: boolean };
  /** the share (0…1) of these points the scene hides from the camera */
  hidden: (points: Vec3[]) => number;
  /** the HUD's panels over the canvas, as NDC boxes [x0, y0, x1, y1] */
  hud: readonly [number, number, number, number][];
  groundAt: (x: number, z: number) => number;
}

/** The plate's corners and a 3 × 3 grid of points on it. */
export function platePoints(
  pose: NameplatePose,
  block: NameplateBlock
): { corners: Vec3[]; grid: Vec3[] } {
  const w = block.width * pose.cap;
  const h = block.height * pose.cap;
  const at = (s: number, t: number) =>
    add(pose.origin, add(scale(pose.right, s * w), scale(pose.up, t * h)));
  const grid: Vec3[] = [];
  for (const s of [0.1, 0.5, 0.9]) {
    for (const t of [0.2, 0.5, 0.8]) {
      grid.push(at(s, t));
    }
  }
  return { corners: [at(0, 0), at(1, 0), at(1, 1), at(0, 1)], grid };
}

type Box = [number, number, number, number];

const boxOf = (pts: { x: number; y: number }[]): Box => [
  Math.min(...pts.map((p) => p.x)),
  Math.min(...pts.map((p) => p.y)),
  Math.max(...pts.map((p) => p.x)),
  Math.max(...pts.map((p) => p.y)),
];
const area = (b: Box) => Math.max(b[2] - b[0], 0) * Math.max(b[3] - b[1], 0);
const overlap = (a: Box, b: Box): number =>
  area([
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ]);

/** The body's box on screen. */
function bodyBox(body: NameplateBody, scene: NameplateScene): Box | null {
  const pts: { x: number; y: number }[] = [];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      for (const y of [body.base, body.top]) {
        const x =
          body.center[0] +
          body.u[0] * body.half[0] * su +
          body.v[0] * body.half[1] * sv;
        const z =
          body.center[1] +
          body.u[1] * body.half[0] * su +
          body.v[1] * body.half[1] * sv;
        const p = scene.project([x, y, z]);
        if (p.front) {
          pts.push(p);
        }
      }
    }
  }
  return pts.length > 0 ? boxOf(pts) : null;
}

/** A candidate's cost (lower is better); infinite where it cannot show. */
export function nameplateCost(
  body: NameplateBody,
  layout: NameplateLayout,
  previous: NameplateLayout | null,
  block: NameplateBlock,
  range: CapRange,
  scene: NameplateScene
): number {
  const pose = nameplatePose(
    body,
    layout,
    scene.camera,
    block,
    range,
    scene.groundAt
  );
  const { corners, grid } = platePoints(pose, block);
  const onScreen = corners.map(scene.project);
  if (onScreen.some((p) => !p.front)) {
    return Number.POSITIVE_INFINITY;
  }
  const box = boxOf(onScreen);
  const total = Math.max(area(box), 1e-9);
  const visible = overlap(box, [
    -SCREEN_MARGIN,
    -SCREEN_MARGIN,
    SCREEN_MARGIN,
    SCREEN_MARGIN,
  ]);
  let cost = COST.offscreen * (1 - visible / total);
  for (const panel of scene.hud) {
    cost += (COST.hud * overlap(box, panel)) / total;
  }
  const own = bodyBox(body, scene);
  if (own && layout.mode !== "air" && layout.spot !== "above") {
    cost += (COST.overBody * overlap(box, own)) / total;
  }
  cost += COST.hidden * scene.hidden(grid);
  cost += SPOT_COST[layout.spot];
  if (
    previous &&
    previous.mode === layout.mode &&
    previous.spot === layout.spot &&
    previous.side === layout.side
  ) {
    cost -= COST.kept;
  }
  return cost;
}

/** The best layout for the view: the laying (unless `mode` forces one),
 *  the facade, the place. */
export function chooseNameplate(
  body: NameplateBody,
  previous: NameplateLayout | null,
  block: NameplateBlock,
  range: CapRange,
  scene: NameplateScene,
  force?: NameplateMode
): NameplateLayout {
  const mode =
    force ?? nameplateMode(body, scene.camera, previous?.mode ?? null);
  const side = nameplateSide(body, scene.camera, previous?.side ?? null, mode);
  let best: NameplateLayout = { mode, side, spot: NAMEPLATE_SPOTS[mode][0] };
  let bestCost = Number.POSITIVE_INFINITY;
  for (const spot of NAMEPLATE_SPOTS[mode]) {
    const layout = { mode, side, spot };
    const cost = nameplateCost(body, layout, previous, block, range, scene);
    if (cost < bestCost) {
      best = layout;
      bestCost = cost;
    }
  }
  return best;
}

/** Whether two layouts are the same place (a change is a cross-fade). */
export function sameLayout(
  a: NameplateLayout | null,
  b: NameplateLayout | null
): boolean {
  return (
    a !== null &&
    b !== null &&
    a.mode === b.mode &&
    a.side === b.side &&
    a.spot === b.spot
  );
}
