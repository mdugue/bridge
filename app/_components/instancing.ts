import {
  Box3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  Sphere,
  Vector3,
} from "three/webgpu";
import type { BufferGeometry, Color, Material } from "three/webgpu";
import {
  attribute,
  cos,
  Fn,
  mat4,
  normalLocal,
  positionLocal,
  sin,
  transformNormal,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  standAt,
  standCount,
  standMatrix,
  STAND_RECORD_WORDS,
  STAND_SCALE_UNIT,
  STAND_STEP_M,
  STAND_TURN_UNIT,
  STAND_WORD,
} from "@/lib/city/stand-record";
import { outOfDesignSite } from "./design-site";
import type { F, V3, V4 } from "./shader-chunks";

/**
 * A table of stand records (lib/city/stand-record.ts) as an instance
 * buffer: the records' own words — a view over a file's bytes, nothing
 * written — and the corner their places count from. Sets given the same
 * table share its one upload.
 */
export interface StandTable {
  readonly buffer: InstancedInterleavedBuffer;
  /** the table's origin in the frame the sets hang in (the Y-up scene
   *  frame) */
  readonly origin: Vector3;
}

/** `words` (ten a record) as a table whose places count from `origin`. */
export function standTable(
  words: Uint16Array,
  origin: readonly [number, number, number]
): StandTable {
  return {
    buffer: new InstancedInterleavedBuffer(words, STAND_RECORD_WORDS, 1),
    origin: new Vector3(...origin),
  };
}

const isStandTable = (
  source: InstancedInterleavedBuffer | StandTable | undefined
): source is StandTable =>
  source !== undefined && !(source instanceof InstancedInterleavedBuffer);

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
 * instance buffers; disposeObject3D does that). three's `info.memory`
 * charges the matrix buffer once per column view and per set sharing it;
 * the memory governor's lines were measured on that count
 * (lib/city/memory-governor.ts).
 *
 * A set has a second way in (plan 090, phase 0): a table of stand records
 * (`Instances.ofStands`), twenty bytes an instance in place of sixty-four.
 * Its geometry carries the records' words as `iPlace`, `iSize` and
 * `iKind` — three views of one interleaved buffer, one vertex buffer —
 * and `instanceMatrix()` composes place, turn and scale from them in the
 * vertex stage, so nothing writes a matrix. The table's origin is the
 * drawn object's (`userData.standOrigin`), read by one uniform every
 * material shares: sets of one layout still share one build. Such a set
 * has no matrices to write (`setMatrixAt` throws); `getMatrixAt` gives
 * the matrix the shader composes.
 */
export class Instances<M extends Material = Material> extends Mesh<
  InstancedBufferGeometry,
  M
