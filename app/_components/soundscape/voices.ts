import {
  BELL_PARTIALS,
  BELL_PRIME_HZ,
  type BellSize,
  type BirdCall,
  RAMP_S,
  type StepSurface,
} from "@/lib/city/soundscape";

/**
 * The soundscape's instruments, all synthesized (plan 035): no samples, no
 * dependency. Beds are looped noise through filters; events are short
 * scheduled graphs that free themselves when they end. Everything is soft
 * on purpose — slow attacks where a real source allows it, no resonant
 * peaks, and a shared, dark "air" reverb that sets the far sounds back.
 */

export type NoiseColour = "brown" | "pink" | "white";

/** Loopable mono noise, normalised to an RMS of 0.25. */
export function noiseBuffer(
  ctx: BaseAudioContext,
  colour: NoiseColour,
  seconds = 6
): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  // A short crossfade of the extra tail into the head makes the loop
  // seamless: the last sample runs on into the first (no click a cycle,
  // which brown noise's slow drift would otherwise make).
  const fade = Math.floor(ctx.sampleRate * 0.05);
  const d = new Float32Array(n + fade);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let brown = 0;
  for (let i = 0; i < n + fade; i++) {
    const w = Math.random() * 2 - 1;
    if (colour === "white") {
      d[i] = w;
    } else if (colour === "pink") {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099_046;
      b1 = 0.963 * b1 + w * 0.296_516_4;
      b2 = 0.57 * b2 + w * 1.052_691_3;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      d[i] = brown;
    }
  }
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    d[i] = d[i] * t + d[n + i] * (1 - t);
  }
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += d[i] * d[i];
  }
  const k = 0.25 / Math.max(Math.sqrt(sum / n), 1e-6);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) {
    out[i] = d[i] * k;
  }
  return buffer;
}

/** A dark, diffuse two-second tail: stereo noise, decaying and dulled. */
export function airImpulse(ctx: BaseAudioContext, seconds = 2.4): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      // A slower attack than a room: the far city, not a hall.
      const env = Math.min(1, t / 0.03) * Math.exp(-t / (seconds / 5));
      lp += 0.18 * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
  }
  return buffer;
}

function biquad(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  Q = 0.7
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

/** Connects nodes in a line; returns the last. */
function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 1; i < nodes.length; i++) {
    nodes[i - 1].connect(nodes[i]);
  }
  return nodes[nodes.length - 1];
}

/** Disconnects a one-shot's nodes once its source has ended. */
function freeOnEnd(source: AudioScheduledSourceNode, nodes: AudioNode[]) {
  source.onended = () => {
    for (const node of nodes) {
      node.disconnect();
    }
  };
}

/** A looping bed: a noise loop, its filters, a level and a stereo pan. */
export interface Bed {
  filter: BiquadFilterNode;
  level: GainNode;
  pan: StereoPannerNode;
  stop: () => void;
}

interface BedSpec {
  colour: NoiseColour;
  /** the filter the engine moves (the wind's gust corner) */
  shape: [BiquadFilterType, number, number];
  /** further fixed filters */
  more?: [BiquadFilterType, number, number][];
  /** slow swell: rate (Hz) and depth (0..1) */
  swell?: [number, number];
}

export const BED_SPECS = {
  wind: { colour: "pink", shape: ["lowpass", 480, 0.5] },
  hum: {
    colour: "brown",
    shape: ["lowpass", 170, 0.5],
    more: [["highpass", 35, 0.7]],
    swell: [0.05, 0.15],
  },
  water: {
    colour: "pink",
    shape: ["lowpass", 700, 0.5],
    more: [["highpass", 110, 0.7]],
    swell: [0.17, 0.18],
  },
  fountain: {
    colour: "white",
    shape: ["bandpass", 1900, 0.45],
    more: [["highpass", 450, 0.7]],
    swell: [0.9, 0.12],
  },
  leaves: {
    colour: "white",
    shape: ["highpass", 2200, 0.5],
    more: [["lowpass", 6500, 0.5]],
  },
} satisfies Record<string, BedSpec>;

export type BedName = keyof typeof BED_SPECS;

