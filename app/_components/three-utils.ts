import type {
  BufferAttribute,
  BufferGeometry,
  EventDispatcher,
  Group,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Material,
  Object3D,
  Texture,
} from "three/webgpu";

/** A geometry's attribute, plain or a view of an interleaved buffer. */
export type AnyAttribute = BufferAttribute | InterleavedBufferAttribute;

/** What holds an attribute's numbers: itself, or its interleaved buffer —
 *  what three uploads as one GPU buffer. */
export function bufferOf(
  attribute: AnyAttribute
): BufferAttribute | InterleavedBuffer {
  return (attribute as InterleavedBufferAttribute).isInterleavedBufferAttribute
    ? (attribute as InterleavedBufferAttribute).data
    : (attribute as BufferAttribute);
}

/**
 * A buffer's bytes on the GPU, from its count (a field three keeps): a
 * buffer whose CPU copy is gone (`dropCpuCopies`) weighs what it did. As
 * three.js's `estimateBytesUsed` (which the tile renderer weighs a tile's
 * glTF by) counts.
 */
export function bufferBytes(
  buffer: BufferAttribute | InterleavedBuffer
): number {
  const per = buffer.array.BYTES_PER_ELEMENT;
  return (buffer as InterleavedBuffer).isInterleavedBuffer
    ? buffer.count * (buffer as InterleavedBuffer).stride * per
    : buffer.count * (buffer as BufferAttribute).itemSize * per;
}

/** The geometries under `root`, each once. */
function geometriesUnder(root: Object3D): Set<BufferGeometry> {
  const geometries = new Set<BufferGeometry>();
  root.traverse((obj) => {
    const geometry = (obj as Object3D & { geometry?: BufferGeometry }).geometry;
    if (geometry) {
      geometries.add(geometry);
    }
  });
  return geometries;
}

/** A geometry's attributes and its index. */
function attributesOf(geometry: BufferGeometry): AnyAttribute[] {
  const all = Object.values(geometry.attributes) as AnyAttribute[];
  return geometry.index ? [...all, geometry.index] : all;
}

// --- buffers the whole scene shares ----------------------------------------------

const sceneSharedAttributes = new WeakSet<object>();

/**
 * Marks an attribute every tile may draw with (the coarse terrain's grid
 * index and its water index: terrain-layer.ts `createGridShare`). three's
 * geometry dispose destroys the GPU buffer of every attribute the geometry
 * holds, shared or not — every other tile would then draw from a
 * destroyed buffer, and the frame fail. A marked attribute is taken off a
 * geometry before it is disposed (`detachSceneShared`, which
 * `disposeObject3D` runs first) and lives as long as its app's device.
 */
export function markSceneShared(attribute: AnyAttribute): void {
  sceneSharedAttributes.add(attribute);
}

/** Whether `attribute` is one the scene shares (`markSceneShared`). */
export function isSceneShared(attribute: AnyAttribute): boolean {
  return sceneSharedAttributes.has(attribute);
}

/** Takes the scene-shared attributes off a geometry (before its dispose:
 *  see `markSceneShared`). */
export function detachShared(geometry: BufferGeometry): void {
  if (geometry.index && isSceneShared(geometry.index)) {
    geometry.setIndex(null);
  }
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    if (isSceneShared(attribute)) {
      geometry.deleteAttribute(name);
    }
  }
}

/**
 * Takes the scene-shared attributes off every geometry under `root`: what
 * must happen before anything disposes them — the tile renderer disposes a
 * tile's geometries itself, right after the plugins let go of it.
 */
export function detachSceneShared(root: Object3D): void {
  for (const geometry of geometriesUnder(root)) {
    detachShared(geometry);
  }
}

/** The GPU bytes of the scene-shared attributes under `root`, each once:
 *  what no one tile holds, though the tile renderer counts them in it. */
