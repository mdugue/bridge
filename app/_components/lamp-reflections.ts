import {
  AdditiveBlending,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector4,
} from "three/webgpu";
import type {
  InstancedInterleavedBuffer,
  UniformArrayNode,
  UniformNode,
  Vector3,
} from "three/webgpu";
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  float,
  Fn,
  fwidth,
  int,
  length,
  Loop,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  sqrt,
  step,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { outOfDesignSite } from "./design-site";
import { Instances } from "./instancing";
import { viewDirection } from "./view-direction";
import type { DeviceTier } from "./scene-profile";
import { drawnAtNight, sceneNight } from "./scene-environment";
import { dataXY } from "./shader-chunks";
import type { F, V2, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";
import { RIVER_WAVES, waveNormal, waves } from "./water-waves";
import { waterTime } from "./water-layer";

/**
 * The street lamps mirrored in the river and caught by the rails after
 * dark: the light of the lamps by the water as a broken column on the
 * waves, from the water's edge under the lamp toward the eye — what one
 * sees across the Elbe from the Neustadt at night. Not a mirror of the
 * scene: the river stays matte (water-layer.ts); only the lamps' points of
 * light reach it, each a specular lobe off the waves' normal.
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
 * Which lamps: those whose light reaches water within 300 m past the
 * buildings, as the bake found them (`w`, their water's level:
 * pipeline/bake/lamp_water.py) — the quay's and the bridges', the
 * Brühlsche Terrasse's over the quay, not a lane's behind the first row
 * of houses.
 *
 * Every such lamp has its own column (`buildLampMirrors`): a quad
 * on the water, one instance a lamp, laid in the vertex stage from the
 * lamp toward the eye over the stretch where the waves can tilt its light
 * there (`MIRROR_TILT`), and the lobe drawn on it per fragment, additive.
 * No budget and no choice: every lamp shows, whichever way one looks, and
 * what stands between the eye and the water (a quay wall, a bridge, a
 * house) hides the column by the depth test.
 *
 * The rails catch the lamps by the tracks the same way (`railGlints`):
 * polished steel, a wider lobe, a glint on the rail heads between the eye
 * and each lamp, stretched along the track at a grazing look. Those are a
 * fixed array, scene-wide, of the lamps by a track (tile-stream.ts
 * `lampsBy`) nearest the eye in each compass sector round it, chosen per
 * frame on the CPU (`createLampReflections`) — by the eye's place alone,
 * so a turn of the view never swaps a lamp. Its length is fixed, a tier
 * loops over its own share (`MirrorSet.slots`), and a lamp leaving the
 * share fades out over a band before it goes. By day the count is 0.
 */

/** How far (m) from a track a lamp stands whose light its rails catch: a
 *  pavement's lamps over a street's tram tracks, a platform's. */
export const LAMP_TRACK_REACH_M = 15;

/** One set of glinting lamps: its slots per tier, how far off (m) a
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

/** The lamps by the tracks: a rail's glint is a few pixels from 300 m. */
const TRACKS = mirrorSet({ desktop: 24, mobile: 8 }, [250, 400]);

/** How far off (m) a lamp's column on the water still shows, fading from
 *  the first, by tier: a phone draws the near river's columns only, each
 *  one more quad of overdraw. */
const WATER_REACH: Readonly<Record<DeviceTier, [number, number]>> = {
  desktop: [1200, 1600],
  mobile: [500, 700],
};
/** The tier's reach, set by `createLampReflections`. */
const waterReach = uniform(new Vector2(...WATER_REACH.desktop));
/** The share of the last lamp's distance over which a lamp leaving the
 *  set fades out (a hand-over band, not a pop). */
const HAND_OVER = 0.2;
/** …at most this many metres, so a row of lamps at one distance keeps
 *  all but its last few at full strength. */
const HAND_OVER_M = 40;
/** The slope spread (rad, tan) of the ripples finer than a pixel: near
 *  (at a pixel's few centimetres) and far (metres a pixel). */
const SPREAD: [number, number] = [0.035, 0.08];
/** Metres a pixel over which the spread grows from near to far. */
const SPREAD_PX: [number, number] = [0.05, 2];
/** A column's brightness at its peak (emissive, × the lamps' colour). */
const REFLECTION = 1.2;
/** The faint wide lobe round the column: the lamps' halo on the water. */
const HALO = 0.02;
const HALO_SPREAD = 3;
/** Water's reflectance looking straight down (Schlick's F0). */
const WATER_F0 = 0.02;
/** The most a facet tilts the lamp's light toward the eye (tan): the
 *  resolved waves' steepest slope with the halo's two spreads past it.
 *  A column's quad reaches as far as this lets the light; past it the
 *  lobe is nil. */
const MIRROR_TILT = 0.55;
/** A column's quad's widest half-width (m): a lamp seen from the air. */
const MIRROR_HALF_MAX = 40;
/** The quad's lift over the water (m): above the sheet's own unevenness,
 *  which shares the terrain's grid. */
const MIRROR_LIFT = 0.25;
/** The bisection's steps for a column's ends (each halves the span). */
const ENDS_STEPS = 12;
/** A rail head's spread of normals (tan): worn steel, crowned across. */
const RAIL_SPREAD = 0.18;
/** A rail's glint at its peak (emissive), and steel's reflectance. */
const RAIL_GLINT = 1.2;
const STEEL_F0 = 0.5;
/** The lamps' warm light (lamp-layer.ts `LAMP_LIGHT`). */
const LAMP_LIGHT = 0xff_d0_89;

/** The lobe of a light from `toLamp` toward `toEye` off `n`: the tan² of
 *  the half-vector's tilt over the spread's (`inv` = 1/spread²), a halo
 *  `halo` times as wide at `haloShare`, Schlick's Fresnel from `f0`. */
function lobe(
  toLamp: V3,
  toEye: V3,
  n: V3,
  inv: F,
  look: { f0: number; halo: number; haloShare: number }
): F {
  const half = normalize(toLamp.add(toEye));
  const c = clamp(dot(half, n), 1e-3, 1);
  const t2 = float(1).sub(c.mul(c)).div(c.mul(c)).mul(inv);
  // the halo only where a set has one: none costs nothing per lamp
  const core =
    look.haloShare > 0
      ? exp(t2.negate()).add(
          exp(t2.div(look.halo * look.halo).negate()).mul(look.haloShare)
        )
      : exp(t2.negate());
  const fresnel = pow(float(1).sub(clamp(dot(toEye, half), 0, 1)), 5)
    .mul(1 - look.f0)
    .add(look.f0);
  return core.mul(fresnel);
}

/**
 * The summed lobes of a set's lamps at this fragment, each lamp's
 * half-vector with the eye against `normal` at a spread `spread` (tan).
 * Everything the loop reads is taken into a variable before it.
 */
function lobes(
  set: MirrorSet,
  normal: V3,
  toEye: V3,
  spread: F,
  look: { f0: number; halo: number; haloShare: number }
): F {
  // A Loop builds into the stack of the Fn it is called in: outside one
  // it never reaches the graph, and the sum stays 0.
  return Fn(() => {
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
        // a lamp below the surface lights nothing on it
        const above = smoothstep(0, 0.5, head.y.sub(at.y));
        sum.addAssign(lobe(toLamp, eye, n, inv, look).mul(above).mul(head.w));
      }
    );
    return sum;
  })();
}

