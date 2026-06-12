/**
 * three-mesh-bvh extends BufferGeometry/Raycaster via prototype patching;
 * this augmentation mirrors the runtime wiring done in
 * app/city/_components/collision.ts.
 */
import type { MeshBVH } from "three-mesh-bvh";

declare module "three" {
  interface BufferGeometry {
    boundsTree?: MeshBVH;
    computeBoundsTree(options?: object): void;
    disposeBoundsTree(): void;
  }
  interface Raycaster {
    /** three-mesh-bvh extension: stop at the first BVH hit (faster). */
    firstHitOnly?: boolean;
  }
}
