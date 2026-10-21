import {
  type BufferGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";

/**
 * The conifer's crown: a tiered lathe cone, the one form every needle tree
 * of the scene takes — the register's conifers (tree-inventory-layer.ts),
 * the canopy's evergreens (vegetation-layer.ts: a crown in a needle forest,
 * or green in a mixed forest on a leaf-off flight; in a Central European
 * forest that is a pine, a spruce, a fir) and both at the coarse level
 * (coarse-crowns-layer.ts). Each is built inside the box of the broadleaf
 * crown it replaces, so the same instance matrix places either and the
 * crown material's sway (which reads the geometry's own Y) bends both
 * alike.
 *
 * Non-indexed, with the broadleaf crown's attributes (position, normal,
 * uv): three keys a node build by the geometry's attributes and by whether
 * it has an index, so a cone set shares the crown's one build, in the scene
 * and in the shadow pass, and the compile's representative of the crown
 * sets (three-utils.ts `compileRepresentatives`, keyed by the attribute
 * names alone) prepares the cone's program too.
 */

/** The broadleaf crown's local box a cone is built into (geometry units). */
export interface CrownBox {
  height: number;
  minY: number;
  width: number;
}

/**
 * Conifer profile (unit radius, unit height), bottom centre to apex: three
 * tiers, each hem flaring out below the tier above — the stacked-skirt
 * silhouette of a children's-book fir. A reshaped lobed sphere cannot hold
 * the hems (too few vertex rings), so the cone is a lathe of its own.
 */
export const CONE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.9, 0.05],
  [1, 0.1],
  [0.82, 0.22],
  [0.6, 0.4],
  [0.76, 0.36],
  [0.58, 0.52],
  [0.42, 0.66],
  [0.54, 0.62],
  [0.3, 0.84],
  [0, 1],
];

/** The coarse level's cone: one skirt, a few pixels across wherever that
 *  level shows. */
export const COARSE_CONE_PROFILE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0.1],
  [0.45, 0.55],
  [0, 1],
];

/** Lathe segments per tier: the far cone about as cheap as the far lobed
 *  crown, the near one rounder. */
export const CONE_SEGMENTS = { coarse: 6, far: 6, mid: 10, rich: 24 } as const;

/** Height (0..1 of the box) of the centre the cone's radial normals point
 *  away from: low, so its flanks face up and out. */
const NORMAL_CENTRE = 0.25;
/** The azimuthal wobble that keeps the cone from reading as paper (share
 *  of its radius), and the rich tier's second octave. */
const WOBBLE = 0.07;
const WOBBLE_RICH = 0.035;

/**
 * The tiered conifer as a lathe inside `box` (centred on the vertical axis,
 * from `minY` up `height`, `width` across at its widest). A low azimuthal
 * wobble keeps it from reading as a paper cone; more than 16 segments add a
 * second wobble octave (the near tier). Normals point away from a centre
 * low on the axis, like the broadleaf crown's radial normals: the light
 * glides over the whole cone.
 */
export function buildConeGeo(
  box: CrownBox,
  segments: number,
  profile: readonly (readonly [number, number])[] = CONE_PROFILE
): BufferGeometry {
  const halfW = box.width / 2;
  const lathe = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r, y)),
    segments
  );
  const g = lathe.toNonIndexed();
  lathe.dispose();
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const centre = new Vector3(0, box.minY + NORMAL_CENTRE * box.height, 0);
  const rich = segments > 16;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const phi = Math.atan2(z, x);
    let k = 1 + WOBBLE * Math.sin(5 * phi + y * 9);
    if (rich) {
      k += WOBBLE_RICH * Math.sin(11 * phi - y * 17);
    }
    pos.setXYZ(i, x * k * halfW, box.minY + y * box.height, z * k * halfW);
  }
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(centre).normalize();
    nrm.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** A crown geometry's local box: what a cone replacing it is built into. */
export function boxOf(geo: BufferGeometry): CrownBox {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) {
    return { height: 1, minY: 0, width: 1 };
  }
  return {
    height: box.max.y - box.min.y,
    minY: box.min.y,
    width: Math.max(box.max.x - box.min.x, box.max.z - box.min.z),
  };
}
