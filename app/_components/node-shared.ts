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
