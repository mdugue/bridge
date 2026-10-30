/**
 * How the post stack walks drawables through `compileAsync` (post-stack.ts
 * `compile`): side by side in a few lanes, each drawable once per material
 * across every walk that shares a record — a tile's own compile, then the
 * whole scene's at the boot, walk the same objects.
 *
 * Once means started, but a walk resolves only once every drawable in it
 * has been through its step: one another walk is compiling is not compiled
 * again, and not skipped either — the walk waits for that step at its end
 * (never inside a lane, so lanes do not stall on each other's). A compile
 * resolving means its drawables are uploaded (`compileAsync` uploads a
 * drawable's geometry once its node build is done), and the tile stream
 * drops the content's CPU copies on that word (tile-stream.ts
 * `dropContentCopies`): a buffer three meets for the first time after the
 * drop uploads empty, and its draw fails. A step that failed fails every
 * walk that waits for it — none of them uploaded that drawable.
 */

/**
 * The compiles in flight on each renderer, the last one queued.
 */
const turns = new WeakMap<object, Promise<void>>();

/**
 * Runs `start` once every compile queued before it on `renderer` has
 * settled, and resolves as the compile it starts does. `start` makes the
 * `compileAsync` call itself, with whatever it sets up for the call's
 * synchronous half (the target, a swap, a clipping group) and puts back
 * right after.
 *
 * Two compiles must never be in flight at once — an upstream workaround
 * (docs/rendering.md, "Workarounds for upstream bugs"): three's
 * `compileAsync` (r187) holds the compile in progress as renderer state —
 * the target, the call depth, the render context — and takes it out and
 * puts it back around every await inside a build, so a second compile
 * resumes inside the first one's state, finishes it for it, and the first
 * then throws (`_finishPreCompile` of a null state) or builds against the
 * wrong context. Within one call three still compiles the GPU pipelines
 * side by side. Once three fixes it, `start` runs at once (and the post
 * stack's `releaseWhenSettled` waits for the anchors' own compiles
 * instead).
 */
export function compileInTurn(
  renderer: object,
  start: () => Promise<void>
): Promise<void> {
  const before = turns.get(renderer) ?? Promise.resolve();
  const compiling = before.then(start);
  turns.set(
    renderer,
    compiling.catch(() => undefined)
  );
  return compiling;
}

/** A drawable's step as the record holds it: the material it compiled
 *  for, and the step itself. */
export interface Compiling {
  material: unknown;
  settled: Promise<void>;
}

export interface LaneOptions<T> {
  lanes: number;
  /** a drawable to leave out (its tile left meanwhile) */
  skip?: (drawable: T) => boolean;
}

/**
 * Runs `step` over `list` in `opts.lanes` lanes, each drawable at most
 * once per material across every walk sharing `done`; resolves once each
 * has been through a step (this walk's or another's), rejects with the
 * first that failed.
 */
export async function compileInLanes<T extends { material?: unknown }>(
  list: readonly T[],
  step: (drawable: T) => Promise<void>,
  done: WeakMap<T, Compiling>,
  opts: LaneOptions<T>
): Promise<void> {
  let next = 0;
  /** other walks' steps over this walk's drawables */
  const others: Promise<void>[] = [];
  const lane = async () => {
    while (next < list.length) {
      const drawable = list[next++];
      const prior = done.get(drawable);
      if (prior && prior.material === drawable.material) {
        others.push(prior.settled);
        continue;
      }
      if (opts.skip?.(drawable)) {
        continue;
      }
      const settled = step(drawable);
      // recorded before the first await: no other lane runs in between
      done.set(drawable, { material: drawable.material, settled });
      await settled;
    }
  };
  await Promise.all(Array.from({ length: opts.lanes }, lane));
  await Promise.all(others);
}
