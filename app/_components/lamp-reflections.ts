import {
  AdditiveBlending,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import type {
  InstancedInterleavedBuffer,
  UniformArrayNode,
  UniformNode,
} from "three/webgpu";
import {
  abs,
  atan,
  attribute,
  cameraPosition,
  distance,
  clamp,
  color,
  dot,
  exp,
  float,
  floor,
  Fn,
  fwidth,
  int,
  length,
  Loop,
  max,
  min,
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
 * `lampsBy`) nearest the eye, chosen per frame on the CPU
 * (`createLampReflections`) — by the eye's place alone, so a turn of the
 * view never swaps a lamp. Its length is fixed, a tier loops over its own
 * share (`MirrorSet.slots`), and each kept lamp fades to nothing toward
 * the first one left out, so walking hands lamps over without a jump. By
 * day the count is 0.
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
const TRACKS = mirrorSet({ desktop: 64, mobile: 16 }, [250, 400]);

/** Every lamp nearest the eye, whose light the house fronts and a
 *  fountain's water take (`streetLight`, `streetGlints`): about the
 *  streets within 150 m on a desktop, the next few on a phone, each one
 *  more step of a loop over every lit wall pixel. */
const STREET = mirrorSet({ desktop: 48, mobile: 12 }, [150, 260]);

/** A street lamp's light (cd at full night) and its reach (m): the real
 *  lights' (lamp-layer.ts `createLampLights`), which `streetLight`
 *  draws on as three draws a point light. */
export const LAMP_CD = 14;
export const LAMP_RANGE_M = 40;
/** A street lamp's cone round the plumb line (three's SpotLight `angle`,
 *  rad, and `penumbra`): its shade throws the light onto the street, full
 *  within about 42° of straight down and gone by 85°, so a house front is
 *  lit at its foot near the lamp and dark from about the lamp's height up
 *  — not to its eaves, as a bare bulb would light it. */
export const LAMP_CONE = {
  angle: (85 * Math.PI) / 180,
  penumbra: 0.5,
} as const;
/** The cone's cosines as three's spot falloff reads them: its edge's and
 *  its full light's. */
const CONE_COS = Math.cos(LAMP_CONE.angle);
const FULL_COS = Math.cos(LAMP_CONE.angle * (1 - LAMP_CONE.penumbra));

/** How far off (m) a lamp's column on the water still shows, fading from
 *  the first, by tier: a phone draws the near river's columns only, each
 *  one more quad of overdraw. */
const WATER_REACH: Readonly<Record<DeviceTier, [number, number]>> = {
  desktop: [1200, 1600],
  mobile: [500, 700],
};
/** The tier's reach, set by `createLampReflections`. */
const waterReach = uniform(new Vector2(...WATER_REACH.desktop));
/** The share of the cut's distance (the first lamp left out) over
 *  which the kept lamps fade to nothing toward it. */
const HAND_OVER = 0.35;
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
/** A basin's ripples' spread of normals (tan) and a lamp's glint on
 *  them at its peak (emissive). */
const BASIN_SPREAD = 0.12;
const BASIN_GLINT = 1.2;
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

/**
 * The street lamps' light on a surface at this fragment (linear, × its
 * albedo; a Lambertian surface's light as three draws the real lamps'
 * spot lights — `LAMP_CD` over the distance squared, cut off at
 * `LAMP_RANGE_M`, in the cone `LAMP_CONE` — so it hands over to the real
 * lights near the eye unseen): what lights a house
 * front after dark, from every lamp near the eye (`STREET`), each less the
 * share a real light already gives it (`createLampReflections`). Facing
 * the lamp, lit; turned away, not; nothing blocks it, as nothing blocks
 * a real light without its shadow. `n` the surface's normal (world).
 */
export function streetLight(n: V3): V3 {
  const sum = Fn(() => {
    const at = positionWorld.toVar();
    const normal = n.toVar();
    const total = float(0).toVar();
    // No lamp of the set (within its reach of the eye, on the ground
    // plan) lights a surface a lamp's range beyond that: the far city,
    // most of a view's pixels, runs the loop not at all.
    const near = step(
      distance(at.xz, cameraPosition.xz),
      STREET.reach[1] + LAMP_RANGE_M
    );
    Loop(
      {
        start: int(0),
        end: int(float(STREET.count).mul(near)),
        type: "int",
        condition: "<",
      },
      ({ i }) => {
        const head = STREET.heads.element(i);
        const to = head.xyz.sub(at);
        const d2 = max(dot(to, to), 0.01);
        const l = to.mul(d2.inverseSqrt());
        const facing = max(dot(normal, l), 0);
        // three's range window: (1 − (d/range)⁴)², over d²
        const r2 = d2.div(LAMP_RANGE_M * LAMP_RANGE_M);
        const window = max(float(1).sub(r2.mul(r2)), 0);
        // the cone: the lamp's plumb line against the way to the surface
        const down = smoothstep(CONE_COS, FULL_COS, l.y);
        total.addAssign(
          facing.mul(window.mul(window)).div(d2).mul(down).mul(head.w)
        );
      }
    );
    return total;
  })();
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(LAMP_CD / Math.PI));
}

