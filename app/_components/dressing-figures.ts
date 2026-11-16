/**
 * What a terrain level's dressing costs, builder by builder (plan 090,
 * phase 0): the scene thread's milliseconds inside each builder — its own
 * steps only, the pauses between its slices left out, so the figure is
 * work and not waiting — and the bytes each part weighs in the tile cache
 * (`dressingPart`'s `bytes`, part by part). Kept per tile and level for
 * the ledger's recorded figures (`getDressingFigures`, read by
 * e2e/dressing-ledger.spec.ts) and counted by category in the stream's
 * timings (`dressing:<builder>`, the `?trace=1` table). Local only, as
 * the timings are: a tile's id names where the player was.
 *
 * What it does not see: a side file's parse (`response.json()` runs
 * inside the fetch) and the compile, which the late parts time as
 * `dressing:compile`.
 */
import type { Steps } from "@/lib/city/build-steps";
import { streamTimings } from "./stream-timing";

/** One level's dressing, as last built. */
export interface LevelFigures {
  /** bytes in the tile cache, by part (tile-stream.ts `DRESSING_PARTS`) */
  bytes: Record<string, number>;
  /** scene-thread milliseconds, by builder */
  ms: Record<string, number>;
}

/** `<tile>:<fine|coarse>` → its figures. */
export type DressingFigures = Record<string, LevelFigures>;

const levels = new Map<string, LevelFigures>();

const levelOf = (key: string): LevelFigures => {
  let level = levels.get(key);
  if (!level) {
    level = { bytes: {}, ms: {} };
    levels.set(key, level);
  }
  return level;
};

/** The key of a tile's level. */
export const figuresKey = (tile: string, level: "coarse" | "fine"): string =>
  `${tile}:${level}`;

/** A build of `key` starts: what an earlier build of it measured goes. */
export function beginFigures(key: string): void {
  levels.set(key, { bytes: {}, ms: {} });
}

function spent(key: string, builder: string, ms: number): void {
  const level = levelOf(key);
  level.ms[builder] = (level.ms[builder] ?? 0) + ms;
  streamTimings.spent(`dressing:${builder}`, ms);
}

/** `steps`, the time inside them counted under `builder` once they end
 *  (a build that is dropped half-way counts nothing).
 *  @yields {void} wherever `steps` does */
export function* builderSteps<T>(
  key: string,
  builder: string,
  steps: Steps<T>
): Steps<T> {
  let ms = 0;
  for (;;) {
    const start = streamTimings.now();
    const r = steps.next();
    ms += streamTimings.now() - start;
    if (r.done) {
      spent(key, builder, ms);
      return r.value;
    }
    yield;
  }
}

/** `work`, timed under `builder`. */
export function builderSync<T>(key: string, builder: string, work: () => T): T {
  const start = streamTimings.now();
  try {
    return work();
  } finally {
    spent(key, builder, streamTimings.now() - start);
  }
}

/** What a built dressing's parts weigh (bytes, by part). */
export function noteDressingBytes(
  key: string,
  bytes: Record<string, number>
): void {
  levelOf(key).bytes = bytes;
}

/** Every level's figures so far. */
export function dressingFigures(): DressingFigures {
  return Object.fromEntries(
    [...levels]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, level]) => [
        key,
        { bytes: { ...level.bytes }, ms: { ...level.ms } },
      ])
  );
}
