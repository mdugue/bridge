import {
  type BufferGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
} from "three/webgpu";

/**
 * The needle trees' crowns, the two forms a scale cannot make of the lobed
 * broadleaf crown: the conifer's tiered lathe cone (a spruce, a fir, a
 * thuja, a false cypress, a larch, a Douglas fir) and the pine's high,
 * flat-topped crown (`buildPineGeo`) — for the register's needle trees by
 * their genus (tree-inventory-layer.ts), for the canopy's evergreens by
 * the form the surface model shows (vegetation-layer.ts: the bake's `pine`,
 * a crown whose top stays flat a fifth of its height out; in a Central
 * European forest a pine as often as a spruce or a fir) and for both at
 * the coarse level (coarse-crowns-layer.ts). (A yew's bush is the lobed
 * crown itself, down on the ground.) Each is built inside the box of the
 * broadleaf crown it replaces, so the same instance matrix places either
 * and the crown material's sway (which reads the geometry's own Y) bends
 * both alike.
 *
 * Non-indexed, with the broadleaf crown's attributes (position, normal,
 * uv): three keys a node build by the geometry's attributes and by whether
 * it has an index, so a cone or pine set shares the crown's one build, in
 * the scene and in the shadow pass, and the compile's representative of
 * the crown sets (three-utils.ts `compileRepresentatives`, keyed by the
 * attribute names alone) prepares their programs too.
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

// --- reshaped crowns ------------------------------------------------------------

/** Unit-space silhouette: a direction on the unit sphere (its height `dy`
 *  in [-1, 1] and azimuth `phi`) → horizontal radius and height in [0, 1]. */
export type SilhouetteMap = (
  dy: number,
  phi: number
) => { r: number; y: number };

/** How much of the source crown's lobe relief survives the reshape. */
const RELIEF = 0.8;

/**
 * Reshapes one of the vegetation layer's crown geometries into another
 * silhouette inside the SAME bounding box, keeping its lobes as relief: each
 * vertex's direction from the crown centre (in the box's ellipsoid space)
 * picks its place on the new silhouette, its distance the bump on top. The
 * local height range is kept on purpose — the crown material's wind sway
 * reads the geometry's own Y, so a reshaped crown bends exactly like the
 * original. A clone: the attributes and the (absent) index are the
 * source's.
 */
export function reshapeCrown(
  source: BufferGeometry,
  map: SilhouetteMap,
  normalCentre: number
): BufferGeometry {
  const g = source.clone();
  g.computeBoundingBox();
  const box = g.boundingBox;
  if (!box) {
    return g;
  }
  const minY = box.min.y;
  const height = box.max.y - box.min.y;
  const halfH = height / 2;
  const halfW = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
  const cy = minY + halfH;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const v = new Vector3();
  const centre = new Vector3(0, minY + normalCentre * height, 0);
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) / halfW, (pos.getY(i) - cy) / halfH, pos.getZ(i) / halfW);
    const len = Math.max(v.length(), 1e-6);
    const dy = v.y / len;
    const phi = Math.atan2(v.z, v.x);
    const { r, y } = map(dy, phi);
    const k = 1 + (len - 1) * RELIEF;
    pos.setXYZ(
      i,
      Math.cos(phi) * r * k * halfW,
      minY + y * height,
      Math.sin(phi) * r * k * halfW
    );
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

/** The pine crown's widest ring (0..1 of its depth, from below) and its
 *  superellipse exponents: the top flat, the underside an ellipse's. */
const PINE_WAIST = 0.5;
const PINE_TOP = 4;
const PINE_UNDER = 2.2;
/** Height (0..1) of the centre the pine crown's normals point away from. */
const PINE_NORMAL_CENTRE = 0.4;

/**
 * The pine's crown: a flat-topped cushion, widest at its middle, its top
 * a superellipse's (near flat, its rim rounded), its underside rounder — a
 * Scots pine's or a black pine's crown high on its bare stem. The stem's
 * length is the matrix's (tree-inventory.ts PINE_CROWN_BASE), not the
 * geometry's.
 */
export const pineSilhouette: SilhouetteMap = (dy) => {
  const n = dy >= 0 ? PINE_TOP : PINE_UNDER;
  const r = Math.max(0, 1 - dy * dy) ** (1 / n);
  const s = Math.abs(dy) ** (2 / n);
  return {
    r,
    y: dy >= 0 ? PINE_WAIST + (1 - PINE_WAIST) * s : PINE_WAIST * (1 - s),
  };
};

/** A lobed crown geometry reshaped into the pine's crown, in its own box
 *  (`reshapeCrown`). */
export function buildPineGeo(source: BufferGeometry): BufferGeometry {
  return reshapeCrown(source, pineSilhouette, PINE_NORMAL_CENTRE);
}
