import {
  BackSide,
  type BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  type InstancedMesh,
  type Material,
  type Mesh,
  type MeshDepthMaterial,
  type Object3D,
  type Side,
  type Texture,
} from "three";

/** The side a shadow pass renders a material's caster with (WebGLShadowMap's
 *  `shadowSide`, PCF: back faces of a front-sided material). */
const SHADOW_SIDE: Record<Side, Side> = {
  [FrontSide]: BackSide,
  [BackSide]: FrontSide,
  [DoubleSide]: DoubleSide,
};

/**
 * Stand-ins that wear each mesh's `customDepthMaterial` as their material,
 * so that `compileAsync` compiles the sun's shadow-pass program too: three
 * (r186) compiles only `object.material`, and a custom depth material would
 * otherwise compile inside the first shadow render after its tile lands.
 * Each stand-in is a shallow clone of its mesh (same geometry, same kind),
 * and the depth material is set up as WebGLShadowMap sets it before it draws
 * (side, map, alpha map and test from the colour material) — so the
 * program's parameters, and with them its cache key, are the ones the
 * shadow pass will ask for: the shadow pass then reuses the program. Both
 * passes render into a target (the scene pass's, the shadow map), so tone
 * mapping and colour space agree too. Null when no mesh has one.
 */
export function depthMaterialStandIns(root: Object3D): Group | null {
  const group = new Group();
  root.traverse((obj) => {
    const mesh = obj as Mesh;
    const depth = mesh.customDepthMaterial as MeshDepthMaterial | undefined;
    if (!(mesh.isMesh && depth) || Array.isArray(mesh.material)) {
      return;
    }
    const colour = mesh.material as Material & {
      alphaMap?: MeshDepthMaterial["alphaMap"];
      map?: MeshDepthMaterial["map"];
    };
    depth.side = colour.shadowSide ?? SHADOW_SIDE[colour.side];
    depth.alphaMap = colour.alphaMap ?? null;
    depth.alphaTest = colour.alphaToCoverage ? 0.5 : colour.alphaTest;
    depth.map = colour.map ?? null;
    const standIn = mesh.clone(false);
    standIn.material = depth;
    group.add(standIn);
  });
  return group.children.length > 0 ? group : null;
}

function disposeMaterial(material: Material | Material[] | undefined): void {
  if (Array.isArray(material)) {
    for (const m of material) {
      disposeMaterial(m);
    }
    return;
  }
  material?.dispose();
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
 * WebGL context stay reachable (a StrictMode remount, a round trip to
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

/** A tracked texture's recorded bytes (0 when untracked or absent). */
export function trackedBytesOf(texture: Texture | null | undefined): number {
  return texture ? (trackedTextures.get(texture) ?? 0) : 0;
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
