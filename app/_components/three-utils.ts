import type {
  BufferGeometry,
  InstancedMesh,
  Material,
  Object3D,
  Texture,
} from "three";

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      disposeMaterial(m);
    }
    return;
  }
  // Style materials are shared across demolish-reloads; freeing them here
  // would force a shader recompile (or break textures) on the next frame.
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
 * GPU bytes of every geometry reachable from `root` (each geometry counted
 * once: attributes, index and instanced attributes). An estimate for the
 * memory HUD — three keeps no byte counters, and a phone's single memory
 * pool is where this scene runs out of room first.
 */
export function estimateGeometryBytes(root: Object3D): number {
  const seen = new Set<BufferGeometry>();
  let bytes = 0;
  root.traverse((obj) => {
    const geometry = (obj as Object3D & { geometry?: BufferGeometry }).geometry;
    if (!geometry || seen.has(geometry)) {
      return;
    }
    seen.add(geometry);
    for (const attribute of Object.values(geometry.attributes)) {
      bytes += attribute.array.byteLength;
    }
    bytes += geometry.index?.array.byteLength ?? 0;
  });
  return bytes;
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
