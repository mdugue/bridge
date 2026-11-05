import { Vector4 } from "three/webgpu";
import type { UniformArrayNode, UniformNode, Vector3 } from "three/webgpu";
import {
  clamp,
  color,
  dot,
  exp,
  float,
  int,
  Loop,
  normalize,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  uniformArray,
} from "three/tsl";
import type { DeviceTier } from "./scene-profile";
import { sceneNight } from "./scene-environment";
import type { F, V3 } from "./shader-chunks";

/**
 * The street lamps mirrored in the river after dark: the light of the
 * lamps by the water as a broken column on the waves, from the water's
 * edge under the lamp toward the eye — what one sees across the Elbe from
 * the Neustadt at night. Not a mirror of the scene: the river stays matte
 * (water-layer.ts); only the lamps' points of light reach it, each a
 * specular lobe off the waves' normal.
 *
 * The physics, drawn: a lamp at L lights a water point P toward the eye
 * where the surface's normal there is the half-vector between P→L and
 * P→eye. The waves the sheet resolves (water-waves.ts) give the near
 * water its dashes; the ripples finer than a pixel, which the sheet lays
 * calm, are a spread of slopes (a Beckmann-like lobe, `SPREAD`), so far
 * off the dashes merge into a column. A grazing look stretches the lobe
 * toward the eye and the Fresnel term lights it most there: the column is
 * long and bright across the river, short and faint from the air.
 *
 * Which lamps: a fixed array, scene-wide like the water's clock, of the
 * lamps by the water (tile-stream.ts `lampsByWater`) nearest the eye in
 * front of it, chosen per frame on the CPU (`createLampReflections`). Its
 * length is fixed, a tier loops over its own share (`REFLECTED`), and a
 * lamp leaving the share fades out over a band before it goes, as the
 * real lights hand over (lamp-layer.ts). By day the count is 0.
 */

/** How far (m) from the water a lamp stands whose light the river
 *  mirrors: the Terrassenufer's quay, the Elbwiesen's paths. */
export const LAMP_WATER_REACH_M = 80;

/** How many lamps a tier mirrors at once, and the array's length. */
export const REFLECTED: Readonly<Record<DeviceTier, number>> = {
  desktop: 32,
  mobile: 12,
};
const MAX_REFLECTED = Math.max(REFLECTED.desktop, REFLECTED.mobile);

/** How far off (m) a lamp's reflection still shows, fading from the first. */
const REACH: [number, number] = [1200, 1600];
/** The share of the last lamp's distance over which a lamp leaving the
 *  set fades out (a hand-over band, not a pop). */
const HAND_OVER = 0.2;
/** A lamp this near (m) is mirrored whichever way the eye looks. */
const NEAR_ANY_WAY = 40;
/** How far to the side a lamp may stand (cos of its angle off the
 *  horizontal look) and still be mirrored, fading in from the first: a
 *  reflection lies between the eye and its lamp, so a lamp off screen
 *  leaves one off screen. */
const FRONT: [number, number] = [-0.05, 0.25];

/** The slope spread (rad, tan) of the ripples finer than a pixel: near
 *  (at a pixel's few centimetres) and far (metres a pixel). */
const SPREAD: [number, number] = [0.05, 0.13];
/** Metres a pixel over which the spread grows from near to far. */
const SPREAD_PX: [number, number] = [0.05, 2];
/** A column's brightness at its peak (emissive, × the lamps' colour). */
const REFLECTION = 2.4;
/** The faint wide lobe round the column: the lamps' halo on the water. */
const HALO = 0.12;
const HALO_SPREAD = 3;
/** Water's reflectance looking straight down (Schlick's F0). */
const F0 = 0.02;
/** The lamps' warm light (lamp-layer.ts `LAMP_LIGHT`). */
const LAMP_LIGHT = 0xff_d0_89;

/** The mirrored lamps' heads (world, Y-up; w: their fade 0…1). */
const reflectedHeads: UniformArrayNode<"vec4"> = uniformArray(
  Array.from({ length: MAX_REFLECTED }, () => new Vector4()),
  "vec4"
);
const reflectedCount: UniformNode<"int", number> = uniform(0, "int");

/**
 * The lamps' light the water at this fragment mirrors toward the eye
 * (emissive, linear): `n` the waves' normal (world, Y-up), `toEye` the
 * unit vector from the fragment to the eye, `px` metres a pixel there
 * (taken before: `fwidth` needs uniform control flow).
 */
