import {
  Box3,
  type BufferGeometry,
  type Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  type Material,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
} from "three/webgpu";
import {
  attribute,
  Fn,
  mat4,
  normalLocal,
  positionLocal,
  transformNormal,
  vec3,
  vec4,
} from "three/tsl";
import type { F, V3, V4 } from "./shader-chunks";

/**
 * Instanced drawing that shares one node build per material and layout.
 *
 * three builds every `InstancedMesh` on its own: the mesh's uuid is part of
 * a render object's cache key (its instancing node binds that mesh's own
 * matrix buffer), so a tile's hundreds of vegetation cells, furniture
 * models and lamp parts were hundreds of identical node builds — main
 * thread the renderer spends before the first frame that shows them, in
 * both the scene pass and the shadow pass.
 *
 * `Instances` is a plain `Mesh` over an `InstancedBufferGeometry` view of
 * its geometry: the instance matrices travel as named, instance-stepped
 * attributes (`iMat0`…`iMat3`, and `iColor` for colours) that the material
 * reads through `instancePosition` / `instanceTint` like any other
 * attribute. The key then holds the material, the attribute layout and the
 * render context only, so every set with the same material shares one
 * build and one pipeline. It keeps the InstancedMesh surface the layers use
 * (`setMatrixAt`, `setColorAt`, `instanceMatrix.needsUpdate`, sharing a
 * matrix or colour buffer between sets, `computeBoundingSphere`), with
 * `drawCount` in place of `count` — a `count` above one would put the uuid
 * back into the key — and `instanceTints` in place of `instanceColor`. Freeing it is freeing its geometry (the view, with the
 * instance buffers; disposeObject3D does that).
 */
export class Instances<M extends Material = Material> extends Mesh<
  InstancedBufferGeometry,
  M
> {
  readonly isInstances = true;
  /** the most instances the buffers hold */
  readonly capacity: number;
  #matrices!: InstancedInterleavedBuffer;
  #colours: InstancedBufferAttribute | null = null;

  constructor(base: BufferGeometry, material: M, capacity: number) {
    const view = new InstancedBufferGeometry();
    view.index = base.index;
    for (const [name, value] of Object.entries(base.attributes)) {
      view.setAttribute(name, value);
    }
    view.groups = base.groups;
    view.instanceCount = capacity;
    super(view, material);
    this.capacity = capacity;
    this.instanceMatrix = new InstancedInterleavedBuffer(
      new Float32Array(capacity * 16),
      16,
      1
    );
    const identity = new Matrix4();
    for (let i = 0; i < capacity; i++) {
      this.setMatrixAt(i, identity);
    }
  }

  /** The instance matrices (16 floats each, column-major). Assigning a
   *  buffer another set owns shares it: one upload for both. */
  get instanceMatrix(): InstancedInterleavedBuffer {
    return this.#matrices;
  }

  set instanceMatrix(buffer: InstancedInterleavedBuffer) {
    this.#matrices = buffer;
    for (let column = 0; column < 4; column++) {
      this.geometry.setAttribute(
        `iMat${column}`,
        new InterleavedBufferAttribute(buffer, 4, column * 4)
      );
    }
  }

  /**
   * The instance colours (RGB), made by the first `setColorAt`. Not named
   * `instanceColor`: three multiplies the diffuse colour of any object that
   * has one by the instancing varying of `InstancedMesh`, which a set never
   * writes. `instanceTint()` reads these.
   */
  get instanceTints(): InstancedBufferAttribute | null {
    return this.#colours;
  }

  set instanceTints(colours: InstancedBufferAttribute | null) {
    this.#colours = colours;
    if (colours) {
      this.geometry.setAttribute("iColor", colours);
    } else {
      this.geometry.deleteAttribute("iColor");
    }
  }

  /** How many instances are drawn (≤ capacity). */
  get drawCount(): number {
    return this.geometry.instanceCount;
  }

  set drawCount(n: number) {
    this.geometry.instanceCount = Math.min(Math.max(n, 0), this.capacity);
  }

  setMatrixAt(index: number, matrix: Matrix4): void {
    matrix.toArray(this.#matrices.array, index * 16);
  }

  getMatrixAt(index: number, matrix: Matrix4): Matrix4 {
    return matrix.fromArray(this.#matrices.array, index * 16);
  }

  setColorAt(index: number, colour: Color): void {
    if (!this.#colours) {
      this.instanceTints = new InstancedBufferAttribute(
        new Float32Array(this.capacity * 3).fill(1),
        3
      );
    }
    colour.toArray(
      (this.#colours as InstancedBufferAttribute).array,
      index * 3
    );
  }

  /**
   * The sphere around every drawn instance (the base geometry's sphere
   * moved and scaled by each matrix), on the geometry, where three's
   * frustum culling reads it. Call after the matrices are written: without
   * it the set culls by its base geometry at the origin and vanishes
   * whenever the origin is off-screen.
   */
  computeBoundingSphere(): void {
    const probe = new InstancedBufferGeometry();
    probe.setAttribute("position", this.geometry.getAttribute("position"));
    probe.computeBoundingSphere();
    const base = probe.boundingSphere ?? new Sphere();
    const box = new Box3();
    const m = new Matrix4();
    const p = new Vector3();
    let reach = 0;
    for (let i = 0; i < this.drawCount; i++) {
      this.getMatrixAt(i, m);
      box.expandByPoint(p.copy(base.center).applyMatrix4(m));
      reach = Math.max(reach, base.radius * m.getMaxScaleOnAxis());
    }
    const sphere = box.isEmpty()
      ? new Sphere()
      : box.getBoundingSphere(new Sphere());
    sphere.radius += reach;
    this.geometry.boundingSphere = sphere;
  }
}

/** Whether an object is an `Instances` set. */
export const isInstances = (object: unknown): object is Instances =>
  (object as { isInstances?: boolean } | null)?.isInstances === true;

/** The drawn instance's matrix (column attributes; identity off a set). */
export const instanceMatrix = Fn((builder) => {
  if (!builder.geometry.hasAttribute("iMat0")) {
    return mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }
  const column = (i: number): V4 => attribute(`iMat${i}`, "vec4");
  return mat4(column(0), column(1), column(2), column(3));
});

/**
 * The position node of an instanced material: the vertex in its instance's
 * frame (and the normal turned with it). `local` is the vertex before the
 * instance transform — a crown's sway bends it there. Works off a set too
 * (identity), so a material may be shared with plain meshes.
 */
export function instancePosition(local: V3 = positionLocal): V3 {
  return Fn((builder) => {
    if (!builder.geometry.hasAttribute("iMat0")) {
      return local;
    }
    const m = instanceMatrix();
    if (builder.geometry.hasAttribute("normal")) {
      normalLocal.assign(transformNormal(normalLocal, m));
    }
    return m.mul(vec4(local, 1)).xyz;
  })();
}

/** The drawn instance's colour (white off a set, or without colours). */
export const instanceTint = Fn((builder) =>
  builder.geometry.hasAttribute("iColor")
    ? attribute("iColor", "vec3")
    : vec3(1)
) as unknown as () => V3;

/** A float read of an instance attribute by name, 0 where it is missing. */
export function instanceFloat(name: string): F {
  return Fn((builder) =>
    builder.geometry.hasAttribute(name) ? attribute(name, "float") : 0
  )() as F;
}
