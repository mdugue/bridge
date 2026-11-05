import type { Object3D } from "three/webgpu";
import { isAllocationFailure } from "@/lib/city/gpu-allocation";
import { createTaskGate } from "@/lib/city/task-gate";
import type { TaskGate } from "@/lib/city/task-gate";
import { isAbortError } from "./fetch-optional";
import { streamTimings } from "./stream-timing";

/**
 * A tile's late parts (plan 083): what lands on a content root after the
 * root itself — a terrain level's dressing, a city tile's murals, a data
 * layer's traffic bodies — each built in its turn, compiled before it
 * hangs, weighed from its build and freed once its compile has ended, by
 * one sequence instead of a hand-written copy per part.
 *
 * Two hang policies (`LatePart.hangAt`):
 * - "wait": hangs once its compile wait (COMPILE_WAIT_MS) is over, even if
 *   the compile runs on, and comes down again if that compile then runs out
 *   of memory — a level's hand-over waits on it (the dressing);
 * - "compile": hangs once its compile has ended (the murals, the traffic).
 *
 * The rule under both: **a part is freed only once its compile has ended**.
 * three cannot stop a compile, and one that resumes on freed buffers
 * uploads them again, which nothing would free.
 *
 * The lane (`createLateLane`) is the site's: after the gate, one build at
 * a time, the lower rank first (at most MAX_LATE_OVERTAKES overtakes); a
 * "wait" part frees it after its build and a build waits out the compile
 * wait before the last one (one compile wait ahead at most, never a pile
 * of built parts behind a slow GPU); a "compile" part holds it through its
 * compile wait (a traffic body is one large upload: a second one in flight
 * beside it would double a phone's peak).
 */

/** How long a part (or a tile) may wait on its compile before it shows
 *  regardless. */
export const COMPILE_WAIT_MS = 3000;

/** How many builds of a lower rank may go ahead of one queued before them
 *  (lib/city/task-gate.ts): in a long flight the coarse levels keep
 *  landing, and the tile under the camera (the boot's spawn tile, which
 *  `ready` waits for) still gets its trees. */
export const MAX_LATE_OVERTAKES = 4;

/**
 * How a compile ended (`LateHost.compile`): done, its buffers on the GPU
 * with it; not run, nothing could compile it yet; failed; or out of
 * memory — the GPU or the page could not make room.
 */
export type Compiled = "done" | "failed" | "not run" | "out of memory";