export function createBed(
  ctx: AudioContext,
  noise: Record<NoiseColour, AudioBuffer>,
  spec: BedSpec,
  out: AudioNode
): Bed {
  const src = ctx.createBufferSource();
  src.buffer = noise[spec.colour];
  src.loop = true;
  const [type, freq, q] = spec.shape;
  const filter = biquad(ctx, type, freq, q);
  const fixed = (spec.more ?? []).map(([t, f, k]) => biquad(ctx, t, f, k));
  const swellGain = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = 0;
  const pan = ctx.createStereoPanner();
  chain(src, filter, ...fixed, swellGain, level, pan, out);
  const extras: AudioScheduledSourceNode[] = [];
  if (spec.swell) {
    const [rate, depth] = spec.swell;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate * (0.9 + 0.2 * Math.random());
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = depth;
    swellGain.gain.value = 1 - depth;
    lfo.connect(lfoDepth).connect(swellGain.gain);
    lfo.start();
    extras.push(lfo);
  }
  src.start(ctx.currentTime, Math.random() * (src.buffer?.duration ?? 1));
  return {
    filter,
    level,
    pan,
    stop: () => {
      for (const s of [src, ...extras]) {
        s.stop();
      }
      pan.disconnect();
    },
  };
}

/** Two crickets, each a pulsed high sine gated into trills. */
export function createCrickets(ctx: AudioContext, out: AudioNode): Bed {
  const level = ctx.createGain();
  level.gain.value = 0;
  const filter = biquad(ctx, "lowpass", 6000, 0.5);
  const pan = ctx.createStereoPanner();
  chain(level, filter, pan, out);
  const sources: OscillatorNode[] = [];
  const cricket = (
    freq: number,
    pulse: number,
    trill: number,
    side: number
  ) => {
    const carrier = ctx.createOscillator();
    carrier.frequency.value = freq;
    const pulseGain = ctx.createGain();
    pulseGain.gain.value = 0.5;
    const trillGain = ctx.createGain();
    trillGain.gain.value = 0.5;
    const place = ctx.createStereoPanner();
    place.pan.value = side;
    chain(carrier, pulseGain, trillGain, place, level);
    for (const [rate, param] of [
      [pulse, pulseGain.gain],
      [trill, trillGain.gain],
    ] as const) {
      const lfo = ctx.createOscillator();
      lfo.type = "square";
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(param);
      sources.push(lfo);
    }
    sources.push(carrier);
  };
  cricket(4300, 29, 0.85, -0.5);
  cricket(4680, 33, 1.3, 0.45);
  for (const s of sources) {
    s.start();
  }
  return {
    filter,
    level,
    pan,
    stop: () => {
      for (const s of sources) {
        s.stop();
      }
      pan.disconnect();
    },
  };
}

/** Moves a bed's level (and, where given, its pan) without a jump. */
export function setBed(bed: Bed, gain: number, now: number, pan?: number) {
  bed.level.gain.setTargetAtTime(gain, now, RAMP_S);
  if (pan !== undefined) {
    bed.pan.pan.setTargetAtTime(pan, now, RAMP_S * 2);
  }
}

// --- events -------------------------------------------------------------------

/** Where an event sounds from: its pan, level and air absorption. */
export interface Placement {
  cutoff: number;
  gain: number;
  pan: number;
}

/** The node an event's voices feed: a panned, dulled, levelled input. */
function placed(
  ctx: AudioContext,
  at: Placement,
  out: AudioNode,
  when: number
) {
  const input = ctx.createGain();
  input.gain.value = at.gain;
  const lp = biquad(ctx, "lowpass", at.cutoff, 0.5);
  const pan = ctx.createStereoPanner();
  pan.pan.value = at.pan;
  chain(input, lp, pan, out);
  return {
    input,
    /** frees the placement once everything scheduled is past */
    freeAfter: (seconds: number) => {
      const timer = ctx.createConstantSource();
      timer.connect(input);
      timer.offset.value = 0;
      timer.start(when);
      timer.stop(when + seconds);
      freeOnEnd(timer, [input, lp, pan, timer]);
    },
  };
}

/** A sine with an envelope: attack, a glide to `f1`, a soft release. */
function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  f0: number,
  f1: number,
  dur: number,
  amp: number,
  harmonic = 0
) {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + Math.min(0.012, dur / 4));
  env.gain.setTargetAtTime(0, t + dur * 0.6, dur / 5);
  chain(osc, env, out);
  const nodes: AudioNode[] = [osc, env];
  if (harmonic > 0) {
    const h = ctx.createOscillator();
    h.frequency.setValueAtTime(f0 * 2, t);
    h.frequency.exponentialRampToValueAtTime(f1 * 2, t + dur);
    const hg = ctx.createGain();
    hg.gain.value = harmonic;
    chain(h, hg, env);
    h.start(t);
    h.stop(t + dur + 0.2);
    nodes.push(h, hg);
  }
  osc.start(t);
  osc.stop(t + dur + 0.2);
  freeOnEnd(osc, nodes);
}

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];
const jitter = (v: number, by: number) =>
  v * (1 + (Math.random() * 2 - 1) * by);

