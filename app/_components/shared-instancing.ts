/**
 * Instanced meshes that share one node build (plan 020).
 *
 * three 0.186 builds every InstancedMesh on its own: the render object's
 * cache key carries the mesh's uuid (RenderObject getMaterialCacheKey),
 * because its instancing node binds that mesh's own matrix buffer into the
 * build. A tile's dressing is hundreds of instanced meshes — a vegetation
 * cell is three crown tiers and the trunks, every one drawn again in the
 * shadow pass — so a phone translated hundreds of identical shaders per
 * tile and kept a copy of each one's WGSL: minutes of main thread under the
 * load screen, and memory enough for iOS to close the tab.
 *
 * Here a mesh's instance data travels as named geometry attributes instead
 * (`iMat0`…`iMat3`, `iColor` — views of its own matrix and colour arrays),
 * which a build looks up by name per render object, as it does `position`.
 * The build is then the same for every mesh with the same material and
 * attribute layout, and three shares it once the uuid is out of the key:
 *
 * - `shareInstancing` gives each instanced mesh under a root its geometry
 *   view and marks it;
 * - NodeMaterial's `setupPosition` applies the instance transform (and the
 *   instance colour) from those attributes for a marked mesh — in the main
 *   pass and in the shadow pass's override material alike — and hides the
 *   mesh from three's own instancing;
 * - RenderObject's cache key is computed as for a plain mesh.
 *
 * The draw keeps its instance count from `mesh.count`, and every
 * InstancedMesh method (setMatrixAt, raycast, bounding sphere) works as
 * before on the mesh itself. The views' buffers follow the arrays' version,
 * so a `needsUpdate` on the matrices or colours uploads them again.
 *
 * Built on renderer internals (RenderObject, NodeMaterial.setupPosition);
 * three is pinned exactly, and a bump has to re-check them.
 */
import {
  BufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  InstancedBufferAttribute as InstancedAttribute,
  type InstancedMesh,
  type Object3D,
} from "three";
import {
  attribute,
  instanceColor,
  mat4,
  normalLocal,
  positionLocal,
  transformNormal,
} from "three/tsl";
import { type Node, type NodeBuilder, NodeMaterial } from "three/webgpu";

const MARK = "sharedInstancing";

interface Marked {
  count: number;
  isInstancedMesh: boolean;
  userData: Record<string, unknown>;
}

const isMarked = (object: unknown): object is Marked =>
  (object as { userData?: Record<string, unknown> } | null)?.userData?.[
    MARK
  ] === true;

/** Runs `fn` while a marked mesh looks like a plain mesh to three. */
function asPlainMesh<T>(object: Marked, fn: () => T): T {
  const { count, isInstancedMesh } = object;
  object.isInstancedMesh = false;
  object.count = 1;
  try {
    return fn();
  } finally {
    object.isInstancedMesh = isInstancedMesh;
    object.count = count;
  }
}

/** An attribute view whose version is its source's (a needsUpdate there
 *  uploads the view again). */
function followVersion(
  target: { version: number },
  source: () => { version: number } | null
): void {
  Object.defineProperty(target, "version", {
    configurable: true,
    get: () => source()?.version ?? 0,
    set: () => undefined,
  });
}

/**
 * Gives every instanced mesh under `root` a geometry view carrying its
 * instance data by name, and marks it for the shared build. Call once the
 * meshes are built (their colours set), before they are compiled or drawn.
 */
export function shareInstancing(root: Object3D): void {
  root.traverse((object) => {
    const mesh = object as InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.userData[MARK] === true) {
      return;
    }
    const base = mesh.geometry;
    const view = new BufferGeometry();
    view.setIndex(base.index);
    for (const [name, value] of Object.entries(base.attributes)) {
      view.setAttribute(name, value);
    }
    view.groups = base.groups;
    view.boundingBox = base.boundingBox;
    view.boundingSphere = base.boundingSphere;
    const matrices = new InstancedInterleavedBuffer(
      mesh.instanceMatrix.array,
      16,
      1
    );
    followVersion(matrices, () => mesh.instanceMatrix);
    for (let column = 0; column < 4; column++) {
      view.setAttribute(
        `iMat${column}`,
        new InterleavedBufferAttribute(matrices, 4, column * 4)
      );
    }
    const colours = mesh.instanceColor;
    if (colours) {
      const colour = new InstancedAttribute(colours.array, 3);
      followVersion(colour, () => mesh.instanceColor);
      view.setAttribute("iColor", colour);
    }
    mesh.geometry = view;
    mesh.userData[MARK] = true;
  });
}

/** The instance matrix of a marked mesh's draw, from its attributes. */
export function sharedInstanceMatrix(): Node<"mat4"> {
  // reason: attribute nodes carry their type loosely in @types/three.
  const column = (i: number) =>
    attribute(`iMat${i}`, "vec4") as unknown as Node<"vec4">;
  return mat4(column(0), column(1), column(2), column(3));
}

let installed = false;

/**
 * Patches three once (per page) so marked meshes share their builds. The
 * render-object half is installed on the first render object `renderer`
 * creates (RenderObject is not exported).
 */
export function installSharedInstancing(renderer: object): void {
  if (installed) {
    return;
  }
  installed = true;
  // oxlint-disable-next-line typescript/unbound-method -- called with .call
  const setupPosition = NodeMaterial.prototype.setupPosition;
  NodeMaterial.prototype.setupPosition = function (
    this: NodeMaterial,
    builder: NodeBuilder
  ) {
    const object = builder.object;
    if (!isMarked(object) || !builder.geometry.getAttribute("iMat0")) {
      return setupPosition.call(this, builder);
    }
    const matrix = sharedInstanceMatrix();
    positionLocal.assign(matrix.mul(positionLocal).xyz);
    if (builder.geometry.getAttribute("normal")) {
      normalLocal.assign(transformNormal(normalLocal, matrix));
    }
    if (builder.geometry.getAttribute("iColor")) {
      // reason: the varying property is typed loosely in @types/three.
      (instanceColor as unknown as Node<"vec3">).assign(
        attribute("iColor", "vec3")
      );
    }
    return asPlainMesh(object, () => setupPosition.call(this, builder));
  };
  // reason: renderer internals — the render-object factory three calls.
  const objects = (
    renderer as {
      _objects: {
        createRenderObject: (...args: unknown[]) => {
          getCacheKey: () => number;
          initialCacheKey: number;
          object: unknown;
        };
      };
    }
  )._objects;
  const create = objects.createRenderObject.bind(objects);
  let patched = false;
  objects.createRenderObject = (...args: unknown[]) => {
    const ro = create(...args);
    if (!patched) {
      patched = true;
      const proto = Object.getPrototypeOf(ro) as {
        getMaterialCacheKey: (this: { object: unknown }) => number;
      };
      const materialKey = proto.getMaterialCacheKey;
      proto.getMaterialCacheKey = function (this: { object: unknown }) {
        const object = this.object;
        return isMarked(object)
          ? asPlainMesh(object, () => materialKey.call(this))
          : materialKey.call(this);
      };
      ro.initialCacheKey = ro.getCacheKey();
    }
    return ro;
  };
}
