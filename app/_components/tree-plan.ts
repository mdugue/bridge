import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  type BufferGeometry,
  CircleGeometry,
  Matrix4,
  MeshBasicNodeMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from "three/webgpu";
import type { InventoryTree } from "@/lib/city/tree-inventory";
import { Instances, instancePosition } from "./instancing";
import { sceneMaterial } from "./three-utils";

/**
 * The Schwarzplan's trees, as a site plan draws them: each register tree
 * its measured crown as a circle with the stem as a dot. Only the
 * register's trees — measured, so they may stand on a plan; the canopy's
 * are inferred from the surface model and stay off it. One set per tile,
 * hidden but for the Schwarzplan's frames (paper-scene.ts shows what is
 * tagged `planOnly`); its material is a figure material, so the swap draws
 * it in the figure's black.
 */

/** The circle's line, as a share of the crown's radius (a 10 m crown: 0.4 m). */
const RING_LINE = 0.08;
/** The stem's dot, as a share of the crown's radius. */
const STEM_DOT = 0.07;
/** Above the tree's foot (m), so a sloping ground does not cut the circle. */
const LIFT = 0.4;

/** A unit circle and dot, flat (radius 1, in the xz plane, facing up). */
function planGeometry(): BufferGeometry {
  const ring = new RingGeometry(1 - RING_LINE, 1, 48, 1);
  const dot = new CircleGeometry(STEM_DOT, 12);
  const merged = mergeGeometries([ring, dot]);
  ring.dispose();
  dot.dispose();
  merged.deleteAttribute("uv");
  merged.rotateX(-Math.PI / 2);
  return merged;
}

function planMaterial(): MeshBasicNodeMaterial {
  return sceneMaterial("tree-plan", () => {
    const m = new MeshBasicNodeMaterial({ color: 0x11_11_11 });
    m.name = "tree-plan";
    m.positionNode = instancePosition();
    // the Schwarzplan's swap draws it, as it draws the buildings
    m.userData.figure = true;
    return m;
  });
}

/** A tile's register trees as plan circles, or null without any. */
export function buildTreePlan(
  trees: readonly InventoryTree[]
): Instances | null {
  if (trees.length === 0) {
    return null;
  }
  const set = new Instances(planGeometry(), planMaterial(), trees.length);
  const m = new Matrix4();
  const q = new Quaternion();
  trees.forEach((t, i) => {
    const r = t.ext.crownWidth / 2;
    set.setMatrixAt(
      i,
      m.compose(new Vector3(t.x, t.ground + LIFT, t.z), q, new Vector3(r, 1, r))
    );
  });
  set.instanceMatrix.needsUpdate = true;
  set.computeBoundingSphere();
  set.visible = false;
  set.userData.planOnly = true;
  set.userData.treePart = "plan";
  return set;
}