function sparrow(ctx: AudioContext, out: AudioNode, t: number): number {
  const notes = 2 + Math.floor(Math.random() * 3);
  let at = t;
  for (let i = 0; i < notes; i++) {
    const f = jitter(4200, 0.08);
    tone(ctx, out, at, f * 0.86, f, 0.025, 0.7, 0.18);
    tone(ctx, out, at + 0.025, f, f * 0.72, 0.05, 0.7, 0.18);
    at += jitter(0.15, 0.2);
  }
  return at - t + 0.2;
}

function tit(ctx: AudioContext, out: AudioNode, t: number): number {
  const high = jitter(6600, 0.04);
  const low = jitter(4800, 0.04);
  let at = t;
  for (let i = 0; i < 3; i++) {
    tone(ctx, out, at, high, high * 0.94, 0.09, 0.55);
    tone(ctx, out, at + 0.13, low, low * 0.98, 0.11, 0.6);
    at += 0.38;
  }
  return at - t + 0.2;
}

/** The blackbird's fluting phrase, a random walk over a pentatonic-ish
 *  set, ending in a quiet twitter. */
const BLACKBIRD_HZ = [1760, 1975, 2217, 2349, 2637, 2960, 3136];

function blackbird(ctx: AudioContext, out: AudioNode, t: number): number {
  const notes = 5 + Math.floor(Math.random() * 4);
  let k = Math.floor(Math.random() * BLACKBIRD_HZ.length);
  let at = t;
  for (let i = 0; i < notes; i++) {
    k = Math.min(
      Math.max(k + pick([-2, -1, -1, 1, 1, 2]), 0),
      BLACKBIRD_HZ.length - 1
    );
    const f = BLACKBIRD_HZ[k];
    const dur = jitter(0.17, 0.45);
    tone(ctx, out, at, f, jitter(f, 0.06), dur, 0.55, 0.06);
    at += dur + jitter(0.05, 0.5);
  }
  for (let i = 0; i < 4; i++) {
    const f = jitter(5400, 0.1);
    tone(ctx, out, at, f, f * 0.8, 0.03, 0.18);
    at += 0.05;
  }
  return at - t + 0.3;
}

const BIRDS: Record<BirdCall, typeof sparrow> = { sparrow, tit, blackbird };

/** One bird call from a placement. */
export function birdCallAt(
  ctx: AudioContext,
  call: BirdCall,
  at: Placement,
  out: AudioNode,
  t: number
) {
  const place = placed(ctx, at, out, t);
  place.freeAfter(BIRDS[call](ctx, place.input, t) + 0.5);
}

interface StepSpec {
  amp: number;
  dur: number;
  filter: [BiquadFilterType, number, number];
  /** heel and toe: a second click this much later (s) */
  toe?: number;
  /** gravel's crunch, grass's rustle: short grains over the step */
  grains?: [number, number];
  thump: [number, number];
}

const STEPS: Record<StepSurface, StepSpec> = {
  asphalt: {
    amp: 0.5,
    dur: 0.07,
    filter: ["lowpass", 900, 0.7],
    thump: [75, 0.5],
  },
  concrete: {
    amp: 0.55,
    dur: 0.06,
    filter: ["bandpass", 1100, 0.9],
    thump: [85, 0.4],
  },
  paving: {
    amp: 0.6,
    dur: 0.055,
    filter: ["bandpass", 1400, 1.1],
    thump: [90, 0.4],
  },
  sett: {
    amp: 0.7,
    dur: 0.04,
    filter: ["bandpass", 2000, 1.4],
    thump: [100, 0.35],
    toe: 0.02,
  },
  gravel: {
    amp: 0.35,
    dur: 0.16,
    filter: ["highpass", 2600, 0.7],
    thump: [70, 0.25],
    grains: [9, 0.6],
  },
  grass: {
    amp: 0.4,
    dur: 0.12,
    filter: ["lowpass", 520, 0.5],
    thump: [60, 0.3],
    grains: [3, 0.15],
  },
};

