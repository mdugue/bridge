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
 * The street lamps mirrored in the river and caught by the rails after
 * dark: the light of the
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
 * The rails catch the lamps by the tracks the same way (`railGlints`):
 * polished steel, a wider lobe, a glint on the rail heads between the eye
 * and each lamp, stretched along the track at a grazing look.
 *
 * Which lamps: per set a fixed array, scene-wide like the water's clock,
 * of the lamps by the water or by a track (tile-stream.ts `lampsBy`)
 * nearest the eye in front of it, chosen per frame on the CPU
 * (`createLampReflections`). Its length is fixed, a tier loops over its
 * own share (`MirrorSet.slots`), and a lamp leaving the share fades out
 * over a band before it goes, as the real lights hand over
 * (lamp-layer.ts). By day the counts are 0.
 */

/** How far (m) from the water a lamp stands whose light the river
 *  mirrors: the Terrassenufer's quay, the Elbwiesen's paths. */
export const LAMP_WATER_REACH_M = 80;
/** How far (m) from a track a lamp stands whose light its rails catch: a
 *  pavement's lamps over a street's tram tracks, a platform's. */
export const LAMP_TRACK_REACH_M = 15;

/** One set of mirrored lamps: its slots per tier, how far off (m) a
 *  lamp still shows (fading from the first), and the shared array. */
interface MirrorSet {
  count: UniformNode<"int", number>;
  heads: UniformArrayNode<"vec4">;
  reach: readonly [number, number];
  slots: Readonly<Record<DeviceTier, number>>;
}

function mirrorSet(
  slots: Record<DeviceTier, number>,
  reach: [number, number]
): MirrorSet {
  return {
    slots,
    reach,
    count: uniform(0, "int"),
    // the heads (world, Y-up; w: their fade 0…1)
    heads: uniformArray(
      Array.from(
        { length: Math.max(slots.desktop, slots.mobile) },
        () => new Vector4()
      ),
      "vec4"
    ),
  };
}

/** The lamps by the water: seen across the river, so far off too. */
const WATER = mirrorSet({ desktop: 32, mobile: 12 }, [1200, 1600]);
/** The lamps by the tracks: a rail's glint is a few pixels from 300 m. */
const TRACKS = mirrorSet({ desktop: 24, mobile: 8 }, [250, 400]);

/** The share of the last lamp's distance over which a lamp leaving the
 *  set fades out (a hand-over band, not a pop). */
const HAND_OVER = 0.2;
/** …at most this many metres, so a row of lamps at one distance keeps
 *  all but its last few at full strength. */
const HAND_OVER_M = 40;
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
const WATER_F0 = 0.02;
/** A rail head's spread of normals (tan): worn steel, crowned across. */
const RAIL_SPREAD = 0.18;
/** A rail's glint at its peak (emissive), and steel's reflectance. */
const RAIL_GLINT = 1.2;
const STEEL_F0 = 0.5;
/** The lamps' warm light (lamp-layer.ts `LAMP_LIGHT`). */
const LAMP_LIGHT = 0xff_d0_89;

/**
 * The summed lobes of a set's lamps at this fragment: each lamp's
 * half-vector with the eye against `normal`, a spread `spread` (tan), a
 * halo `halo` times as wide at `haloShare`, Schlick's Fresnel from `f0`.
 * Everything the loop reads is taken into a variable before it.
 */
function lobes(
  set: MirrorSet,
  normal: V3,
  toEye: V3,
  spread: F,
  look: { f0: number; halo: number; haloShare: number }
): F {
  const at = positionWorld.toVar();
  const n = normal.toVar();
  const eye = toEye.toVar();
  const inv = float(1).div(spread.mul(spread)).toVar();
  const sum = float(0).toVar();
  Loop(
    { start: int(0), end: set.count, type: "int", condition: "<" },
    ({ i }) => {
      const head = set.heads.element(i);
      const toLamp = normalize(head.xyz.sub(at));
      const half = normalize(toLamp.add(eye));
      const c = clamp(dot(half, n), 1e-3, 1);
      // tan² of the half-vector's tilt off the normal
      const t2 = float(1).sub(c.mul(c)).div(c.mul(c)).mul(inv);
      // the halo only where a set has one: none costs nothing per lamp
      const lobe =
        look.haloShare > 0
          ? exp(t2.negate()).add(
              exp(t2.div(look.halo * look.halo).negate()).mul(look.haloShare)
            )
          : exp(t2.negate());
      const fresnel = pow(float(1).sub(clamp(dot(eye, half), 0, 1)), 5)
        .mul(1 - look.f0)
        .add(look.f0);
      // a lamp below the surface lights nothing on it
      const above = smoothstep(0, 0.5, head.y.sub(at.y));
      sum.addAssign(lobe.mul(fresnel).mul(above).mul(head.w));
    }
  );
  return sum;
}