export function lampReflections(n: V3, toEye: V3, px: F): V3 {
  const at = positionWorld.toVar();
  const normal = n.toVar();
  const eye = toEye.toVar();
  const spread = smoothstep(SPREAD_PX[0], SPREAD_PX[1], px)
    .mul(SPREAD[1] - SPREAD[0])
    .add(SPREAD[0])
    .toVar();
  const inv = float(1).div(spread.mul(spread)).toVar();
  const sum = float(0).toVar();
  Loop(
    { start: int(0), end: reflectedCount, type: "int", condition: "<" },
    ({ i }) => {
      const head = reflectedHeads.element(i);
      const toLamp = normalize(head.xyz.sub(at));
      const half = normalize(toLamp.add(eye));
      const c = clamp(dot(half, normal), 1e-3, 1);
      // tan² of the half-vector's tilt off the normal
      const t2 = float(1).sub(c.mul(c)).div(c.mul(c));
      const lobe = exp(t2.mul(inv).negate()).add(
        exp(
          t2
            .mul(inv)
            .div(HALO_SPREAD * HALO_SPREAD)
            .negate()
        ).mul(HALO)
      );
      const fresnel = pow(float(1).sub(clamp(dot(eye, half), 0, 1)), 5)
        .mul(1 - F0)
        .add(F0);
      // a lamp under the surface lights nothing on it
      const above = smoothstep(0, 0.5, head.y.sub(at.y));
      sum.addAssign(lobe.mul(fresnel).mul(above).mul(head.w));
    }
  );
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(REFLECTION));
}

/** The CPU half: picks the mirrored lamps each frame. */
export interface LampReflections {
  /** the heads by the water (tiles stream in and out) */
  setHeads: (heads: readonly Vector3[]) => void;
  setNightFactor: (t: number) => void;
  /** chooses the lamps for the eye at `eye` looking along `look` (world) */
  update: (eye: Vector3, look: Vector3) => void;
}

/**
 * Ranks `heads` for the eye at `eye` looking along `look`: the nearest
 * `most` within REACH in front of it (or near it), into `out` as
 * (x, y, z, fade); returns how many. The fade is the reach's, the side's,
 * and the hand-over's where more lamps were in reach than `most`. Pure:
 * the scratch arrays are at least `most + 1` long.
 */
export function rankReflected(
  heads: readonly Vector3[],
  eye: Vector3,
  look: Vector3,
  most: number,
  out: Vector4[],
  scratch: { idx: number[]; dist: number[]; front: number[] }
): number {
  const { idx, dist, front } = scratch;
  const slots = most + 1;
  idx.fill(-1, 0, slots);
  dist.fill(Number.POSITIVE_INFINITY, 0, slots);
  const lx = look.x;
  const lz = look.z;
  const ll = Math.hypot(lx, lz);
  // looking (nearly) straight down, every side is in front
  const anyWay = ll < 0.2;
  for (let i = 0; i < heads.length; i += 1) {
    const h = heads[i];
    const dx = h.x - eye.x;
    const dz = h.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (!(d < REACH[1]) || !(d < dist[slots - 1])) {
      continue;
    }
    const side =
      anyWay || d < NEAR_ANY_WAY ? 1 : (dx * lx + dz * lz) / (d * ll);
    if (side < FRONT[0]) {
      continue;
    }
    let s = slots - 1;
    while (s > 0 && d < dist[s - 1]) {
      idx[s] = idx[s - 1];
      dist[s] = dist[s - 1];
      front[s] = front[s - 1];
      s -= 1;
    }
    idx[s] = i;
    dist[s] = d;
    front[s] = side;
  }
  // the first lamp past the set: the ones as near as it fade out
  const cut = dist[most];
  let n = 0;
  for (let s = 0; s < most && idx[s] >= 0; s += 1) {
    const d = dist[s];
    const fade =
      (1 - smooth(REACH[0], REACH[1], d)) *
      smooth(FRONT[0], FRONT[1], front[s]) *
      (Number.isFinite(cut) ? smooth(cut, cut * (1 - HAND_OVER), d) : 1);
    const h = heads[idx[s]];
    out[n].set(h.x, h.y, h.z, fade);
    n += 1;
  }
  return n;
}

/** smoothstep(a, b, x), either way round. */
function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * The per-frame choice of the mirrored lamps for a tier (`REFLECTED`):
 * writes the shared array the water reads. Nothing by day.
 */
export function createLampReflections(tier: DeviceTier): LampReflections {
  const most = REFLECTED[tier];
  let heads: readonly Vector3[] = [];
  let night = 0;
  const scratch = {
    idx: Array.from({ length: most + 1 }, () => -1),
    dist: Array.from({ length: most + 1 }, () => Number.POSITIVE_INFINITY),
    front: Array.from({ length: most + 1 }, () => 0),
  };
  const out = reflectedHeads.array as Vector4[];
  return {
    setHeads: (next) => {
      heads = next;
    },
    setNightFactor: (t) => {
      night = t;
    },
    update: (eye, look) => {
      reflectedCount.value =
        night > 0.001 && heads.length > 0
          ? rankReflected(heads, eye, look, most, out, scratch)
          : 0;
    },
  };
}