export function sceneSharedBytes(root: Object3D): number {
  const seen = new Set<object>();
  let bytes = 0;
  for (const geometry of geometriesUnder(root)) {
    for (const attribute of attributesOf(geometry)) {
      const buffer = bufferOf(attribute);
      if (isSceneShared(attribute) && !seen.has(buffer)) {
        seen.add(buffer);
        bytes += bufferBytes(buffer);
      }
    }
  }
  return bytes;
}

/**
 * Disposes a material unless it is scene-wide (`userData.shared`,
 * `sceneMaterial`): disposing one would drop the render state of every
 * object still wearing it, and all of them would rebuild at once.
 */
export function disposeMaterial(
  material: Material | Material[] | undefined
): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      disposeMaterial(m);
    }
    return;
  }
  if (material && !material.userData.shared) {
    material.dispose();
  }
}

/**
 * Tells the renderer the drawables of a subtree are gone for good.
 * WebGPURenderer keeps a render object per drawable and pass — its
 * bindings, i.e. uniform buffers and bind groups in the GPU process — until
 * the drawable's material is disposed or the drawable itself dispatches
 * `dispose` (as `InstancedMesh.dispose()` does). A scene-wide material
 * (`sceneMaterial`) is never disposed, and disposing a geometry only clears
 * the attribute cache: without this event every drawable of every unloaded
 * tile kept its bindings, and the GPU process grew with each flight until
 * iOS ended it.
 */
export function releaseRenderState(root: Object3D): void {
  root.traverse((obj) => {
    if ((obj as { geometry?: unknown }).geometry) {
      // reason: `dispose` is not in Object3D's typed event map; it is the
      // event three's renderer listens for on every drawable.
      (obj as unknown as EventDispatcher<{ dispose: object }>).dispatchEvent({
        type: "dispose",
      });
    }
  });
}

/**
 * Frees the geometries and materials of a subtree, and its render state
 * (`releaseRenderState`). Demolish rebuilds the
 * tile's building mesh from the filtered vertex stream and drops the old one
 * (city-layer.ts); without this every demolish would leak its buffers, and
 * dispose() runs it over the whole scene at teardown. Textures are NOT
 * reached (a material may share them): the layer that created a texture
 * frees it — TerrainLayer.dispose, LampControl.dispose, SunRig.dispose. Nor
 * are the buffers the scene shares (`markSceneShared`): they are taken off
 * first.
 */
export function disposeObject3D(root: Object3D): void {
  detachSceneShared(root);
  root.traverse((obj) => {
    const resource = obj as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    // An `Instances` set's matrix and colour buffers are attributes of its
    // geometry view (instancing.ts), so they go with the geometry.
    resource.geometry?.dispose();
    disposeMaterial(resource.material);
  });
  releaseRenderState(root);
}

/**
 * GPU bytes of every geometry reachable from `root` (each buffer counted
 * once: attributes, index and instanced attributes — several geometries may
 * view the same buffers, as the seasonal crowns do, crown-season.ts). An
 * estimate for the memory HUD and the tile cache's weighing of a dressing
 * (three's own counters see only what it uploaded, and count a buffer once
 * per view of it). From the buffers' counts: a buffer whose CPU copy was
 * dropped (`dropCpuCopies`) weighs what it did.
 */
export function estimateGeometryBytes(root: Object3D): number {
  const seen = new Set<object>();
  let bytes = 0;
  for (const geometry of geometriesUnder(root)) {
    for (const attribute of attributesOf(geometry)) {
      const buffer = bufferOf(attribute);
      // the array tells two attributes over one array apart; a dropped
      // one is its own
      const key = buffer.array.length > 0 ? buffer.array : buffer;
      if (!seen.has(key)) {
        seen.add(key);
        bytes += bufferBytes(buffer);
      }
    }
  }
  return bytes;
}

// --- CPU copies -------------------------------------------------------------------

/** A typed array's constructor, for an empty one of its kind. */
type ArrayKind = new (length: number) => BufferAttribute["array"];