/**
 * The street lamps caught by a fountain's water at this fragment
 * (emissive, linear): each lamp near the eye (`STREET`) a glint on the
 * ripples between the eye and the lamp, as the river takes its quay's
 * lamps (`buildLampMirrors`) and the rails theirs (`railGlints`). `n` the
 * water's normal (world), `toEye` the unit vector to the eye.
 */
export function streetGlints(n: V3, toEye: V3): V3 {
  // no halo: from many lamps round a square it summed to a silver sheen
  const sum = lobes(STREET, n, toEye, float(BASIN_SPREAD), {
    f0: WATER_F0,
    halo: 1,
    haloShare: 0,
  });
  return color(LAMP_LIGHT).mul(sum.mul(sceneNight).mul(BASIN_GLINT));
}

/** A lamp the river mirrors: its head (world, Y-up), the level (world
 *  Y) of the water under its light and how far from the lamp that water
 *  reaches in each compass sector (m; the bake's `wr`, null: as far as
 *  the bake looks). */
export interface LampMirror {
  head: Vector3;
  level: number;
  reach: readonly number[] | null;
}

/** The compass sectors a lamp's reach is kept for (lamp_water.py
 *  `SECTORS`), from north clockwise, each centred on its bearing; and
 *  the steps (m) a reach comes in (`END_STEP_M`), 6 bits a sector. */
const SECTORS = 8;
const END_STEP_M = 5;
const STEP_BITS = 64;
const MAX_STEPS = STEP_BITS - 1;

/** A lamp's sector reaches packed into two floats (four 6-bit steps
 *  each, exact in a float's 24 bits). */
export function packedReach(reach: readonly number[] | null): [number, number] {
  const words: [number, number] = [0, 0];
  for (let k = 0; k < SECTORS; k += 1) {
    const m = reach === null ? Number.POSITIVE_INFINITY : (reach[k] ?? 0);
    const steps = Math.min(Math.ceil(m / END_STEP_M), MAX_STEPS);
    words[k >> 2] += steps * STEP_BITS ** (k & 3);
  }
  return words;
}

/** The mirrored lamp's head (world) and its water's level, as the
 *  instance carries them: the head in the halo's matrix's translation,
 *  the level in its bottom row's first entry (`LEVEL_ENTRY`), which an
 *  affine matrix leaves 0 and the halo, a point, never reads. */
const mirrorHead = (): V3 => attribute("iMat3", "vec4").xyz;
const mirrorLevel = (): F => attribute("iMat0", "vec4").w.add(MIRROR_LIFT);
/** The level's and the packed reaches' entries in a matrix (column-major:
 *  row 3 of columns 0, 1 and 2). */
const LEVEL_ENTRY = 3;
const REACH_ENTRIES = [7, 11] as const;

/** One sector's reach (m) out of the packed words (`packedReach`): the
 *  word shifted by powers of two, multiplied (exact in a float, where a
 *  division or `exp2` may land a hair under the integer and floor a step
 *  short), its digit taken off without `mod`. */
function sectorReach(i: F, lo: F, hi: F): F {
  const word = mix(lo, hi, step(4, i));
  const k = i.mod(4);
  // 64^-k, one of four exact constants
  const shift = mix(
    mix(float(1), float(STEP_BITS ** -1), step(1, k)),
    mix(float(STEP_BITS ** -2), float(STEP_BITS ** -3), step(3, k)),
    step(2, k)
  );
  const shifted = floor(word.mul(shift));
  const digit = shifted.sub(floor(shifted.mul(1 / STEP_BITS)).mul(STEP_BITS));
  return digit.mul(END_STEP_M);
}

/** How far the lamp's water reaches toward a bearing (`flat`: the eye's
 *  foot from the lamp's, world XZ), between the sectors' centres. */
