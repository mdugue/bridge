import type { PlayerPose } from "@/lib/city/pose";
import {
  advanceSteps,
  airCutoff,
  bellStrokes,
  birdCall,
  birdCallChance,
  distanceGain,
  FADE_S,
  hourCrossed,
  type Listening,
  localMs,
  MASTER_VOLUME,
  mix,
  panFor,
  type SoundEnv,
  type SoundTile,
  TREES_M,
  tramBellChance,
  windSway,
  bearing as bearingTo,
} from "@/lib/city/soundscape";
import { dayOfYear } from "@/lib/city/tree-season";
import { createHearing, type Heard } from "./hearing";
import {
  airImpulse,
  type Bed,
  BED_SPECS,
  type BedName,
  bellStroke,
  birdCallAt,
  createBed,
  createCrickets,
  footstep,
  type NoiseColour,
  noiseBuffer,
  setBed,
  tramBell,
} from "./voices";

/**
 * The hidden soundscape's engine (plan 035) — loaded with a dynamic import
 * on the first toggle, so nobody who never presses L pays for it. One
 * graph on the AudioContext the toggle created inside its user gesture:
 * the beds and the event buses → a quiet master → a gentle compressor.
 * Driven from the pose stream (10 Hz), never from the render loop; the
 * levels move by scheduled ramps on the audio thread.
 */

/** What the engine reads of the scene (a CityWalkHandle, through a ref:
 *  `listen` is null once the scene is gone). */
export interface SoundSource {
  listen: (treeRadius: number) => Listening | null;
  offset: { cx: number; cy: number };
  soundTiles: SoundTile[];
}

export interface Soundscape {
  /** every pose sample (≈ 10 Hz) */
  sample: (pose: PlayerPose) => void;
  /** the scene clock and the sun's night factor, on every change */
  setClock: (date: Date, nightFactor: number) => void;
  /** fades the master in or out (the silence rules are the caller's) */
  setAudible: (on: boolean) => void;
  /** fades out, frees the graph and the CPU rasters */
  dispose: () => Promise<void>;
}

/** Each source's character: its level next to the others. */
const TRIM: Record<BedName | "crickets", number> = {
  wind: 0.34,
  hum: 0.3,
  water: 0.4,
  fountain: 0.2,
  leaves: 0.13,
  crickets: 0.035,
};
const BUS_TRIM = { birds: 0.16, steps: 0.32, bells: 0.34, tram: 0.12 };
/** How much of each bus reaches the air reverb. */
const SEND = { birds: 0.22, steps: 0.05, bells: 0.4, tram: 0.3 };
/** A clock that rests this long (ms) after crossing an hour strikes it. */
const STRIKE_REST_MS = 700;
const HOUR_MS = 3_600_000;

interface Graph {
  beds: Record<BedName | "crickets", Bed>;
  buses: Record<keyof typeof BUS_TRIM, GainNode>;
  master: GainNode;
  noise: Record<NoiseColour, AudioBuffer>;
  out: AudioNode[];
}

function buildGraph(ctx: AudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 3;
  master.connect(limiter).connect(ctx.destination);
  const air = ctx.createConvolver();
  air.buffer = airImpulse(ctx);
  const airLevel = ctx.createGain();
  airLevel.gain.value = 0.6;
  air.connect(airLevel).connect(master);
  const noise = {
    white: noiseBuffer(ctx, "white"),
    pink: noiseBuffer(ctx, "pink"),
    brown: noiseBuffer(ctx, "brown"),
  };
  const bus = (name: keyof typeof BUS_TRIM) => {
    const g = ctx.createGain();
    g.gain.value = BUS_TRIM[name];
    g.connect(master);
    const send = ctx.createGain();
    send.gain.value = SEND[name];
    g.connect(send).connect(air);
    return g;
  };
  const beds = {
    wind: createBed(ctx, noise, BED_SPECS.wind, master),
    hum: createBed(ctx, noise, BED_SPECS.hum, master),
    water: createBed(ctx, noise, BED_SPECS.water, master),
    fountain: createBed(ctx, noise, BED_SPECS.fountain, master),
    leaves: createBed(ctx, noise, BED_SPECS.leaves, master),
    crickets: createCrickets(ctx, master),
  };
  return {
    beds,
    buses: {
      birds: bus("birds"),
      steps: bus("steps"),
      bells: bus("bells"),
      tram: bus("tram"),
    },
    master,
    noise,
    out: [master, limiter, air, airLevel],
  };
}

/** The scene clock as the mix reads it. */
interface Clock {
  date: Date;
  night: number;
}