/** Sets a geometry's bounds while its positions are still there: three
 *  would otherwise compute them from an empty array (and cull the mesh). */
function boundsNow(geometry: BufferGeometry): void {
  if (!geometry.boundingBox) {
    geometry.computeBoundingBox();
  }
  if (!geometry.boundingSphere) {
    geometry.computeBoundingSphere();
  }
}

/**
 * Drops the CPU copies of `drop`'s buffers — once the GPU has them and
 * nothing reads them on the CPU any more. three keeps every attribute's
 * array after the upload (its WebGPU path never calls `onUploadCallback`):
 * a second copy of every byte of geometry on the page's process. The array
 * is swapped for an empty one of its kind: after the upload three reads
 * only that (the vertex and index formats) and the count, which it keeps.
 * A buffer that another attribute under `root` also holds, and a
 * scene-shared one (`markSceneShared`), keep theirs; the geometries whose
 * positions go get their bounds first. Returns the bytes dropped.
 *
 * Only after a compile that drew with them has resolved: an attribute three
 * meets for the first time after this uploads an empty buffer, and the
 * draw that reads it fails.
 */
export function dropCpuCopies(
  root: Object3D,
  drop: readonly (AnyAttribute | null | undefined)[]
): number {
  const dropped = new Set<AnyAttribute>();
  for (const attribute of drop) {
    if (attribute && !isSceneShared(attribute)) {
      dropped.add(attribute);
    }
  }
  const buffers = new Set([...dropped].map(bufferOf));
  const geometries = geometriesUnder(root);
  for (const geometry of geometries) {
    for (const attribute of attributesOf(geometry)) {
      if (!dropped.has(attribute)) {
        buffers.delete(bufferOf(attribute));
      }
    }
  }
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position") as
      | AnyAttribute
      | undefined;
    if (position && buffers.has(bufferOf(position))) {
      boundsNow(geometry);
    }
  }
  let bytes = 0;
  for (const buffer of buffers) {
    bytes += buffer.array.byteLength;
    buffer.array = new (buffer.array.constructor as ArrayKind)(0);
  }
  return bytes;
}

/**
 * A GPU resource every tile of a scene shares (one program, one upload),
 * made on first use and disposed when the last app that retained it goes.
 * A plain module singleton outlives its app: the renderer's "dispose"
 * listener stays on it, and through that listener the old renderer and its
 * GPU device stay reachable (a StrictMode remount, a round trip to
 * /wissen). Counted, not owned by one app, because a remount may boot the
 * next app before the last one is gone.
 */
export interface SceneShared<T> {
  /** the resource, made now if nothing holds it */
  get: () => T;
  /** one app more; the returned release (idempotent) is one app less */
  retain: () => () => void;
}

export function sceneShared<T extends { dispose: () => void }>(
  create: () => T
): SceneShared<T> {
  let value: T | null = null;
  let refs = 0;
  return {
    get: () => {
      value ??= create();
      return value;
    },
    retain: () => {
      refs++;
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        refs--;
        if (refs === 0) {
          value?.dispose();
          value = null;
        }
      };
    },
  };
}

// Textures register their upload size here; an ImageBitmap that was closed
// after its upload reports 0×0, so the size is recorded at load time and
// forgotten when the texture is disposed.
const trackedTextures = new Map<Texture, number>();

/** Records a texture's GPU footprint (bytes) until it is disposed. */
export function trackTexture(texture: Texture, bytes: number): void {
  trackedTextures.set(texture, bytes);
  texture.addEventListener("dispose", () => {
    trackedTextures.delete(texture);
  });
}

/**
 * Forgets a texture whose owner frees it without disposing the texture
 * itself — a render target's `dispose()` fires on the target only.
 */
export function untrackTexture(texture: Texture): void {
  trackedTextures.delete(texture);
}

/** A tracked texture's GPU bytes (0 when it is not tracked). */
export function trackedBytesOf(texture: Texture): number {
  return trackedTextures.get(texture) ?? 0;
}

