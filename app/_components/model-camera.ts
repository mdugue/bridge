import { Matrix4, OrthographicCamera, Vector3 } from "three/webgpu";
import type { ModelCameraGeometry } from "@/lib/city/model-view";

/**
 * Modell's camera (plan 055, ADR 0044): three's orthographic camera, plus
 * the shear of a Militärperspektive — world up shown as screen up, the plan
 * undistorted. The shear multiplies onto the orthographic projection in
 * view space (y' = y + k·(z + standoff)): x and depth are untouched, so the
 * depth stays linear and three's orthographic handling of it holds.
 * `Raycaster.setFromCamera` knows nothing of the shear: rays come from
 * view-ray.ts, which unprojects.
 */
export class ModelCamera extends OrthographicCamera {
  /** world up onto screen up (0 = a plain parallel projection) */
  shear = 0;
  /** m from the camera to the pivot along the view (the shear's zero) */
  standoff = 0;
  private sheared: Matrix4 | undefined;

  constructor() {
    super(-1, 1, 1, -1, 1, 2);
    this.name = "model-camera";
  }

  /** Puts the camera where a view's geometry says (lib/city/model-view.ts). */
  setGeometry(g: ModelCameraGeometry, standoff: number): void {
    this.position.set(g.position.x, g.position.y, g.position.z);
    const r = new Vector3(g.right.x, g.right.y, g.right.z);
    const u = new Vector3(g.up.x, g.up.y, g.up.z);
    const back = new Vector3(-g.forward.x, -g.forward.y, -g.forward.z);
    this.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(r, u, back));
    this.left = g.left;
    this.right = g.rightEdge;
    this.top = g.top;
    this.bottom = g.bottom;
    this.near = g.near;
    this.far = g.far;
    this.shear = g.shear;
    this.standoff = standoff;
    this.updateProjectionMatrix();
    this.updateMatrixWorld(true);
  }

  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    // (three's constructor calls this before the fields exist)
    if (!this.shear) {
      return;
    }
    // view space: y' = y + k·z + k·standoff
    const k = this.shear;
    this.sheared ??= new Matrix4();
    // rows: x, y (sheared by z), z, w
    this.sheared.set(
      1,
      0,
      0,
      0,
      0,
      1,
      k,
      k * this.standoff,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    );
    this.projectionMatrix.multiply(this.sheared);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
