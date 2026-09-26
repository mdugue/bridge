/**
 * The viewer's load after the first frame (ADR 0008's second phase) as a
 * pure state machine: the stream reports what it sees, the machine answers
 * with the load stages to show, the one moment the scene counts as loaded,
 * and later the busy/idle flips. create-app.ts feeds it from the tile
 * stream's events; no THREE, no DOM.
 */
import type { LoadStageId } from "./load-stages";

/** What the stream looks like at one event. */
export interface BootInputs {
  /** tiles in the site (one: the lite profile's spawn tile alone) */
  siteTiles: number;
  /** the tile renderer has nothing left to load */
  tilesIdle: boolean;
  /** the tile renderer's own load progress, 0..1 */
  loadProgress: number;
  /** dressings built so far, and waiting to be */
  dressingsBuilt: number;
  dressingsQueued: number;
  /** the spawn tile's dressing was tried (built, failed or left) */
  spawnDressed: boolean;
}

export interface StageReport {
  id: LoadStageId;
  fraction: number;
  skipped?: boolean;
}

export interface BootStep {
  stages: StageReport[];
  /** true exactly once: the first moment after the gate at which nothing
   *  is loading and nothing waits to be dressed */
  loaded: boolean;
  /** after `loaded`: the new busy state when it flipped, else undefined */
  busy?: boolean;
}

export interface BootPhases {
  /** opens the dressing gate; false when it was already open */
  startStreaming: () => boolean;
  update: (inputs: BootInputs) => BootStep;
  readonly isLoaded: boolean;
}

export function createBootPhases(): BootPhases {
  let streaming = false;
  let loaded = false;
  let busy = false;
  // Both progress bars only ever move forward.
  let surroundings = 0;
  let details = 0;

  const progress = (inputs: BootInputs): StageReport[] => {
    const stages: StageReport[] = [];
    if (inputs.siteTiles === 1) {
      stages.push({ id: "surroundings", fraction: 1, skipped: true });
    } else {
      const now = inputs.tilesIdle ? 1 : Math.min(inputs.loadProgress, 0.99);
      surroundings = Math.max(surroundings, now);
      stages.push({ id: "surroundings", fraction: surroundings });
    }
    if (streaming) {
      const { dressingsBuilt: built, dressingsQueued: queued } = inputs;
      const now =
        queued === 0 && inputs.spawnDressed
          ? 1
          : Math.min(built / Math.max(built + queued, 1), 0.99);
      details = Math.max(details, now);
      stages.push({ id: "details", fraction: details });
    }
    return stages;
  };

  return {
    startStreaming: () => {
      if (streaming) {
        return false;
      }
      streaming = true;
      return true;
    },
    update: (inputs) => {
      const idle = inputs.tilesIdle && inputs.dressingsQueued === 0;
      if (!loaded) {
        const stages = progress(inputs);
        if (streaming && inputs.spawnDressed && idle) {
          loaded = true;
          stages.push(
            { id: "surroundings", fraction: 1 },
            { id: "details", fraction: 1 }
          );
          return { stages, loaded: true };
        }
        return { stages, loaded: false };
      }
      // Later loads (a flight, a turn) no longer move the bar; the HUD
      // shows a small "loading" hint instead.
      if (busy !== !idle) {
        busy = !idle;
        return { stages: [], loaded: false, busy };
      }
      return { stages: [], loaded: false };
    },
    get isLoaded() {
      return loaded;
    },
  };
}