/** Bytes of every live tracked texture. */
export function trackedTextureBytes(): number {
  let total = 0;
  for (const bytes of trackedTextures.values()) {
    total += bytes;
  }
  return total;
}

/** GPU bytes of a `width`×`height` texture (mip chain adds a third). */
export function textureBytes(
  width: number,
  height: number,
  bytesPerTexel: number,
  mipmaps: boolean
): number {
  const base = width * height * bytesPerTexel;
  return mipmaps ? Math.round(base * (4 / 3)) : base;
}

// --- scene-wide node materials ------------------------------------------------

const sceneMaterials = new Map<string, Material>();
const materialsShared = sceneShared(() => ({
  dispose: () => {
    for (const material of sceneMaterials.values()) {
      material.dispose();
    }
    sceneMaterials.clear();
  },
}));

/**
 * A node material every tile wears, made on first use and marked
 * `userData.shared` (no tile's disposal frees it; the last app does,
 * `retainSceneMaterials`). For materials that carry no per-tile data —
 * crowns, trunks, hedges, fountains, furniture, wires: three keys a build
 * by the material and its nodes, so one material per tile would be built
 * anew for each tile, in the scene pass and in the shadow pass.
 */
export function sceneMaterial<T extends Material>(
  key: string,
  make: () => T
): T {
  materialsShared.get();
  let material = sceneMaterials.get(key) as T | undefined;
  if (!material) {
    material = make();
    material.userData.shared = true;
    // The key names the render pipelines three builds for it (diagnostics).
    material.name ||= key;
    sceneMaterials.set(key, material);
  }
  return material;
}

/** An app's hold on the scene-wide materials; call the result on dispose. */
export const retainSceneMaterials = materialsShared.retain;

/**
 * One object per distinct material, draw kind, attribute layout and
 * shadow receipt — what three keys a node build and its pipeline by
 * (`receiveShadow` changes the shader: a lit material sampled in both ways
 * is two builds). A dressing is hundreds of objects (a vegetation cell
 * each, lamps, rails, walls) over a handful of scene-wide materials, and
 * instanced sets share their builds (instancing.ts); compiling every one
 * would queue the same build hundreds of times.
 */
export function compileRepresentatives(roots: Object3D[]): Object3D[] {
  const seen = new Map<string, Object3D>();
  for (const root of roots) {
    root.traverse((object) => {
      const { geometry, material } = object as Object3D & {
        geometry?: BufferGeometry;
        material?: Material | Material[];
      };
      if (!material) {
        return;
      }
      const kind = `${object.type}:${layoutOf(geometry)}:${object.receiveShadow}`;
      for (const m of Array.isArray(material) ? material : [material]) {
        const key = `${m.uuid}:${kind}`;
        if (!seen.has(key)) {
          seen.set(key, object);
        }
      }
    });
  }
  return [...seen.values()];
}

/** A geometry's attribute names, the layout part of a build's key. */
export function layoutOf(geometry: BufferGeometry | undefined): string {
  return geometry ? Object.keys(geometry.attributes).sort().join(",") : "";
}

/**
 * Runs `during` with `object` the only visible child of `group`, and the
 * group enabled: what a compile walking `group` sees for its synchronous
 * half — `object` under the group's clipping and nothing else of it
 * (post-stack.ts `holdCut`). Everything is put back after, `object` taken
 * out again.
 */
export function aloneUnder<T>(
  group: Group & { enabled: boolean },
  object: Object3D,
  during: () => T
): T {
  const enabled = group.enabled;
  const shown = group.children.filter((c) => c.visible);
  for (const c of shown) {
    c.visible = false;
  }
  group.add(object);
  group.enabled = true;
  try {
    return during();
  } finally {
    group.enabled = enabled;
    group.remove(object);
    for (const c of shown) {
      c.visible = true;
    }
  }
}
