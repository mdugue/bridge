import { clamp01 } from "./math";
/**
 * The load pipeline as the HUD shows it: five named stages with a fixed share
 * of the bar each, declared ONCE. `create-app.ts` reports a fraction per stage
 * (see `CityWalkOptions.onStage`), the loading screen renders the stack and the
 * list from these states, and the streaming pill renders the same stages as
 * segments — one model, two sizes.
 *
 * The order is the order the scene actually loads in, not a designed ideal: the
 * spawn tile's buildings land first, then its terrain, then the sun
 * rig and the materials. Those three are everything the first frame needs, so
 * they end at WALKABLE_PERCENT — the handover point where the overlay becomes
 * the pill and you can start walking. The rest streams in behind the scene,
 * and "the rest" is what the cameras see, not the whole site: the tiles in
 * view (the tile renderer's own load progress) and their details. Tiles out
 * of view are never part of the bar; a flight loads them later.
 *
 * No THREE, no DOM: `create-app.ts` and the HUD both import it, and the unit
 * test drives it directly.
 */

export type LoadStageId =
  | "buildings"
  | "details"
  | "light"
  | "surroundings"
  | "terrain";

export interface LoadStageDef {
  /** swatch / plate colour — the layer's own material read as a flat tone */
  color: string;
  id: LoadStageId;
  label: string;
  /** the data behind the stage, in the list's monospace sub-line */
  meta: string;
  /**
   * Stages that stack as a plate on the loading screen. The light stage is
   * not one: it adds no data layer, it lights the ones already there.
   */
  plate: boolean;
  /** headline while this stage is the active one */
  status: string;
  /** the same thing at pill size, where there is room for three words */
  streaming: string;
  /** share of the whole bar, in percent; they sum to 100 */
  weight: number;
}

/**
 * Where the scene becomes walkable: buildings + terrain + light are done, the
 * first frame is up. The divider in the loading list and the bar's "begehbar"
 * tick both sit here.
 */
export const WALKABLE_PERCENT = 52;

/**
 * The weights are fixed estimates of each stage's share of a cold load, not
 * measurements — they keep the bar's pace roughly even on a warm cache. What
 * is real is each stage's own fraction, which the scene reports as it loads.
 */
export const LOAD_STAGES: readonly LoadStageDef[] = [
  {
    id: "buildings",
    label: "Gebäude",
    meta: "LoD2 · Baukörper der Startkachel",
    status: "Gebäude werden geladen",
    streaming: "Gebäude laden",
    color: "#ece7df",
    plate: true,
    weight: 30,
  },
  {
    id: "terrain",
    label: "Gelände",
    meta: "DGM1 · Höhenfeld",
    status: "Gelände wird geladen",
    streaming: "Gelände lädt",
    color: "#cdbf9c",
    plate: true,
    weight: 15,
  },
  {
    id: "light",
    label: "Sonne & Schatten",
    meta: "Sonnenstand, Schattenkarte, Materialien",
    status: "Licht und Schatten werden berechnet",
    streaming: "Licht wird berechnet",
    color: "#f0c79a",
    plate: false,
    weight: 7,
  },
  {
    id: "surroundings",
    label: "Umgebung",
    meta: "Kacheln im Blick · nah detailliert, fern grob",
    status: "Bereit — die Umgebung kommt dazu",
    streaming: "Umgebung lädt",
    color: "#e6e0d1",
    plate: true,
    weight: 22,
  },
  {
    id: "details",
    label: "Bäume, Lampen, Schienen, Mauern",
    meta: "DOM1-Kronen · Basis-DLM · OpenStreetMap",
    status: "Bereit — Bäume, Lampen und Schienen kommen dazu",
    streaming: "Details laden",
    color: "#a6bf92",
    plate: true,
    weight: 26,
  },
];

/**
 * One report from the scene: how far a stage has got. `create-app.ts` emits
 * these; the HUD folds them into a `StageFractions` record.
 */
export interface LoadStageUpdate {
  /** 0..1 within the stage */
  fraction: number;
  id: LoadStageId;
  /** the scene will never run this stage (no other tiles in the lite profile) */
  skipped?: boolean;
}

