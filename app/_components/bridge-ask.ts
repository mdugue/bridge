import { Box3, Raycaster, Vector3 } from "three/webgpu";
import type { Mesh, Object3D } from "three/webgpu";
import { nearestItem, PIER_REACH, ringDistanceXz } from "@/lib/city/ask-solids";
import type { AskItem, AskSet, Slab } from "@/lib/city/ask-solids";
import type { FeatureInquiry } from "@/lib/city/inquiry-features";

/** The slab a deck's first solid is, if it is one. */
const slabOf = (item: AskItem<FeatureInquiry>): Slab | null => {
  const s = item.solids[0];
  return s && "slab" in s ? s.slab : null;
};

/**
 * A tile's bridges as one askable set (plan 052 phase 4): rays meet the
 * drawn bridge itself — deck, arches, piers, the measured steel above
 * (rail-layer.ts tags them `userData.bridge`) — and the point they meet
 * names its deck: the outline it lies in, or the nearest within reach.
 * Data solids would not do here: the masonry under an arch is bridge, the
 * open space under a beam bridge is not. The bridge meshes get their BVH
 * on the first question that reaches them, not with the tile.
 */
export function bridgeAskSet(
  rail: Object3D | undefined,
  decks: readonly AskItem<FeatureInquiry>[]
): AskSet<FeatureInquiry> | null {
  const meshes: Mesh[] = [];
  rail?.traverse((o) => {
    if (o.userData.bridge === true && (o as Mesh).isMesh) {
      meshes.push(o as Mesh);
    }
  });
  if (meshes.length === 0 || decks.length === 0) {
    return null;
  }
  const bounds = new Box3();
  for (const mesh of meshes) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    if (box) {
      bounds.union(box.clone().applyMatrix4(mesh.matrixWorld));
    }
  }
  const raycaster = new Raycaster();
  raycaster.firstHitOnly = true;
  const origin = new Vector3();
  const direction = new Vector3();
  return {
    box: {
      min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
      max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    },
    unbuilt: () => meshes.some((mesh) => !mesh.geometry.boundsTree),
    // before a question built the BVHs: the decks' slabs
    rough: (o, d, far) => nearestItem(o, d, decks, far),
    nearest: (o, d, far) => {
      for (const mesh of meshes) {
        if (!mesh.geometry.boundsTree) {
          mesh.geometry.computeBoundsTree();
        }
      }
      raycaster.set(origin.set(o.x, o.y, o.z), direction.set(d.x, d.y, d.z));
      raycaster.far = far;
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) {
        return null;
      }
      let best: AskItem<FeatureInquiry> | null = null;
      let reach = PIER_REACH;
      for (const deck of decks) {
        const slab = slabOf(deck);
        const gap = slab
          ? ringDistanceXz(slab.ring, hit.point.x, hit.point.z)
          : Number.POSITIVE_INFINITY;
        if (gap <= reach) {
          reach = gap;
          best = deck;
        }
      }
      return best ? { ...best, distance: hit.distance } : null;
    },
  };
}