/**
 * The lamps' light a rail head at this fragment catches toward the eye
 * (emissive, linear): a glint on the steel between the eye and each lamp
 * by the track, stretched along the rails at a grazing look — the shine a
 * track takes on under the street lamps at night. `n` the surface's
 * normal (world), `toEye` the unit vector from the fragment to the eye.
 */
export function railGlints(n: V3, toEye: V3): V3 {
  const sum = lobes(TRACKS, n, toEye, float(RAIL_SPREAD), {
    f0: STEEL_F0,
    halo: 1,
    haloShare: 0,
  });
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(RAIL_GLINT));
}

/** A lamp the river mirrors: its head (world, Y-up) and the level (world
 *  Y) of the water under its light. */
export interface LampMirror {
  head: Vector3;
  level: number;
}

/** The mirrored lamp's head (world) and its water's level, as the
 *  instance carries them: the head in the halo's matrix's translation,
 *  the level in its bottom row's first entry (`LEVEL_ENTRY`), which an
 *  affine matrix leaves 0 and the halo, a point, never reads. */
const mirrorHead = (): V3 => attribute("iMat3", "vec4").xyz;
const mirrorLevel = (): F => attribute("iMat0", "vec4").w.add(MIRROR_LIFT);
/** The level's entry in a matrix (column-major: column 0, row 3). */
const LEVEL_ENTRY = 3;