function mirrorReach(flat: V2): F {
  const lo = attribute("iMat1", "vec4").w;
  const hi = attribute("iMat2", "vec4").w;
  // compass bearing, clockwise from north (world -Z)
  const bearing = atan(flat.x, flat.y.negate());
  const t = bearing
    .div((2 * Math.PI) / SECTORS)
    .add(SECTORS)
    .mod(SECTORS);
  const i = floor(t);
  return mix(
    sectorReach(i, lo, hi),
    sectorReach(i.add(1).mod(SECTORS), lo, hi),
    t.sub(i)
  );
}

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
  // no farther out than the lamp's water reaches: past its far bank the
  // ground may lie below the level (a pond above the town), and a column
  // there would float over it
  const reach = mirrorReach(flat).toVar();
  const half = min(
    max(
      max(halfWidth(near, d, hl, he), halfWidth(far, d, hl, he)),
      halfWidth(mid, d, hl, he)
    ),
    reach
  );
  const corner = positionLocal.xy.mul(2);
  const u = min(mix(near, far, step(0, corner.y)), reach);
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
      // no pull of its own: the lift keeps it over the water sheet, whose
      // pull is constant (water-layer.ts), and a bank only a lift higher
      // hides it. A pull by the slope grows metres deep at a grazing look
      // and drew the column through the banks.
    });
    m.positionNode = mirrorQuad();
    m.colorNode = vec4(mirrorLight(), 1);
    return drawnAtNight(m);
  });
  for (let i = 0; i < mirrors.length; i += 1) {
    matrices.array[i * matrices.stride + LEVEL_ENTRY] = mirrors[i].level;
    const [lo, hi] = packedReach(mirrors[i].reach);
    matrices.array[i * matrices.stride + REACH_ENTRIES[0]] = lo;
    matrices.array[i * matrices.stride + REACH_ENTRIES[1]] = hi;
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
  /** the heads by the tracks of every loaded tile, shown or not, so a
   *  turn of the eye changes none (tiles stream in and out) */
  setHeads: (tracks: readonly Vector3[]) => void;
  /** every loaded tile's lamp heads, whose light the walls take */
  setStreetHeads: (heads: readonly Vector3[]) => void;
  setNightFactor: (t: number) => void;
  /** chooses the lamps for the eye at `eye` (world) at `now` (s); `held`
   *  is the share of a head a real light lights this frame
   *  (lamp-layer.ts `heldShare`), which the walls' light leaves out */
  update: (eye: Vector3, now: number, held?: (head: Vector3) => number) => void;
  /** empties the shared arrays: the next page's scene starts with none */
  dispose: () => void;
}

/** Scratch for `rankReflected`: one entry per head within reach. */
export interface RankScratch {
  /** candidates' head indices and distances */
  idx: number[];
  dist: number[];
  /** the candidates nearest first */
  order: number[];
}

export function rankScratch(): RankScratch {
  return { idx: [], dist: [], order: [] };
}

/**
 * Ranks `heads` for the eye at `eye`: its nearest `most` within `reach`
 * (m; fading from its first), into `out` as (x, y, z, fade); returns how
 * many. Each fades toward the first lamp left out (the cut) as well as
 * with the reach, to nothing there: the cut, the next lamp's distance,
 * moves with the eye continuously, so a lamp enters and leaves the set
 * at a fade of 0 and walking never switches one. The look plays no part,
 * so a turn of the eye changes no lamp.
 */
