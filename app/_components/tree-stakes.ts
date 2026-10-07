import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type BufferGeometry,
  CylinderGeometry,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  Vector3,
} from "three/webgpu";
import type { InventoryTree } from "@/lib/city/tree-inventory";
import { Instances, instancePosition } from "./instancing";
import { sceneMaterial } from "./three-utils";

/**
 * The stakes a young street tree is planted between (a *Dreibock*: three
 * posts around the stem, two rails between them): drawn for the register's
 * trees under STAKED_YEARS (lib/city/tree-age.ts). One set per tile, one
 * small geometry and one scene-wide material — the street's newest trees read as
 * new at a glance.
 */

/** How far the posts stand from the stem (m), how tall and how thick. */
const STAKE_R = 0.42;
const STAKE_H = 2.1;
const STAKE_THICK = 0.035;
/** The rails between the posts, at these heights (m). */
const RAILS = [0.55, 1.75];
const STAKE_COLOR = 0xc2_a8_80;

/** Three posts on a circle and a ring of rails between them, at the foot
 *  of a stem at the origin. A tile's own (its set's disposal frees it). */
function stakeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const corner = (k: number) => {
    const a = (k / 3) * Math.PI * 2;
    return new Vector3(Math.cos(a) * STAKE_R, 0, Math.sin(a) * STAKE_R);
  };
  for (let k = 0; k < 3; k++) {
    const post = new CylinderGeometry(STAKE_THICK, STAKE_THICK, STAKE_H, 5);
    const at = corner(k);
    post.translate(at.x, STAKE_H / 2 - 0.15, at.z);
    parts.push(post);
    for (const y of RAILS) {
      const next = corner(k + 1);
      const len = at.distanceTo(next);
      const rail = new CylinderGeometry(
        STAKE_THICK * 0.7,
        STAKE_THICK * 0.7,
        len,
        4
      );
      rail.applyMatrix4(
        new Matrix4().compose(
          new Vector3((at.x + next.x) / 2, y, (at.z + next.z) / 2),
          new Quaternion().setFromUnitVectors(
            new Vector3(0, 1, 0),
            next.clone().sub(at).normalize()
          ),
          new Vector3(1, 1, 1)
        )
      );
      parts.push(rail);
    }
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) {
    p.dispose();
  }
  merged.deleteAttribute("uv");
  return merged;
}

function stakeMaterial(): MeshStandardNodeMaterial {
  return sceneMaterial("tree-stake", () => {
    const m = new MeshStandardNodeMaterial({
      color: STAKE_COLOR,
      roughness: 1,
    });
    m.name = "tree-stake";
    m.positionNode = instancePosition();
    return m;
  });
}

const Y_AXIS = new Vector3(0, 1, 0);

/** The stakes of a tile's staked trees, or null when it has none. */
export function buildTreeStakes(
  trees: readonly InventoryTree[]
): Instances | null {
  if (trees.length === 0) {
    return null;
  }
  const set = new Instances(stakeGeometry(), stakeMaterial(), trees.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  trees.forEach((t, i) => {
    q.setFromAxisAngle(Y_AXIS, t.rot);
    set.setMatrixAt(i, m.compose(new Vector3(t.x, t.ground, t.z), q, one));
  });
  set.instanceMatrix.needsUpdate = true;
  set.computeBoundingSphere();
  set.castShadow = true;
  set.receiveShadow = true;
  set.userData.treePart = "stakes";
  return set;
}