export async function withinWait(
  done: Promise<unknown>,
  ms: number
): Promise<void> {
  await Promise.race([
    done,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}

export async function withinCompileWait(done: Promise<unknown>): Promise<void> {
  await withinWait(done, COMPILE_WAIT_MS);
}

/** How one late part comes to hang on its tile. */
export interface LatePart<T> {
  /** "dressing", "murals", "traffic": the trail's `where` and the timings'
   *  names (`<kind>:queue-wait`, `<kind>:build`, `<kind>:compile`) */
  kind: string;
  tile: string;
  /** its place in the site's lane (lower first); null: built outside it */
  rank: number | null;
  /** "wait": hangs once its compile wait is over and comes down again if
   *  that compile then runs out of memory (a level's hand-over waits on
   *  it); "compile": hangs once its compile has ended */
  hangAt: "wait" | "compile";
  /** builds it, or null: nothing to hang. Aborted when the tile leaves;
   *  frees what it made before it rethrows */
  build: (signal: AbortSignal) => Promise<T | null>;
  /** what is compiled before it hangs */
  objects: (built: T) => Object3D[];
  /** what the tile cache weighs it by, from its build on */
  bytes: (built: T) => number;
  /** hangs it (once, after the content is recorded); returns what takes
   *  it down again — which throws, or returns an array of what it met
   *  (anything else it returns is ignored). One that throws has taken
   *  down what it hung: the part is then freed as a failure, with no
   *  take-down to call */
  hang: (built: T, self: LateHandle) => () => unknown;
  /** frees it (taken down already); returns what threw */
  free: (built: T) => unknown[];
}

export type LateOutcome =
  | "hung"
  | "nothing"
  | "gone"
  | "out of memory"
  | "failed";

export interface LateHandle {
  /** built and its compile wait over, or given up; settles without
   *  waiting for the content to be recorded (the hand-over awaits it) */
  ready: Promise<void>;
  /** how it ended: hung (a "wait" part as it hangs, though a compile that
   *  then runs out of memory takes it down again), or given up; never
   *  rejects */
  settled: Promise<LateOutcome>;
  /** takes it down now and frees it, now or once its compile ends; a
   *  build still running ends without hanging. Returns what threw now */
  dispose: () => unknown[];
}

/** The parts of one content root. */
export interface LateParts {
  /** starts a part; `owner`: it goes when that part goes (the traffic
   *  with its dressing). One added once the root has left (or the stream
   *  or its owner has gone) is settled "gone" at once */
  add: <T>(part: LatePart<T>, owner?: LateHandle) => LateHandle;
  /** what its parts weigh, from their build until freed or given up */
  bytes: () => number;
  /** the tile left (`disposeTile`): builds abort, `ready`s settle,
   *  nothing new builds or hangs — even while the root's release waits */
  leave: () => void;
  /** frees every part, now or once its compile ends (the root's
   *  release); returns what threw now */
  release: () => unknown[];
}

/** The site's lane (opaque: made by `createLateLane`, read here only). */
export interface LateLane {
  readonly gate: Promise<void>;
}

interface Lane extends LateLane {
  tasks: TaskGate;
  /** the compile waits of the last two "wait" parts built */
  last: Promise<void>;
  older: Promise<void>;
}

/** The site's lane, its builds after `gate` (the HUD's go). */
export function createLateLane(gate: Promise<void>): LateLane {
  const lane: Lane = {
    gate,
    tasks: createTaskGate(1, MAX_LATE_OVERTAKES),
    last: Promise.resolve(),
    older: Promise.resolve(),
  };
  return lane;
}

/** What the plugin gives one root's parts. */
export interface LateHost {
  lane: LateLane;
  /** compiles, counted on the root (its release waits); never rejects */
  compile: (objects: Object3D[], where: string) => Promise<Compiled>;
  /** settles once the renderer has recorded the content */
  loaded: Promise<void>;
  /** the stream has gone */
  disposed: () => boolean;
  /** the cache weighs the tile again (never once it left: see `weigh`) */
  reweigh: () => void;
  changed: () => void;
  /** a build or hang that threw for want of memory (`isAllocationFailure`) */
  allocationFailure: (error: unknown, where: string) => void;
  /** a build or hang that threw otherwise */
  failed: (error: unknown, tile: string) => void;
  /** what a free after a compile threw */
  freeFailed: (errors: unknown[]) => void;
}

/** One part's state behind its handle. */
interface Live {
  handle: LateHandle;
  bytes: number;
  /** gone: disposed, its owner gone, or freed */
  gone: () => boolean;
  dispose: () => unknown[];
  children: Set<Live>;
}

const noop = (): void => undefined;

/** Settles once `signal` aborts. */
async function untilAborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createLateParts(host: LateHost): LateParts {
  const lane = host.lane as Lane;
  const live = new Set<Live>();
  const byHandle = new WeakMap<LateHandle, Live>();
  const aborts = new Set<AbortController>();
  let left = false;
  /** settles every `ready` still pending when the tile leaves */
  const leaving = new Set<() => void>();
  /** what a free after its compile threw, if anything */
  const report = (errors: unknown[]) => {
    if (errors.length > 0) {
      host.freeFailed(errors);
    }
  };

  /** `work` in the lane, after the gate; outside it for rank null. One
   *  whose `signal` aborts while it waits — for the gate or in the line —
   *  leaves at once (the lane rejects it with the abort) */
  const inLane = async <R>(
    rank: number | null,
    work: () => Promise<R>,
    signal: AbortSignal
  ) => {
    if (rank === null) {
      return await work();
    }
    await Promise.race([lane.gate, untilAborted(signal)]);
    return await lane.tasks.run(work, signal, rank);
  };

  /** a part added once its root has left, the stream gone or its owner
   *  gone: nothing to wait for, build or free */
  const goneAtOnce = (): LateHandle => {
    const handle: LateHandle = {
      ready: Promise.resolve(),
      settled: Promise.resolve("gone"),
      dispose: () => [],
    };
    // (one owned by it is gone as it is added, too)
    byHandle.set(handle, {
      handle,
      bytes: 0,
      gone: () => true,
      dispose: () => [],
      children: new Set(),
    });
    return handle;
  };

  const add = <T>(part: LatePart<T>, owner?: LateHandle): LateHandle => {
    const parent = owner ? byHandle.get(owner) : undefined;
    if (left || host.disposed() || (parent?.gone() ?? false)) {
      return goneAtOnce();
    }
    const where = `${part.kind} ${part.tile}`;
    const abort = new AbortController();
    aborts.add(abort);
    let disposed = false;
    // (a holder: the closures below set it across awaits)
    const made: { value: T | null } = { value: null };
    let compiling: Promise<Compiled> | null = null;
    let takeDown: (() => unknown) | null = null;
    let freed = false;
    let readyNow = noop;
    const ready = new Promise<void>((resolve) => {
      readyNow = resolve;
    });
    leaving.add(readyNow);
    const gone = () =>
      disposed || freed || left || host.disposed() || (parent?.gone() ?? false);

    const state: Live = {
      handle: undefined as unknown as LateHandle,
      bytes: 0,
      gone,
      children: new Set(),
      dispose: () => [],
    };
    const weigh = (bytes: number) => {
      if (state.bytes === bytes) {
        return;
      }
      state.bytes = bytes;
      // a tile that left is not weighed again: the renderer's cache frees
      // it inside its eviction, after it took the tile's bytes off its
      // total, and a re-weigh there would add them back for good
      if (!left && !host.disposed()) {
        host.reweigh();
      }
    };
    /** it leaves the tile's weight once its GPU free has run (ADR 0047:
     *  a part freed later is still on the GPU until then) */
    const unweigh = () => {
      live.delete(state);
      weigh(0);
    };
    /** frees it once, now or once its compile ends; what threw now */
    const free = (): unknown[] => {
      if (freed) {
        return [];
      }
      const built = made.value;
      if (built === null) {
        live.delete(state);
        return [];
      }
      freed = true;
      // its handle outlives it (a traffic slot's): it keeps nothing now
      made.value = null;
      // a take-down that throws keeps no part from its free
      const errors: unknown[] = [];
      try {
        const met = takeDown?.();
        if (Array.isArray(met)) {
          errors.push(...(met as unknown[]));
        }
      } catch (error) {
        errors.push(error);
      }
      takeDown = null;
      const running = compiling;
      if (running) {
        // weighed on until then: the cache must not admit tiles into
        // memory this part still holds
        const freeAfter = async () => {
          await running.catch(noop);
          const threw = part.free(built);
          unweigh();
          report(threw);
        };
        void freeAfter();
        return errors;
      }
      const threw = part.free(built);
      unweigh();
      return [...errors, ...threw];
    };
    /** it and what it owns go */
    const goAway = (): unknown[] => {
      // (its owner may be iterating its children: a Set allows it)
      parent?.children.delete(state);
      const errors: unknown[] = [];
      for (const child of state.children) {
        errors.push(...child.dispose());
      }
      state.children.clear();
      errors.push(...free());
      return errors;
    };
    state.dispose = () => {
      disposed = true;
      abort.abort();
      readyNow();
      return goAway();
    };
    const handle: LateHandle = {
      ready,
      settled: Promise.resolve("nothing"),
      dispose: () => state.dispose(),
    };
    state.handle = handle;
    byHandle.set(handle, state);
    live.add(state);
    parent?.children.add(state);

    /** built, its compile started; resolves with the wait (as a value,
     *  not awaited inside the lane for a "wait" part) */
    const buildAndCompile = async () => {
      if (part.rank !== null && part.hangAt === "wait" && !gone()) {
        // (one gone meanwhile builds nothing: it waits no longer)
        await Promise.race([lane.older, untilAborted(abort.signal)]);
      }
      if (gone()) {
        return null;
      }
      streamTimings.since(`${part.kind}:queue-wait`, queuedAt, part.tile);
      const built = await streamTimings.timed(
        `${part.kind}:build`,
        async () => await part.build(abort.signal),
        part.tile
      );
      if (built === null) {
        return null;
      }
      made.value = built;
      if (gone()) {
        // never compiled, never weighed
        report(free());
        return null;
      }
      weigh(part.bytes(built));
      const compiled = host.compile(part.objects(built), where);
      compiling = compiled;
      void compiled.finally(() => {
        if (compiling === compiled) {
          compiling = null;
        }
      });
      const waited = streamTimings.timed(
        `${part.kind}:compile`,
        async () => await withinCompileWait(compiled),
        part.tile
      );
      if (part.rank !== null && part.hangAt === "wait") {
        lane.older = lane.last;
        lane.last = waited.catch(noop);
      } else {
        // a "compile" part holds the lane through its wait
        await waited;
      }
      return { built, compiled, waited };
    };

    const queuedAt = streamTimings.now();
    const run = async (): Promise<LateOutcome> => {
      const started = await inLane(part.rank, buildAndCompile, abort.signal);
      if (!started) {
        readyNow();
        return made.value === null && !gone() ? "nothing" : "gone";
      }
      const { built, compiled, waited } = started;
      // how the compile ended, once it has (a "wait" part may hang first;
      // a holder: the callback sets it across awaits)
      const ended: { value?: Compiled } = {};
      const noteEnd = async () => {
        ended.value = await compiled;
      };
      void noteEnd();
      await waited;
      readyNow();
      // not before the renderer has recorded the content: what hangs may
      // be the scene's, which it would dispose with the tile
      await host.loaded;
      if (part.hangAt === "compile") {
        ended.value = await compiled;
      }
      const outOfMemory = ended.value === "out of memory";
      if (gone() || outOfMemory) {
        report(goAway());
        return outOfMemory ? "out of memory" : "gone";
      }
      takeDown = part.hang(built, handle);
      host.changed();
      if (ended.value === undefined) {
        // a "wait" part hung while its compile runs on: down again if
        // that compile then runs out of memory (settled says "hung")
        const dropIfOut = async () => {
          if ((await compiled) === "out of memory" && !freed) {
            report(goAway());
            host.changed();
          }
        };
        void dropIfOut();
      }
      return "hung";
    };
    /** how a build or hang that threw ends: quiet once gone */
    const failedWith = (error: unknown): LateOutcome => {
      readyNow();
      const quiet = isAbortError(error) || gone();
      report(goAway());
      if (!quiet && isAllocationFailure(error)) {
        host.allocationFailure(error, where);
      } else if (!quiet) {
        host.failed(error, part.tile);
      }
      return quiet ? "gone" : "failed";
    };
    const settle = async (): Promise<LateOutcome> => {
      let outcome: LateOutcome;
      try {
        outcome = await run();
      } catch (error) {
        outcome = failedWith(error);
      }
      aborts.delete(abort);
      leaving.delete(readyNow);
      // given up: what it owns goes along
      if (outcome !== "hung") {
        report(goAway());
      }
      return outcome;
    };
    handle.settled = settle();
    return handle;
  };

  return {
    add,
    bytes: () => {
      let sum = 0;
      for (const part of live) {
        sum += part.bytes;
      }
      return sum;
    },
    leave: () => {
      left = true;
      for (const abort of aborts) {
        abort.abort();
      }
      for (const settle of leaving) {
        settle();
      }
    },
    release: () => {
      const errors: unknown[] = [];
      // (a part leaves the set as it goes: a Set's iteration allows it)
      for (const part of live) {
        errors.push(...part.dispose());
      }
      return errors;
    },
  };
}