function burst(
  ctx: AudioContext,
  noise: AudioBuffer,
  out: AudioNode,
  t: number,
  filter: [BiquadFilterType, number, number],
  dur: number,
  amp: number
) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const [type, f, q] = filter;
  const bq = biquad(ctx, type, jitter(f, 0.08), q);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp, t + 0.004);
  env.gain.setTargetAtTime(0, t + 0.004, dur / 3);
  chain(src, bq, env, out);
  src.start(t, Math.random() * (noise.duration - 1), dur * 2 + 0.05);
  freeOnEnd(src, [src, bq, env]);
}

/** One footstep on a surface. */
export function footstep(
  ctx: AudioContext,
  noise: AudioBuffer,
  surface: StepSurface,
  out: AudioNode,
  t: number,
  pan: number
) {
  const spec = STEPS[surface];
  const place = placed(
    ctx,
    { gain: jitter(1, 0.12), pan, cutoff: 9000 },
    out,
    t
  );
  burst(ctx, noise, place.input, t, spec.filter, spec.dur, spec.amp);
  if (spec.toe) {
    burst(
      ctx,
      noise,
      place.input,
      t + spec.toe,
      spec.filter,
      spec.dur * 0.7,
      spec.amp * 0.55
    );
  }
  if (spec.grains) {
    const [n, amp] = spec.grains;
    for (let i = 0; i < n; i++) {
      burst(
        ctx,
        noise,
        place.input,
        t + Math.random() * spec.dur,
        ["highpass", 3000, 0.7],
        jitter(0.012, 0.4),
        amp * (0.3 + 0.7 * Math.random())
      );
    }
  }
  const [hz, amp] = spec.thump;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(jitter(hz, 0.1), t);
  osc.frequency.exponentialRampToValueAtTime(hz * 0.6, t + 0.08);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(amp * spec.amp, t + 0.006);
  env.gain.setTargetAtTime(0, t + 0.006, 0.025);
  chain(osc, env, place.input);
  osc.start(t);
  osc.stop(t + 0.2);
  freeOnEnd(osc, [osc, env]);
  place.freeAfter(0.4);
}

/** Shorter ring for the smaller bells. */
const BELL_RING: Record<BellSize, number> = {
  large: 1,
  medium: 0.8,
  small: 0.6,
};

/**
 * One stroke of a church bell: the minor-third partials (lib/city/
 * soundscape.ts BELL_PARTIALS), each detuned a hair so the hum beats
 * slowly, and a soft strike.
 */
export function bellStroke(
  ctx: AudioContext,
  noise: AudioBuffer,
  size: BellSize,
  at: Placement,
  out: AudioNode,
  t: number
) {
  const place = placed(ctx, at, out, t);
  const prime = BELL_PRIME_HZ[size];
  const ring = BELL_RING[size];
  let longest = 0;
  for (const p of BELL_PARTIALS) {
    for (const detune of p.ratio === 0.5 ? [-0.35, 0.35] : [0]) {
      const osc = ctx.createOscillator();
      osc.frequency.value =
        prime * p.ratio * (1 + (Math.random() - 0.5) * 0.002) + detune;
      const env = ctx.createGain();
      const amp = p.amp * (p.ratio === 0.5 ? 0.6 : 1);
      const decay = p.decay * ring;
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.006);
      env.gain.setTargetAtTime(0, t + 0.006, decay / 3);
      chain(osc, env, place.input);
      osc.start(t);
      osc.stop(t + decay * 1.6);
      freeOnEnd(osc, [osc, env]);
      longest = Math.max(longest, decay * 1.6);
    }
  }
  burst(ctx, noise, place.input, t, ["bandpass", prime * 5, 2], 0.03, 0.25);
  place.freeAfter(longest + 0.2);
}

/** A tram's "ding-ding": a small bright bell, twice. */
export function tramBell(
  ctx: AudioContext,
  at: Placement,
  out: AudioNode,
  t: number
) {
  const place = placed(ctx, at, out, t);
  for (const start of [t, t + 0.3]) {
    for (const [ratio, amp, decay] of [
      [1, 1, 1.3],
      [2.4, 0.35, 0.7],
      [3.9, 0.18, 0.45],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 1175 * ratio;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(amp, start + 0.004);
      env.gain.setTargetAtTime(0, start + 0.004, decay / 3);
      chain(osc, env, place.input);
      osc.start(start);
      osc.stop(start + decay * 1.6);
      freeOnEnd(osc, [osc, env]);
    }
  }
  place.freeAfter(2.6);
}