/**
 * A column's place on the water, in the vertical plane through the lamp
 * and the eye: `u` metres from the lamp's foot toward the eye's, `d` the
 * feet's distance apart, `hl` and `he` the lamp's and the eye's height
 * over the water. `tilt(u)`: how far (rad, twice the facet's tilt) the
 * light there misses the eye — positive toward the lamp, 0 at the
 * mirror point, negative toward the eye; it falls monotonically along.
 */
const tilt = (u: F, d: F, hl: F, he: F): F =>
  atan(hl, u).sub(atan(he, d.sub(u)));

/** The `u` on (0, d) where `tilt` is `target` (a bisection). */
function tiltAt(target: number, d: F, hl: F, he: F): F {
  let lo: F = float(0).toVar();
  let hi: F = d.toVar();
  for (let i = 0; i < ENDS_STEPS; i += 1) {
    const mid = lo.add(hi).mul(0.5).toVar();
    // still short of the target: the end lies on toward the eye
    const on = step(target, tilt(mid, d, hl, he));
    lo = mix(lo, mid, on).toVar();
    hi = mix(mid, hi, on).toVar();
  }
  return lo.add(hi).mul(0.5);
}

/** A column's half-width (m) at `u` along: how far across the light may
 *  stray before the facets that send it to the eye tilt past
 *  `MIRROR_TILT` — narrow at a grazing look, wide from above. */
function halfWidth(u: F, d: F, hl: F, he: F): F {
  const v = d.sub(u);
  const dl = sqrt(u.mul(u).add(hl.mul(hl)));
  const de = sqrt(v.mul(v).add(he.mul(he)));
  // the half-vector's rise, and its turn across per metre
  const rise = hl.div(dl).add(he.div(de));
  const turn = u.div(dl.mul(dl)).add(v.div(de.mul(de)));
  return clamp(rise.mul(MIRROR_TILT).div(max(turn, 1e-4)), 0, MIRROR_HALF_MAX);
}

/**
 * The column's quad, in the vertex stage: the plane's corner (±1 along,
 * ±1 across) laid on the water from where the lamp's light first reaches
 * the eye on the waves to where it last does, as wide as it strays; a
 * lamp too far, or an eye under its water, folds it to nothing.
 */
const mirrorQuad = Fn(() => {
  const head = mirrorHead().toVar();
  const level = mirrorLevel().toVar();
  const eye = cameraPosition.toVar();
  const hl = max(head.y.sub(level), 0.05).toVar();
  const he = max(eye.y.sub(level), 0.05).toVar();
  const flat = eye.xz.sub(head.xz).toVar();
  const d = max(length(flat), 0.01).toVar();
  const along = flat.div(d).toVar();
  const across = vec2(along.y.negate(), along.x);
  const near = tiltAt(Math.atan(MIRROR_TILT) * 2, d, hl, he).toVar();
  const far = tiltAt(-Math.atan(MIRROR_TILT) * 2, d, hl, he).toVar();
  const mid = tiltAt(0, d, hl, he);
  const half = max(
    max(halfWidth(near, d, hl, he), halfWidth(far, d, hl, he)),
    halfWidth(mid, d, hl, he)
  );
  const corner = positionLocal.xy.mul(2);
  const u = mix(near, far, step(0, corner.y));
  // the eye over the water and the lamp within reach: else a point
  const shown = step(0.2, eye.y.sub(level)).mul(
    step(length(eye.sub(head)), waterReach.y)
  );
  const xz = head.xz
    .add(along.mul(u))
    .add(across.mul(half.mul(corner.x)))
    .mul(shown)
    .add(head.xz.mul(shown.oneMinus()));
  // a planner's design over the site folds it into the lamp's foot, as
  // the halo (instancing.ts `instancePosition`)
  return outOfDesignSite(vec3(xz.x, level, xz.y), vec3(head.x, level, head.z));
});

