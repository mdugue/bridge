import {
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Line,
  LineSegments,
  type Material,
  Mesh,
  type Object3D,
  Points,
} from "three/webgpu";
import { graphOf } from "./material-slots";
import { releaseRenderState } from "./three-utils";

/**
 * Keeps the render pipelines of the scene-wide materials alive after the
 * tiles that brought them have left. three releases a shader program and
 * its pipelines once no render object uses them; with every unloaded tile's
 * render objects freed (three-utils.ts `releaseRenderState`), flying back
 * to a place rebuilt its pipelines inside the frames of the flight — on an
 * iPhone each one holds the frame until Metal has compiled it.
 *
 * An anchor is a three-vertex stand-in with a drawable's material, attribute
 * layout and shadow receipt — what three keys a build and its pipeline by
 * (the geometry's part of the key is structural: attribute names, strides,
 * offsets, item sizes; see RenderObject.getGeometryCacheKey). It is
 * compiled once, never added to the scene and never drawn: its render
 * object holds the pipeline. Scene-wide materials are anchored as they are.
 * A per-tile material that is one user of a shared build (material-slots.ts
 * `setGraph`: the ground's variants, the ground-lit walls) is anchored
 * through a stand-in: a copy without the tile's slots, one per build, so
 * the anchor keeps the build and none of the tile's rasters. Any other
 * per-tile material leaves with its tile and compiles off the frame when it
 * comes back.
 */

type Drawable = Object3D & {
  geometry?: BufferGeometry;
  isLine?: boolean;
  isLineSegments?: boolean;
  isMesh?: boolean;
  isPoints?: boolean;
  material?: Material | Material[];
};

type ArrayOf = new (length: number) => ArrayLike<number> & {
  length: number;
};

/** A new array of the same element type (Float32Array, Int16Array, …). */
function sameKind(array: ArrayLike<number>, length: number) {
  return new (array.constructor as unknown as ArrayOf)(length);
}

/** Three vertices (one instance) in the layout of `geometry`. */
export function layoutStub(geometry: BufferGeometry): BufferGeometry {
  const stub =
    (geometry as InstancedBufferGeometry).isInstancedBufferGeometry === true
      ? new InstancedBufferGeometry()
      : new BufferGeometry();
  if ((stub as InstancedBufferGeometry).isInstancedBufferGeometry) {
    (stub as InstancedBufferGeometry).instanceCount = 1;
  }
  const buffers = new Map<InterleavedBuffer, InterleavedBuffer>();
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (
      (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
    ) {
      const a = attribute as InterleavedBufferAttribute;
      let data = buffers.get(a.data);
      if (!data) {
        // reason: the flag is set at runtime but missing from the @types.
        const instanced =
          (a.data as { isInstancedInterleavedBuffer?: boolean })
            .isInstancedInterleavedBuffer === true;
        const array = sameKind(a.data.array, a.data.stride * 3);
        data = instanced
          ? new InstancedInterleavedBuffer(
              array as never,
              a.data.stride,
              (a.data as InstancedInterleavedBuffer).meshPerAttribute
            )
          : new InterleavedBuffer(array as never, a.data.stride);
        buffers.set(a.data, data);
      }
      stub.setAttribute(
        name,
        new InterleavedBufferAttribute(data, a.itemSize, a.offset, a.normalized)
      );
      continue;
    }
    const a = attribute as BufferAttribute;
    if ((a as InstancedBufferAttribute).isInstancedBufferAttribute) {
      stub.setAttribute(
        name,
        new InstancedBufferAttribute(
          sameKind(a.array, a.itemSize) as never,
          a.itemSize,
          a.normalized,
          (a as InstancedBufferAttribute).meshPerAttribute
        )
      );
      continue;
    }
    stub.setAttribute(
      name,
      new BufferAttribute(
        sameKind(a.array, a.itemSize * 3) as never,
        a.itemSize,
        a.normalized
      )
    );
  }
  if (geometry.index) {
    const index = sameKind(geometry.index.array, 3) as unknown as number[];
    index[1] = 1;
    index[2] = 2;
    stub.setIndex(new BufferAttribute(index as never, 1));
  }
  return stub;
}