export function startSoundscape(
  ctx: AudioContext,
  source: SoundSource
): Soundscape {
  const graph = buildGraph(ctx);
  const hearing = createHearing(source.soundTiles);
  let clock: Clock | null = null;
  let last: { pose: PlayerPose; time: number } | null = null;
  let stepCarry = 0;
  let foot = 1;
  let strikeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

  const envOf = (heard: Heard, ear: Listening): SoundEnv => ({
    day: clock ? dayOfYear(clock.date) : 172,
    minutes: clock ? minutesOf(clock.date) : 14 * 60,
    nightFactor: clock?.night ?? 0,
    fountainDistance: heard.fountainDistance,
    heightAboveGround: Math.max(ear.heightAboveGround, 0),
    mode: ear.mode,
    near: heard.near,
    skyView: heard.skyView,
    trees: ear.trees,
    waterDistance: heard.water.distance,
  });

  /** The beds' levels, the wind's gust from the crowns' own sway. */
  const updateBeds = (
    env: SoundEnv,
    heard: Heard,
    ear: Listening,
    pose: PlayerPose
  ) => {
    const now = ctx.currentTime;
    const g = mix(env);
    const { beds } = graph;
    const sway = windSway(
      ear.clock,
      pose.epsgX - source.offset.cx,
      -(pose.epsgY - source.offset.cy)
    );
    const gust = (sway + 1.5) / 3;
    setBed(beds.wind, g.wind * TRIM.wind * (0.65 + 0.35 * gust), now);
    beds.wind.filter.frequency.setTargetAtTime(300 + 420 * gust, now, 0.6);
    setBed(beds.leaves, g.leaves * TRIM.leaves * (0.35 + 0.65 * gust), now);
    setBed(beds.hum, g.hum * TRIM.hum, now);
    setBed(
      beds.water,
      g.water * TRIM.water,
      now,
      heard.water.distance > 0
        ? 0.5 * panFor(heard.water.bearing, pose.heading)
        : 0
    );
    setBed(beds.fountain, g.fountain * TRIM.fountain, now);
    setBed(beds.crickets, g.crickets * TRIM.crickets, now);
    return g;
  };

  /** Footsteps by the distance walked since the last sample. */
  const stepAlong = (
    pose: PlayerPose,
    dt: number,
    env: SoundEnv,
    heard: Heard
  ) => {
    if (!last || env.mode !== "walk" || env.heightAboveGround > 3) {
      stepCarry = 0;
      return;
    }
    const walked = Math.hypot(
      pose.epsgX - last.pose.epsgX,
      pose.epsgY - last.pose.epsgY
    );
    const { carry, steps } = advanceSteps(stepCarry, walked, dt);
    stepCarry = carry;
    for (let i = 0; i < steps; i++) {
      foot = -foot;
      const t = ctx.currentTime + 0.03 + i * Math.min(dt / steps, 0.45);
      footstep(
        ctx,
        graph.noise.white,
        heard.surface,
        graph.buses.steps,
        t,
        0.08 * foot
      );
    }
  };

  /** Now and then: a bird, a tram. */
  const events = (
    pose: PlayerPose,
    dt: number,
    env: SoundEnv,
    heard: Heard,
    birds: number
  ) => {
    const now = ctx.currentTime;
    if (Math.random() < birdCallChance(birds, dt)) {
      const d = 8 + Math.random() * 40;
      const b = Math.random() * 2 * Math.PI;
      birdCallAt(
        ctx,
        birdCall(env, Math.random()),
        {
          gain: distanceGain(d, 12),
          pan: panFor(b, 0),
          cutoff: airCutoff(d * 4),
        },
        graph.buses.birds,
        now + 0.05
      );
    }
    if (Math.random() < tramBellChance(heard.tram.distance, env.minutes, dt)) {
      const here = { x: pose.epsgX, y: pose.epsgY };
      tramBell(
        ctx,
        {
          gain: distanceGain(heard.tram.distance, 15),
          pan: panFor(bearingTo(here, heard.tram), pose.heading),
          cutoff: airCutoff(heard.tram.distance * 3),
        },
        graph.buses.tram,
        now + 0.05
      );
    }
  };

  const strike = (hour: number) => {
    if (disposed || !last) {
      return;
    }
    const { pose } = last;
    const here = { x: pose.epsgX, y: pose.epsgY };
    const start = ctx.currentTime + 0.1;
    for (const s of bellStrokes(hour, hearing.towers(here.x, here.y), here)) {
      bellStroke(
        ctx,
        graph.noise.white,
        s.size,
        {
          gain: s.gain,
          pan: panFor(s.bearing, pose.heading),
          cutoff: s.cutoff,
        },
        graph.buses.bells,
        start + s.at
      );
    }
  };

  return {
    sample: (pose) => {
      if (disposed) {
        return;
      }
      const ear = source.listen(TREES_M);
      if (!ear) {
        return;
      }
      const time = performance.now();
      // Real time between samples (a slow frame spaces them out); a long
      // gap (a tab coming back) is no walk.
      const dt = last ? (time - last.time) / 1000 : 0;
      const heard = hearing.hear(pose.epsgX, pose.epsgY);
      const env = envOf(heard, ear);
      const g = updateBeds(env, heard, ear, pose);
      stepAlong(pose, dt, env, heard);
      events(pose, dt, env, heard, g.birds);
      last = { pose, time };
    },
    setClock: (date, night) => {
      const prev = clock;
      clock = { date, night };
      if (!prev) {
        return;
      }
      const hour = hourCrossed(localMs(prev.date), localMs(date));
      if (hour === null) {
        return;
      }
      // The hour the clock crossed, struck once it rests — unless it was
      // scrubbed back before it.
      const due = Math.floor(localMs(date) / HOUR_MS) * HOUR_MS;
      clearTimeout(strikeTimer);
      strikeTimer = setTimeout(() => {
        if (
          clock &&
          localMs(clock.date) >= due &&
          localMs(clock.date) < due + HOUR_MS
        ) {
          strike(hour);
        }
      }, STRIKE_REST_MS);
    },
    setAudible: (on) => {
      graph.master.gain.setTargetAtTime(
        on ? MASTER_VOLUME : 0,
        ctx.currentTime,
        on ? FADE_S : FADE_S / 4
      );
    },
    dispose: () => {
      disposed = true;
      clearTimeout(strikeTimer);
      hearing.dispose();
      graph.master.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
      return new Promise((resolve) => {
        setTimeout(() => {
          for (const bed of Object.values(graph.beds)) {
            bed.stop();
          }
          for (const node of [...Object.values(graph.buses), ...graph.out]) {
            node.disconnect();
          }
          resolve();
        }, 600);
      });
    },
  };
}