/**
 * The column's light at this fragment (linear, × the lamps' colour): the
 * lamp's lobe off the waves' normal there — the sheet's own waves on its
 * own clock, so the dashes lie on its crests — faded toward the quad's
 * rim and with the lamp's distance, by night only.
 */
function mirrorLight(): V3 {
  const xy = dataXY();
  // the pixel's footprint, before the waves (fwidth needs uniform flow)
  const fw: V2 = fwidth(xy);
  const px = max(fw.x, fw.y);
  const spread = smoothstep(SPREAD_PX[0], SPREAD_PX[1], px)
    .mul(SPREAD[1] - SPREAD[0])
    .add(SPREAD[0]);
  const n = waveNormal(waves(xy, waterTime, RIVER_WAVES).slope);
  const head = mirrorHead();
  const toLamp = normalize(head.sub(positionWorld));
  const toEye = viewDirection().negate();
  const light = lobe(toLamp, toEye, n, float(1).div(spread.mul(spread)), {
    f0: WATER_F0,
    halo: HALO_SPREAD,
    haloShare: HALO,
  });
  // the quad's rim, where the lobe is nearly nil, eased to none
  const rim = uv().sub(0.5).mul(2);
  const inside = smoothstep(1, 0.7, abs(rim.x)).mul(
    smoothstep(1, 0.7, abs(rim.y))
  );
  const far = smoothstep(
    waterReach.x,
    waterReach.y,
    length(cameraPosition.sub(head))
  ).oneMinus();
  return color(LAMP_LIGHT).mul(
    light.mul(inside).mul(far).mul(sceneNight).mul(REFLECTION)
  );
}

/**
 * One tile's lamps mirrored in the river: a quad an instance, laid and lit
 * on the GPU each frame. It shares the halos' matrices (lamp-layer.ts
 * `buildGlow`, the mirrored heads first): its own are the first
 * `mirrors.length`, each water level written into its matrix's
 * `LEVEL_ENTRY` here, so a column costs no memory of its own. Drawn by
 * night only, after the water (additive, no depth write); not culled by
 * its own bounds, since a column lies toward the eye, not where the lamps
 * are (it goes with its tile's dressing, as the halos do).
 */