export function rankReflected(
  heads: readonly Vector3[],
  eye: Vector3,
  pick: { most: number; reach: readonly [number, number] },
  out: Vector4[],
  scratch: RankScratch
): number {
  const { most, reach } = pick;
  const { idx, dist, order } = scratch;
  idx.length = 0;
  dist.length = 0;
  order.length = 0;
  for (let i = 0; i < heads.length; i += 1) {
    const h = heads[i];
    const d = Math.hypot(h.x - eye.x, h.z - eye.z);
    if (d < reach[1]) {
      order.push(idx.length);
      idx.push(i);
      dist.push(d);
    }
  }
  order.sort((a, b) => dist[a] - dist[b]);
  const cut = order.length > most ? dist[order[most]] : reach[1];
  let n = 0;
  for (let r = 0; r < Math.min(most, order.length); r += 1) {
    const k = order[r];
    const d = dist[k];
    const fade =
      (1 - smooth(reach[0], reach[1], d)) *
      (1 - smooth(cut * (1 - HAND_OVER), cut, d));
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

/** How long (s) a lamp's glint takes to come or go (to 1/e) where the
 *  choice jumps: a tile's lamps streaming in or out. Walking moves the
 *  choice continuously (`rankReflected`), so it lags no lamp there. */
export const GLINT_EASE_S = 0.2;

/** A lamp that glints or is fading: its head, its shown fade and the
 *  fade the choice wants of it now. */
interface Glint {
  head: Vector3;
  shown: number;
  wanted: number;
}

/** A lamp by its place (a tile that lands again brings new vectors). */
const keyOf = (v: { x: number; y: number; z: number }) =>
  `${Math.round(v.x * 10)} ${Math.round(v.y * 10)} ${Math.round(v.z * 10)}`;

/** `heads` without the same lamp twice (two loaded levels of a tile). */
export function uniqueHeads(heads: readonly Vector3[]): Vector3[] {
  const seen = new Set<string>();
  const out: Vector3[] = [];
  for (const h of heads) {
    const key = keyOf(h);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(h);
    }
  }
  return out;
}

/** The glints that ease toward each frame's choice (`rankReflected`):
 *  writes the `most` brightest into `out`, returns how many. */
export function glintEaser(most: number) {
  const glints = new Map<string, Glint>();
  const order: Glint[] = [];
  let last: number | null = null;
  const want = (wanted: readonly Vector4[], n: number) => {
    for (const g of glints.values()) {
      g.wanted = 0;
    }
    for (let i = 0; i < n; i += 1) {
      const w = wanted[i];
      const key = keyOf(w);
      const g = glints.get(key) ?? {
        head: new Vector3(w.x, w.y, w.z),
        shown: 0,
        wanted: 0,
      };
      g.wanted = w.w;
      glints.set(key, g);
    }
  };
  /** `fresh`: `wanted` is a new choice (else the last one still stands,
   *  and the glints only ease on toward it). */
  return (
    wanted: readonly Vector4[],
    n: number,
    now: number,
    out: Vector4[],
    fresh = true
  ) => {
    const dt =
      last === null ? Number.POSITIVE_INFINITY : Math.max(0, now - last);
    last = now;
    const ease = 1 - Math.exp(-dt / GLINT_EASE_S);
    if (fresh) {
      want(wanted, n);
    }
    order.length = 0;
    for (const [key, g] of glints) {
      g.shown += (g.wanted - g.shown) * ease;
      if (g.wanted === 0 && g.shown < 0.01) {
        glints.delete(key);
      } else {
        order.push(g);
      }
    }
    // the brightest keep the slots: one coming in takes a slot as one
    // going out has faded under it
    order.sort((a, b) => b.shown - a.shown);
    const count = Math.min(order.length, most);
    for (let i = 0; i < count; i += 1) {
      const { head, shown } = order[i];
      out[i].set(head.x, head.y, head.z, shown);
    }
    return count;
  };
}

/** How often (a second) the lamps are ranked for the eye: ranking sorts
 *  every lamp within reach and keys each chosen one, which a frame need
 *  not pay for — a walker moves 15 cm between two choices, and a flight's
 *  larger steps are eased like a tile's landing (`GLINT_EASE_S`). */
export const RANK_HZ = 10;

/** A set's per-frame choice for a tier: what it keeps between frames. */
function chooser(set: MirrorSet, tier: DeviceTier) {
  const most = set.slots[tier];
  const scratch = rankScratch();
  const wanted = Array.from({ length: most }, () => new Vector4());
  const out = set.heads.array as Vector4[];
  const pick = { most, reach: set.reach };
  const ease = glintEaser(most);
  let n = 0;
  let ranked: readonly Vector3[] | null = null;
  let rankedAt = Number.NEGATIVE_INFINITY;
  return (heads: readonly Vector3[], eye: Vector3, now: number) => {
    // The choice is made anew RANK_HZ times a second, and at once when the
    // lamps change (a tile lands or leaves, night falls); the glints ease
    // toward it every frame.
    const fresh = heads !== ranked || now - rankedAt >= 1 / RANK_HZ;
    if (fresh) {
      ranked = heads;
      rankedAt = now;
      n =
        heads.length > 0 ? rankReflected(heads, eye, pick, wanted, scratch) : 0;
    }
    set.count.value = ease(wanted, n, now, out, fresh);
  };
}

/**
 * The per-frame choice of the mirrored lamps for a tier: writes the shared
 * array the rails read. Nothing by day.
 */
export function createLampReflections(tier: DeviceTier): LampReflections {
  let heads: readonly Vector3[] = [];
  let streetHeads: readonly Vector3[] = [];
  let night = 0;
  const tracks = chooser(TRACKS, tier);
  const street = chooser(STREET, tier);
  const streetOut = STREET.heads.array as Vector4[];
  const at = new Vector3();
  waterReach.value.set(...WATER_REACH[tier]);
  const none: readonly Vector3[] = [];
  return {
    setHeads: (next) => {
      heads = next;
    },
    setNightFactor: (t) => {
      night = t;
    },
    setStreetHeads: (next) => {
      streetHeads = next;
    },
    update: (eye, now, held) => {
      const lit = night > 0.001;
      tracks(lit ? heads : none, eye, now);
      street(lit ? streetHeads : none, eye, now);
      if (!held) {
        return;
      }
      for (let i = 0; i < STREET.count.value; i += 1) {
        const h = streetOut[i];
        h.w *= 1 - held(at.set(h.x, h.y, h.z));
      }
    },
    dispose: () => {
      TRACKS.count.value = 0;
      STREET.count.value = 0;
      heads = [];
      streetHeads = [];
    },
  };
}
