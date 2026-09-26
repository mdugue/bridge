import type {
  BufferGeometry,
  InstancedMesh,
  Material,
  Object3D,
  Texture,
} from "three/webgpu";

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
 * Frees the geometries and materials of a subtree. Demolish rebuilds the
 * tile's building mesh from the filtered vertex stream and drops the old one
 * (city-layer.ts); without this every demolish would leak its buffers, and
 * dispose() runs it over the whole scene at teardown. Textures are NOT
 * reached (a material may share them): the layer that created a texture
 * frees it — TerrainLayer.dispose, LampControl.dispose, SunRig.dispose.
 */
export function disposeObject3D(root: Object3D): void {
  root.traverse((obj) => {
    const resource = obj as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    resource.geometry?.dispose();
    disposeMaterial(resource.material);
    // The per-instance matrix/colour buffers are released on the mesh's own
    // dispose event, not the geometry's.
    if ((obj as InstancedMesh).isInstancedMesh) {
      (obj as InstancedMesh).dispose();
    }
  });
}

/**
 * GPU bytes of every geometry reachable from `root` (each buffer counted
 * once: attributes, index and instanced attributes — several geometries may
 * view the same buffers, as the seasonal crowns do, crown-season.ts). An
 * estimate for the memory HUD — three keeps no byte counters, and a phone's
 * single memory pool is where this scene runs out of room first.
 */
export function estimateGeometryBytes(root: Object3D): number {
  const seen = new Set<object>();
  let bytes = 0;
  const count = (array: ArrayLike<number> & { byteLength: number }) => {
    if (!seen.has(array)) {
      seen.add(array);
      bytes += array.byteLength;
    }
  };
  root.traverse((obj) => {
    const geometry = (obj as Object3D & { geometry?: BufferGeometry }).geometry;
    if (!geometry) {
      return;
    }
    for (const attribute of Object.values(geometry.attributes)) {
      count(attribute.array);
    }
    if (geometry.index) {
      count(geometry.index.array);
    }
  });
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
    sceneMaterials.set(key, material);
  }
  return material;
}

/** An app's hold on the scene-wide materials; call the result on dispose. */
export const retainSceneMaterials = materialsShared.retain;
