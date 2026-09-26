/**
 * SPIKE (plan 020): the lifetime of the node renderer's scene-wide
 * materials — the crowns, trunks, hedges and fountains every tile wears
 * (vegetation-node.ts, monument-node.ts). They are built on first use and,
 * like three-utils.ts `sceneShared`, freed when the last app that holds
 * them goes: a module singleton that outlived its app would keep that app's
 * renderer reachable through its dispose listeners, and read that app's
 * uniforms. Counted, because a remount may boot the next app before the
 * last one is gone.
 */
const resets = new Set<() => void>();
let holders = 0;

/** Registers what frees a module's shared materials (at module load). */
export function onNodeSceneEnd(reset: () => void): void {
  resets.add(reset);
}

/** An app's hold on the shared node materials; call the result on dispose. */
export function retainNodeScene(): () => void {
  holders++;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    holders--;
    if (holders === 0) {
      for (const reset of resets) {
        reset();
      }
    }
  };
}

/** The real `dispose` of each scene-owned material (shareMaterial). */
const owned = new WeakMap<object, () => void>();

/**
 * Hands a material to the scene: its own `dispose()` becomes a no-op, so
 * no tile's teardown frees what every tile wears — neither ours
 * (three-utils.ts `disposeObject3D`) nor the tile renderer's, which frees
 * a tile's materials itself. Disposing one would drop the render state of
 * every object still wearing it, and they would all rebuild at once. Only
 * `disposeSharedMaterial` frees it, when the last app goes.
 */
export function shareMaterial<T extends { dispose: () => void }>(
  material: T
): T {
  if (!owned.has(material)) {
    owned.set(material, material.dispose.bind(material));
    material.dispose = () => undefined;
  }
  return material;
}

/** True for a material the scene owns (shareMaterial). */
export function isSharedMaterial(material: object): boolean {
  return owned.has(material);
}

/** Frees a scene-owned material for real (at the scene's end). */
export function disposeSharedMaterial(material: { dispose: () => void }): void {
  const dispose = owned.get(material);
  owned.delete(material);
  (dispose ?? material.dispose.bind(material))();
}

const materials = new Map<string, { dispose: () => void }>();
onNodeSceneEnd(() => {
  for (const material of materials.values()) {
    disposeSharedMaterial(material);
  }
  materials.clear();
});

/**
 * A node material every tile shares, made on first use and owned by the
 * scene (shareMaterial: no tile's dispose frees it), freed with the last
 * app. For materials
 * that carry no per-tile state: three keys a node graph by its nodes' ids,
 * so a copy per tile would be translated anew for each.
 */
export function sharedNodeMaterial<T extends { dispose: () => void }>(
  key: string,
  make: () => T
): T {
  let material = materials.get(key) as T | undefined;
  if (!material) {
    material = shareMaterial(make());
    materials.set(key, material);
  }
  return material;
}
