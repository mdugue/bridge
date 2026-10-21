import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import {
  abs,
  attribute,
  float,
  fract,
  max,
  mix,
  positionWorld,
  smoothstep,
  vec3,
} from "three/tsl";
import { footprint } from "./bridge-surface";
import { gdNoise } from "./ground-detail";
import type { Pt } from "./rail-layer";
import type { F, V2, V3 } from "./shader-chunks";
import { sceneMaterial } from "./three-utils";

/**
 * The sleepers under a track (rail-layer.ts): one ribbon per track, the
 * sleepers' length wide, laid on the track's level just over the ballast
 * — the ground's (the DGM holds the ballast's surface) or a rail deck's,
 * where the ballast and sleepers run on across the bridge (the photos of
 * every rail bridge on the sites show them; the deck was drawn as a plain
 * walkway colour). The sleepers are drawn by the fragment pass from the
 * station along the track (`aSleeper.x`): a concrete sleeper every 0.6 m
 * over the ballast's colour, faded to their average tone once a sleeper is
 * a few pixels wide, so they never alias. On a truss's open floor
 * (`aSleeper.y` 1) they are timber over the dark gaps between the
 * stringers: no ballast. Scene-wide (one build), three vertex buffers.
 */

/** The ribbon's half-width (m): a sleeper is 2.6 m long; on an open
 *  floor the guard timbers beside it. */
const SLEEPER_HALF = 1.3;
const OPEN_HALF = 1.6;
/** The sleepers' spacing and half-width along the track (m). */
const SLEEPER_PERIOD = 0.6;
const SLEEPER_HALF_WIDTH = 0.13;
/** The ribbon over the track's level (m): just over the ballast mesh and
 *  the deck's top. */
export const SLEEPER_TOP = 0.05;

/** sRGB → a linear colour node. */
const linear = (hex: number): V3 => {
  const c = new Color(hex);
  return vec3(c.r, c.g, c.b);
};

/** The ballast (rail-layer.ts COLORS.ballast), concrete and timber
 *  sleepers, an open floor's gaps. */
const BALLAST = 0x9a_8f_85;
const CONCRETE = 0xb9_b4_ab;
const TIMBER = 0x6e_5e_50;
const GAP = 0x3a_36_33;

/** The sleepers' ribbons: positions, normals and (station, open) per
 *  vertex. */
export interface SleeperRibbons {
  bed: number[];
  nrm: number[];
  pos: number[];
}

export function sleeperRibbons(): SleeperRibbons {
  return { pos: [], nrm: [], bed: [] };
}

/**
 * The sleepers along a run of a track's points (`pts`, at its level + the
 * SLEEPER_TOP; stations `d`), `lateral` m to the left of them, `open` per
 * point on a truss's open floor.
 */
export function addSleepers(
  acc: SleeperRibbons,
  pts: readonly Pt[],
  d: readonly number[],
  lateral: number,
  open: readonly boolean[]
): void {
  if (pts.length < 2) {
    return;
  }
  const edge = (i: number, sign: number) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / l;
    const nz = (b.x - a.x) / l;
    const half = open[i] ? OPEN_HALF : SLEEPER_HALF;
    const o = lateral + sign * half;
    return [pts[i].x + nx * o, pts[i].y, pts[i].z + nz * o];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = edge(i, 1);
    const r0 = edge(i, -1);
    const l1 = edge(i + 1, 1);
    const r1 = edge(i + 1, -1);
    // two triangles facing up: l0 r0 r1, l0 r1 l1 (wound for +y)
    for (const [p, k] of [
      [l0, i],
      [r1, i + 1],
      [r0, i],
      [l0, i],
      [l1, i + 1],
      [r1, i + 1],
    ] as const) {
      acc.pos.push(p[0], p[1], p[2]);
      acc.nrm.push(0, 1, 0);
      acc.bed.push(d[k], open[k] ? 1 : 0);
    }
  }
}

/** The sleepers' colour at a fragment. */
function sleeperColour(bed: V2): V3 {
  const aa = footprint();
  // distance to the nearest sleeper's middle along the track
  const s = bed.x;
  const toSleeper = abs(fract(s.div(SLEEPER_PERIOD).add(0.5)).sub(0.5)).mul(
    SLEEPER_PERIOD
  ) as F;
  const bar = float(1).sub(
    smoothstep(
      max(float(SLEEPER_HALF_WIDTH).sub(aa), 0),
      aa.add(SLEEPER_HALF_WIDTH),
      toSleeper
    )
  );
  // a sleeper a few pixels wide: their share of the ribbon's tone
  const cover = mix(
    bar,
    float((2 * SLEEPER_HALF_WIDTH) / SLEEPER_PERIOD),
    smoothstep(0.05, 0.16, aa)
  );
  const grain = gdNoise(positionWorld.xz.mul(4.1))
    .sub(0.5)
    .mul(0.12)
    .mul(float(1).sub(smoothstep(0.03, 0.12, aa)))
    .add(0.97);
  const bedded = mix(linear(BALLAST).mul(grain), linear(CONCRETE), cover);
  const openFloor = mix(linear(GAP), linear(TIMBER).mul(grain), cover);
  return mix(bedded, openFloor, bed.y);
}

/** The ribbons as one mesh on the scene-wide sleeper material; null when
 *  empty. Never casts (it lies on the bed). */
export function sleeperMesh(acc: SleeperRibbons): Mesh | null {
  if (acc.pos.length === 0) {
    return null;
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(acc.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(acc.nrm, 3));
  g.setAttribute("aSleeper", new Float32BufferAttribute(acc.bed, 2));
  g.computeBoundingSphere();
  const material = sceneMaterial("rail-sleepers", () => {
    const m = new MeshStandardNodeMaterial({ roughness: 0.95 });
    m.name = "rail-sleepers";
    m.colorNode = sleeperColour(attribute("aSleeper", "vec2"));
    // in front of the ballast (−2) and the deck's top it lies on
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -3;
    return m;
  });
  const mesh = new Mesh(g, material);
  mesh.name = "rail-sleepers";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}