/** How far each stage has got, 0..1. A missing entry means "not started". */
export type StageFractions = Readonly<Partial<Record<LoadStageId, number>>>;

/**
 * Stages the scene will never run — the `lite` profile streams the spawn
 * tile alone, so it has no surroundings. They count as
 * complete so the bar still reaches 100, but the list says so.
 */
export type SkippedStages = Readonly<Partial<Record<LoadStageId, boolean>>>;

export interface LoadStageState extends LoadStageDef {
  /** running right now: started, not finished */
  active: boolean;
  /** true once this stage is finished — a skipped stage is done too */
  done: boolean;
  /** 0..1 within this stage */
  fraction: number;
  /** not started yet */
  pending: boolean;
  /** true once the walkable cut is behind this stage (the list divider) */
  showsDividerBefore: boolean;
  skipped: boolean;
  /** right-hand column of the list: "geladen" / "42 %" / "lädt…" / "wartet" */
  stateText: string;
}

function stateTextFor(
  fraction: number,
  active: boolean,
  skipped: boolean
): string {
  if (skipped) {
    return "entfällt";
  }
  if (fraction >= 1) {
    return "geladen";
  }
  if (!active) {
    return "wartet";
  }
  // A stage the scene can only report as started or finished (no byte stream
  // behind it) would otherwise sit at a stuck "0 %".
  return fraction > 0 ? `${Math.round(fraction * 100)} %` : "lädt…";
}

/**
 * The stages resolved against what has been reported so far. A stage is
 * "active" once anything has been reported for it and it is not finished, so
 * the headline and the pulsing plate follow the scene rather than a timer.
 */
export function loadStageStates(
  fractions: StageFractions,
  skipped: SkippedStages = {}
): LoadStageState[] {
  let walkableSeen = 0;
  return LOAD_STAGES.map((def) => {
    const isSkipped = skipped[def.id] === true;
    const fraction = isSkipped ? 1 : clamp01(fractions[def.id] ?? 0);
    const started = def.id in fractions || isSkipped;
    const done = fraction >= 1;
    walkableSeen += def.weight;
    return {
      ...def,
      fraction,
      done,
      active: started && !done,
      pending: !started,
      skipped: isSkipped,
      showsDividerBefore: walkableSeen - def.weight === WALKABLE_PERCENT,
      stateText: stateTextFor(fraction, started && !done, isSkipped),
    };
  });
}

/** The whole bar, 0..100 — each stage's fraction times its weight. */
export function loadPercent(
  fractions: StageFractions,
  skipped: SkippedStages = {}
): number {
  return loadStageStates(fractions, skipped).reduce(
    (sum, stage) => sum + stage.fraction * stage.weight,
    0
  );
}

/** The stage driving the headline, or null when nothing is in flight. */
export function activeStage(states: LoadStageState[]): LoadStageState | null {
  return states.find((stage) => stage.active) ?? null;
}

/** The headline above the list: the active stage's status, or the end state. */
export function loadHeadline(states: LoadStageState[]): string {
  const active = activeStage(states);
  if (active) {
    return active.status;
  }
  if (states.every((stage) => stage.done)) {
    return "Alles geladen";
  }
  // Nothing in flight and not finished: either the scene has not reported
  // anything yet (the first moments, every row still "wartet") or we are
  // between two stages. Only the second of those is walkable.
  const done = states
    .filter((stage) => stage.done)
    .reduce((sum, stage) => sum + stage.weight, 0);
  return done >= WALKABLE_PERCENT
    ? "Bereit — du kannst losgehen"
    : "Szene wird vorbereitet";
}

/**
 * The pill's line. It has a case the loading screen does not: between the
 * first frame and the start of the streaming tail nothing is in flight — the
 * scene holds that work back so it cannot stutter the handover animation — and
 * "Alles geladen" would be a plain lie with three layers still to come.
 */
export function streamingTitle(states: LoadStageState[]): string {
  const active = activeStage(states);
  if (active) {
    return active.streaming;
  }
  return states.every((stage) => stage.done)
    ? "Alles geladen"
    : "Rest wird geladen";
}

/** "3/6" for the pill: how many stages are behind us. */
export function stagesDoneLabel(states: LoadStageState[]): string {
  return `${states.filter((stage) => stage.done).length}/${states.length}`;
}