/**
 * A copy of `material` that builds as it does and holds none of its tile's
 * values: its slots read their stubs.
 */
function slotless(material: Material): Material {
  const { userData } = material;
  const rest: Record<string, unknown> = { ...userData };
  delete rest.slots;
  material.userData = rest;
  try {
    const copy = material.clone();
    copy.name = `${material.name} (anchor)`;
    return copy;
  } finally {
    material.userData = userData;
  }
}

/** The anchor's key: what a build and its pipeline are keyed by. */
function anchorKey(drawable: Drawable, material: Material): string {
  const geometry = drawable.geometry as BufferGeometry;
  const layout = Object.entries(geometry.attributes)
    .map(([name, a]) => {
      const i = a as InterleavedBufferAttribute;
      const data = i.isInterleavedBufferAttribute
        ? `${i.data.stride}/${i.offset}`
        : "";
      return `${name}:${a.itemSize}:${a.normalized ? "n" : ""}:${data}`;
    })
    .sort()
    .join(",");
  return [
    material.uuid,
    drawable.type,
    layout,
    geometry.index ? "i" : "",
    drawable.receiveShadow,
  ].join("|");
}

/** A stand-in of the drawable's kind (the primitive is in the pipeline). */
function standIn(
  drawable: Drawable,
  geometry: BufferGeometry,
  material: Material
): Object3D {
  if (drawable.isPoints) {
    return new Points(geometry, material);
  }
  if (drawable.isLineSegments) {
    return new LineSegments(geometry, material);
  }
  if (drawable.isLine) {
    return new Line(geometry, material);
  }
  return new Mesh(geometry, material);
}

export interface PipelineAnchors {
  /** Anchors the drawable's pipelines if its material is scene-wide. */
  anchor: (drawable: Object3D) => Promise<void>;
  /** How many anchors hold pipelines (diagnostics). */
  count: () => number;
  dispose: () => void;
}

export function createPipelineAnchors(
  /** compiles an object the way the frames draw it (PostStack) */
  compile: (object: Object3D) => Promise<void>,
  /**
   * Anchor a per-tile material too, as itself (its anchor goes when the
   * tile disposes it): for a hold that lasts only while it is needed, as
   * the Ausschnitt's (post-stack.ts `holdCut`), where every build matters.
   */
  every = false
): PipelineAnchors {
  const anchors = new Map<string, Object3D>();
  // the slot-less stand-ins, one per shared build
  const standIns = new Map<string, Material>();
  const anchorMaterial = (material: Material): Material | null => {
    if (material.userData.shared === true) {
      return material;
    }
    const graph = graphOf(material);
    if (graph === undefined) {
      return every ? material : null;
    }
    let stand = standIns.get(graph);
    if (!stand) {
      stand = slotless(material);
      standIns.set(graph, stand);
    }
    return stand;
  };
  return {
    anchor: async (object) => {
      const drawable = object as Drawable;
      const { geometry } = drawable;
      if (
        !(geometry && drawable.material) ||
        Array.isArray(drawable.material)
      ) {
        return;
      }
      const material = anchorMaterial(drawable.material);
      if (!material) {
        return;
      }
      const key = anchorKey(drawable, material);
      if (anchors.has(key)) {
        return;
      }
      const anchor = standIn(drawable, layoutStub(geometry), material);
      anchor.name = "pipeline-anchor";
      anchor.receiveShadow = drawable.receiveShadow;
      anchor.frustumCulled = false;
      anchors.set(key, anchor);
      await compile(anchor);
    },
    count: () => anchors.size,
    dispose: () => {
      for (const anchor of anchors.values()) {
        (anchor as Drawable).geometry?.dispose();
        releaseRenderState(anchor);
      }
      anchors.clear();
      for (const material of standIns.values()) {
        material.dispose();
      }
      standIns.clear();
    },
  };
}