/**
 * The lamps' light the water at this fragment mirrors toward the eye
 * (emissive, linear): `n` the waves' normal (world, Y-up), `toEye` the
 * unit vector from the fragment to the eye, `px` metres a pixel there
 * (taken before: `fwidth` needs uniform control flow).
 */
export function lampReflections(n: V3, toEye: V3, px: F): V3 {
  const spread = smoothstep(SPREAD_PX[0], SPREAD_PX[1], px)
    .mul(SPREAD[1] - SPREAD[0])
    .add(SPREAD[0]);
  const sum = lobes(WATER, n, toEye, spread, {
    f0: WATER_F0,
    halo: HALO_SPREAD,
    haloShare: HALO,
  });
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(REFLECTION));
}

/**
 * The lamps' light a rail head at this fragment catches toward the eye
 * (emissive, linear): a glint on the steel between the eye and each lamp
 * by the track, stretched along the rails at a grazing look — the shine a
 * track takes on under the street lamps at night. `n` the surface's
 * normal (world), `toEye` as for the water.
 */
export function railGlints(n: V3, toEye: V3): V3 {
  const sum = lobes(TRACKS, n, toEye, float(RAIL_SPREAD), {
    f0: STEEL_F0,
    halo: 1,
    haloShare: 0,
  });
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(RAIL_GLINT));
}

/** The CPU half: picks the mirrored lamps each frame. */
export interface LampReflections {
  /** the heads by the water and by the tracks (tiles stream in and out) */
  setHeads: (heads: {
    tracks: readonly Vector3[];
    water: readonly Vector3[];
  }) => void;
  setNightFactor: (t: number) => void;
  /** chooses the lamps for the eye at `eye` looking along `look` (world) */
  update: (eye: Vector3, look: Vector3) => void;
  /** empties the shared arrays: the next page's scene starts with none */
  dispose: () => void;
}

/**
 * Ranks `heads` for the eye at `eye` looking along `look`: the nearest
 * `most` within `reach` (m; fading from its first) in front of the eye (or
 * near it), into `out` as (x, y, z, fade); returns how many. The fade is
 * the reach's, the side's, and the hand-over's where more lamps were in
 * reach than `most`. Pure: the scratch arrays are at least `most + 1` long.
 */
export function rankReflected(
  heads: readonly Vector3[],
  view: { eye: Vector3; look: Vector3 },
  pick: { most: number; reach: readonly [number, number] },
  out: Vector4[],
  scratch: { idx: number[]; dist: number[]; front: number[] }
): number {
  const { eye, look } = view;
  const { most, reach } = pick;
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
    if (!(d < reach[1]) || !(d < dist[slots - 1])) {
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
      (1 - smooth(reach[0], reach[1], d)) *
      smooth(FRONT[0], FRONT[1], front[s]) *
      (Number.isFinite(cut)
        ? smooth(cut, cut - Math.min(cut * HAND_OVER, HAND_OVER_M), d)
        : 1);
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

/** A set's per-frame choice for a tier: what it keeps between frames. */
function chooser(set: MirrorSet, tier: DeviceTier) {
  const most = set.slots[tier];
  const scratch = {
    idx: Array.from({ length: most + 1 }, () => -1),
    dist: Array.from({ length: most + 1 }, () => Number.POSITIVE_INFINITY),
    front: Array.from({ length: most + 1 }, () => 0),
  };
  const out = set.heads.array as Vector4[];
  const pick = { most, reach: set.reach };
  return (heads: readonly Vector3[], view: { eye: Vector3; look: Vector3 }) => {
    set.count.value =
      heads.length > 0 ? rankReflected(heads, view, pick, out, scratch) : 0;
  };
}

/**
 * The per-frame choice of the mirrored lamps for a tier: writes the shared
 * arrays the water and the rails read. Nothing by day.
 */
export function createLampReflections(tier: DeviceTier): LampReflections {
  let heads: { tracks: readonly Vector3[]; water: readonly Vector3[] } = {
    tracks: [],
    water: [],
  };
  let night = 0;
  const water = chooser(WATER, tier);
  const tracks = chooser(TRACKS, tier);
  const none: readonly Vector3[] = [];
  return {
    setHeads: (next) => {
      heads = next;
    },
    setNightFactor: (t) => {
      night = t;
    },
    update: (eye, look) => {
      const lit = night > 0.001;
      const view = { eye, look };
      water(lit ? heads.water : none, view);
      tracks(lit ? heads.tracks : none, view);
    },
    dispose: () => {
      WATER.count.value = 0;
      TRACKS.count.value = 0;
      heads = { tracks: [], water: [] };
    },
  };
}