export function buildLampMirrors(
  matrices: InstancedInterleavedBuffer,
  mirrors: readonly LampMirror[]
): Instances {
  const geo = new PlaneGeometry(1, 1);
  geo.deleteAttribute("normal");
  const mat = sceneMaterial("lamp-mirror", () => {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    m.positionNode = mirrorQuad();
    m.colorNode = vec4(mirrorLight(), 1);
    return drawnAtNight(m);
  });
  for (let i = 0; i < mirrors.length; i += 1) {
    matrices.array[i * matrices.stride + LEVEL_ENTRY] = mirrors[i].level;
  }
  matrices.needsUpdate = true;
  const mesh = new Instances(geo, mat, mirrors.length, matrices);
  mesh.name = "lamp-mirrors";
  mesh.frustumCulled = false;
  // after the water (water-layer.ts: 2)
  mesh.renderOrder = 3;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** The rails' CPU half: picks their glinting lamps each frame. */
export interface LampReflections {
  /** the heads by the tracks (tiles stream in and out) */
  setHeads: (tracks: readonly Vector3[]) => void;
  setNightFactor: (t: number) => void;
  /** chooses the lamps for the eye at `eye` (world) */
  update: (eye: Vector3) => void;
  /** empties the shared arrays: the next page's scene starts with none */
  dispose: () => void;
}

/** The compass sectors round the eye (by the lamps' bearing from it),
 *  each keeping its own share of the slots: the lamps along a street's
 *  tracks glint all round, not only on its nearest stretch. Fixed to the
 *  world, not to the look: turning the eye changes no lamp, only walking
 *  does, and then through the hand-over's fade. As many sectors as slots,
 *  at most this many (15° each): one lamp a sector. */
const MAX_SECTORS = 24;

/** A tier's sectors for `most` slots. */
const sectorsFor = (most: number) => Math.max(1, Math.min(most, MAX_SECTORS));

/** Scratch for `rankReflected`: one entry per head that is a candidate. */
export interface RankScratch {
  /** candidates' head indices, distances and sectors */
  idx: number[];
  dist: number[];
  sector: number[];
  /** the sectors' kept counts and cut distances */
  kept: number[];
  cut: number[];
  /** the candidates nearest first, and those kept */
  order: number[];
  chosen: number[];
}

export function rankScratch(): RankScratch {
  return {
    idx: [],
    dist: [],
    sector: [],
    kept: Array.from({ length: MAX_SECTORS }, () => 0),
    cut: Array.from({ length: MAX_SECTORS }, () => Number.POSITIVE_INFINITY),
    order: [],
    chosen: [],
  };
}

/**
 * Ranks `heads` for the eye at `eye`: per compass sector round it
 * (`sectorsFor`) its nearest share of `most` within `reach` (m; fading from
 * its first), into `out` as (x, y, z, fade); returns how many. The fade is
 * the reach's and the hand-over's toward the sector's first lamp left out.
 * The look plays no part, so a turn of the eye swaps no lamp.
 */
export function rankReflected(
  heads: readonly Vector3[],
  eye: Vector3,
  pick: { most: number; reach: readonly [number, number] },
  out: Vector4[],
  scratch: RankScratch
): number {
  const { most, reach } = pick;
  const { idx, dist, sector, kept, cut, order, chosen } = scratch;
  const sectors = sectorsFor(most);
  idx.length = 0;
  order.length = 0;
  chosen.length = 0;
  dist.length = 0;
  sector.length = 0;
  kept.fill(0);
  cut.fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < heads.length; i += 1) {
    const h = heads[i];
    const dx = h.x - eye.x;
    const dz = h.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (!(d < reach[1])) {
      continue;
    }
    // the bearing round the eye, 0 … 2π (the sector)
    const bearing = Math.atan2(dx, -dz) + Math.PI;
    order.push(idx.length);
    idx.push(i);
    dist.push(d);
    sector.push(
      Math.min(sectors - 1, Math.floor((bearing / (2 * Math.PI)) * sectors))
    );
  }
  // nearest first; each sector keeps its share, the first it leaves out
  // its cut
  order.sort((a, b) => dist[a] - dist[b]);
  const share = Math.max(1, Math.floor(most / sectors));
  for (const k of order) {
    const s = sector[k];
    if (kept[s] < share) {
      kept[s] += 1;
      chosen.push(k);
    } else if (!Number.isFinite(cut[s])) {
      cut[s] = dist[k];
    }
  }
  let n = 0;
  for (const k of chosen) {
    const d = dist[k];
    const c = cut[sector[k]];
    const fade =
      (1 - smooth(reach[0], reach[1], d)) *
      (Number.isFinite(c)
        ? smooth(c, c - Math.min(c * HAND_OVER, HAND_OVER_M), d)
        : 1);
    if (fade <= 0) {
      continue;
    }
    const h = heads[idx[k]];
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
  const scratch = rankScratch();
  const out = set.heads.array as Vector4[];
  const pick = { most, reach: set.reach };
  return (heads: readonly Vector3[], eye: Vector3) => {
    set.count.value =
      heads.length > 0 ? rankReflected(heads, eye, pick, out, scratch) : 0;
  };
}

/**
 * The per-frame choice of the mirrored lamps for a tier: writes the shared
 * array the rails read. Nothing by day.
 */
export function createLampReflections(tier: DeviceTier): LampReflections {
  let heads: readonly Vector3[] = [];
  let night = 0;
  const tracks = chooser(TRACKS, tier);
  waterReach.value.set(...WATER_REACH[tier]);
  const none: readonly Vector3[] = [];
  return {
    setHeads: (next) => {
      heads = next;
    },
    setNightFactor: (t) => {
      night = t;
    },
    update: (eye) => {
      const lit = night > 0.001;
      tracks(lit ? heads : none, eye);
    },
    dispose: () => {
      TRACKS.count.value = 0;
      heads = [];
    },
  };
}