> {
  readonly isInstances = true;
  /** the most instances the buffers hold */
  readonly capacity: number;
  #matrices: InstancedInterleavedBuffer | null = null;
  #stands: StandTable | null = null;
  #colours: InstancedBufferAttribute | null = null;
  /** the base geometry (its sphere is cached there, shared by its views) */
  readonly #base: BufferGeometry;

  /**
   * `matrices`, when given, is a buffer another set owns (at least
   * `capacity` matrices): the set shares it from the start instead of
   * allocating its own and dropping it at the first `instanceMatrix =`.
   * A stand table in its place makes the set one of records
   * (`Instances.ofStands`).
   */
  constructor(
    base: BufferGeometry,
    material: M,
    capacity: number,
    matrices?: InstancedInterleavedBuffer | StandTable
  ) {
    const view = new InstancedBufferGeometry();
    view.index = base.index;
    for (const [name, value] of Object.entries(base.attributes)) {
      view.setAttribute(name, value);
    }
    view.groups = base.groups;
    view.instanceCount = capacity;
    super(view, material);
    this.#base = base;
    this.capacity = capacity;
    if (isStandTable(matrices)) {
      this.#wearStands(matrices);
      return;
    }
    if (matrices) {
      this.instanceMatrix = matrices;
      return;
    }
    // Every slot starts as the identity: the diagonal of each 4×4.
    const array = new Float32Array(capacity * 16);
    for (let i = 0; i < array.length; i += 16) {
      array[i] = 1;
      array[i + 5] = 1;
      array[i + 10] = 1;
      array[i + 15] = 1;
    }
    this.instanceMatrix = new InstancedInterleavedBuffer(array, 16, 1);
  }

  /** A set drawn from `table`'s records, all of them: no matrix is
   *  written, the vertex stage composes each (`instanceMatrix()`). */
  static ofStands<M extends Material>(
    base: BufferGeometry,
    material: M,
    table: StandTable
  ): Instances<M> {
    return new Instances(
      base,
      material,
      standCount(table.buffer.array as Uint16Array),
      table
    );
  }

  #wearStands(table: StandTable): void {
    this.#stands = table;
    // by reference: the uniform reads the table's corner as it is
    this.userData.standOrigin = table.origin;
    const { buffer } = table;
    const g = this.geometry;
    g.setAttribute(
      "iPlace",
      new InterleavedBufferAttribute(buffer, 4, STAND_WORD.place)
    );
    g.setAttribute(
      "iSize",
      new InterleavedBufferAttribute(buffer, 4, STAND_WORD.scale)
    );
    g.setAttribute(
      "iKind",
      new InterleavedBufferAttribute(buffer, 2, STAND_WORD.kind)
    );
  }

  /** The table the set is drawn from, if it is one of records. */
  get stands(): StandTable | null {
    return this.#stands;
  }

  /** What places the set's instances, for a second set to share
   *  (the constructor's last argument): its matrices or its table. */
  get placement(): InstancedInterleavedBuffer | StandTable {
    return this.#stands ?? this.instanceMatrix;
  }

  /** The instance matrices (16 floats each, column-major). Assigning a
   *  buffer another set owns shares it: one upload for both. */
  get instanceMatrix(): InstancedInterleavedBuffer {
    if (!this.#matrices) {
      throw new Error("a set of stand records has no matrices");
    }
    return this.#matrices;
  }

  set instanceMatrix(buffer: InstancedInterleavedBuffer) {
    this.#matrices = buffer;
    for (let column = 0; column < 4; column += 1) {
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
    matrix.toArray(this.instanceMatrix.array, index * 16);
  }

  getMatrixAt(index: number, matrix: Matrix4): Matrix4 {
    const table = this.#stands;
    if (table) {
      const { origin } = table;
      return matrix.fromArray(
        standMatrix(
          standAt(table.buffer.array as Uint16Array, index, [
            origin.x,
            origin.y,
            origin.z,
          ])
        )
      );
    }
    return matrix.fromArray(this.instanceMatrix.array, index * 16);
  }

  setColorAt(index: number, colour: Color): void {
    let colours = this.#colours;
    if (!colours) {
      colours = new InstancedBufferAttribute(
        new Float32Array(this.capacity * 3).fill(1),
        3
      );
      this.instanceTints = colours;
    }
    colour.toArray(colours.array, index * 3);
  }

  /**
   * The sphere around every drawn instance (the base geometry's sphere
   * moved and scaled by each matrix), on the geometry, where three's
   * frustum culling reads it. Call after the matrices are written: without
   * it the set culls by its base geometry at the origin and vanishes
   * whenever the origin is off-screen.
   */
  computeBoundingSphere(): void {
    // The base geometry's own sphere, computed once and cached on it: a
    // tile's chunks share one crown or trunk geometry, and each of their
    // sets would otherwise walk every vertex of it again.
    if (!this.#base.boundingSphere) {
      this.#base.computeBoundingSphere();
    }
    const base = this.#base.boundingSphere ?? new Sphere();
    const box = new Box3();
    const m = new Matrix4();
    const p = new Vector3();
    let reach = 0;
    for (let i = 0; i < this.drawCount; i += 1) {
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

const column = (i: number): V4 => attribute(`iMat${i}`, "vec4");

const NO_ORIGIN = new Vector3();
/** The drawn set's table origin (`Instances.ofStands`; a rail table's
 *  chunk, rail-segments.ts): one uniform for every material, its value the
 *  drawn object's `userData.standOrigin` — in the object's bind group, so
 *  sets of one material and layout share one build. */
export const tableOrigin = uniform(new Vector3()).onObjectUpdate(
  ({ object }) =>
    (object?.userData.standOrigin as Vector3 | undefined) ?? NO_ORIGIN
);

/** A stand record's matrix (lib/city/stand-record.ts `standMatrix`):
 *  place · turn about Y · scale, from the record's words. They arrive as
 *  unsigned integers (an interleaved Uint16Array, not normalized: three
 *  gives `uint16x4`, WGSL `vec4<u32>`), exact, and become floats here. */
function standMatrixNode() {
  const place = vec4(attribute("iPlace", "uvec4"));
  const size = vec4(attribute("iSize", "uvec4"));
  const angle = place.w.mul((Math.PI * 2) / STAND_TURN_UNIT);
  const c = cos(angle);
  const s = sin(angle);
  const scale = size.xyz.mul(1 / STAND_SCALE_UNIT);
  const at = tableOrigin.add(place.xyz.mul(STAND_STEP_M));
  return mat4(
    vec4(c.mul(scale.x), 0, s.negate().mul(scale.x), 0),
    vec4(0, scale.y, 0, 0),
    vec4(s.mul(scale.z), 0, c.mul(scale.z), 0),
    vec4(at, 1)
  );
}

/** Whether the geometry being built is a set's of stand records. */
const hasStands = (geometry: BufferGeometry): boolean =>
  geometry.hasAttribute("iPlace");

/** The drawn instance's matrix (column attributes, or composed from a
 *  stand record; identity off a set). */
export const instanceMatrix = Fn((builder) => {
  if (hasStands(builder.geometry)) {
    return standMatrixNode();
  }
  if (!builder.geometry.hasAttribute("iMat0")) {
    return mat4(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }
  return mat4(column(0), column(1), column(2), column(3));
});

/** Byte `index` (0–3) of a stand record's kind and more words, as a float
 *  0..255 (0 off a set of records). A word or a hash seed made of it
 *  reaches the fragment as a FLAT varying. */
export function standByte(index: 0 | 1 | 2 | 3): F {
  return Fn((builder) => {
    if (!hasStands(builder.geometry)) {
      return 0;
    }
    const words = attribute("iKind", "uvec2");
    const word = index < 2 ? words.x : words.y;
    return (index % 2 === 0 ? word.bitAnd(0xff) : word.shiftRight(8)).toFloat();
  })() as F;
}

/**
 * The position node of an instanced material: the vertex in its instance's
 * frame (and the normal turned with it). `local` is the vertex before the
 * instance transform — a crown's sway bends it there. Works off a set too
 * (identity), so a material may be shared with plain meshes.
 */
export function instancePosition(local: V3 = positionLocal): V3 {
  return Fn((builder) => {
    if (
      !(builder.geometry.hasAttribute("iMat0") || hasStands(builder.geometry))
    ) {
      return local;
    }
    const m = instanceMatrix();
    if (builder.geometry.hasAttribute("normal")) {
      normalLocal.assign(transformNormal(normalLocal, m));
    }
    // an instance standing in a loaded design's site is folded into its
    // foot (design-site.ts)
    return outOfDesignSite(
      m.mul(vec4(local, 1)).xyz,
      m.mul(vec4(0, 0, 0, 1)).xyz
    );
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
