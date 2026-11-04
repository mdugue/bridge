import { uniform } from "three/tsl";
import type { LookValues } from "@/lib/city/look-controls";
import { climateDay } from "@/lib/city/tree-season";
import type { SeasonShift } from "@/lib/city/tree-season";
import { createSeasonClock } from "./crown-season";
import { createHook, createWatch } from "./feature-seam";
import type { SceneClock, Watch } from "./feature-seam";
import type { Live } from "./shader-chunks";
import type { SunState } from "./sun-rig";

/**
 * The scene environment: the values the sun and the scene's date move
 * that every tile's parts share — the night, the season, the clock — in
 * one place (plan 078). Not three's `scene.environment` (an environment
 * map, which the viewer never sets).
 *
 * Two halves. The shared nodes are module-level: a scene-wide material
 * (three-utils.ts `sceneMaterial`) is built once a page and closes over
 * them, so they outlive a boot; a layer reads them, never a setter of its
 * own. The watches and the write are per boot (`createSceneEnvironment`):
 * the spine writes the sun and the date, a dressing follows the season and
 * the look from its birth and lets go at its release (tile-stream.ts
 * `followEnvironment`).
 */

/** 0 by day → 1 at night (SunState.nightFactor): every scene material
 *  that dims, glows or ignites after dark reads this one node. */
export const sceneNight: Live = uniform(0);

/** What a dressing binds at birth and lets go at its release. */
export interface DressingEnvironment {
  /** the crowns' day of the year in this city's climate (climateDay):
   *  `get()` is the latest day, emits come throttled
   *  (crown-season.ts SEASON_THROTTLE_MS) */
  season: Watch<number>;
  /** the look store */
  look: Watch<LookValues>;
  /** something that casts changed: the shadow map is drawn again */
  castersChanged: () => void;
}

/** The spine's half. */
export interface SceneEnvironment extends DressingEnvironment {
  /** the scene's instant as the HUD set it last (SpineHooks.clock) */
  clock: Watch<SceneClock>;
  /** the light of now (the style's instant, create-app.ts `relight`): the
   *  night node */
  light: (sun: SunState) => void;
  /** the date the HUD asked for: the season (throttled), the clock */
  date: (date: Date) => void;
  dispose: () => void;
}

export function createSceneEnvironment(opts: {
  initialDate: Date;
  climate: SeasonShift;
  look: Watch<LookValues>;
  castersChanged: () => void;
}): SceneEnvironment {
  const { climate } = opts;
  const seasonChanged = createHook<[number]>();
  const seasonClock = createSeasonClock(opts.initialDate, (calendar) =>
    seasonChanged.emit(climateDay(calendar, climate))
  );
  const clock = createWatch<SceneClock>({
    date: opts.initialDate,
    atMs: performance.now(),
  });
  return {
    season: {
      get: () => climateDay(seasonClock.day(), climate),
      subscribe: seasonChanged.on,
    },
    look: opts.look,
    castersChanged: opts.castersChanged,
    clock,
    light: (sun) => {
      sceneNight.value = Math.min(Math.max(sun.nightFactor, 0), 1);
    },
    date: (date) => {
      seasonClock.set(date);
      clock.set({ date, atMs: performance.now() });
    },
    dispose: () => seasonClock.dispose(),
  };
}
