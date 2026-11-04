/** The sun's shadow camera (sun-rig.ts, shadow-warp.ts). */
import { OrthographicCamera } from "three/webgpu";
import type { Matrix4 } from "three/webgpu";

/**
 * The sun's shadow camera: three's orthographic one, with an optional warp
 * after its box (shadow-warp.ts). `updateProjectionMatrix` — which
 * three calls when the backend's coordinate system or depth direction is
 * set — rebuilds the box for them and applies the warp again, so the
 * projection is never left without it. Without a warp it is three's camera.
 */
export class WarpedShadowCamera extends OrthographicCamera {
  /** light view → warped coordinates (shadow-warp.ts `WarpFit.warp`) */
  warp: Matrix4 | null = null;
  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    if (this.warp) {
      this.projectionMatrix.multiply(this.warp);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    }
  }
}
