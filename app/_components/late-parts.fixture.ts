/**
 * The tests' stand-in for what the dressing plugin gives a content root's
 * late parts (late-parts.ts `LateHost`): compiles and a content record the
 * test ends, its calls recorded, over a real lane. Shared by the module's
 * tests and its adapters' (tile-stream.test.ts); nothing in the app
 * imports it.
 */
import type { Object3D } from "three/webgpu";
import { createLateLane } from "./late-parts";
import type { Compiled, LateHost } from "./late-parts";

const noop = (): void => undefined;

/** Lets every pending promise chain run (no timers). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

/** A gate the test opens. */
export function gate() {
  let open = noop;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open: () => open(), opened };
}

/** A host whose compiles and content record the test ends, its calls
 *  recorded, over a real lane. */
export function fakeHost(laneGate: Promise<void> = Promise.resolve()) {
  const compiles: {
    objects: Object3D[];
    where: string;
    end: (c: Compiled) => void;
  }[] = [];
  const loaded = gate();
  const calls = {
    allocation: [] as [unknown, string][],
    changed: 0,
    failed: [] as [unknown, string][],
    freeFailed: [] as unknown[][],
    reweigh: 0,
  };
  const host: LateHost = {
    lane: createLateLane(laneGate),
    compile: async (objects: Object3D[], where: string) =>
      await new Promise<Compiled>((resolve) => {
        compiles.push({ objects, where, end: resolve });
      }),
    loaded: async () => await loaded.opened,
    disposed: () => false,
    reweigh: () => {
      calls.reweigh += 1;
    },
    changed: () => {
      calls.changed += 1;
    },
    allocationFailure: (error, where) => {
      calls.allocation.push([error, where]);
    },
    failed: (error, tile) => {
      calls.failed.push([error, tile]);
    },
    freeFailed: (errors) => {
      calls.freeFailed.push(errors);
    },
  };
  return { calls, compiles, host, load: loaded.open };
}
