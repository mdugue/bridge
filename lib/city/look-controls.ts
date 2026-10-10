/**
 * The look controls, declared ONCE. The HUD renders sliders from this table,
 * the look store (look-state.ts) clamps and holds one value per row, the
 * snapshot codec (snapshot.ts) serialises one `<snapshotKey>` per row, and
 * the scene applies the values to its materials — add a control here and
 * every consumer follows. It holds the controls people use (*Nebel*); the
 * look's tuning lives as named constants with the terms it tunes. No
 * THREE, no DOM (the e2e harness imports this file).
 */
import { DATA_LAYER_DEFAULTS, type DataLayerKey } from "./data-layers";
import { DEFAULT_RENDER_STYLE, type RenderStyle } from "./render-style";

/**
 * Every percent row. Its owner applies it through a `Record<LookKey, …>`
 * the compiler keeps complete (create-app.ts `sceneRows`), so a row added
 * here without a writer is a type error, never a slider that renders
 * nothing.
 */
export type LookKey = "fogAmount";

export interface LookControlDef {
  /** slider help text (also the row's documentation) */
  description?: string;
  /** DOM id of the slider (stable: tests find controls by it) */
  id: string;
  /** the value the scene boots with (0..1) */
  initial: number;
  /** state key */
  key: LookKey;
  label: string;
  /**
   * Key inside Snapshot.look — the persisted format. Never rename one (old
   * snapshots would silently lose that slider), and never reuse a retired
   * one (`RETIRED_SNAPSHOT_KEYS`).
   */
  snapshotKey: string;
}

/**
 * Every look value the scene renders with, as the scene consumes it: the
 * table rows as 0..1 floats (percent is only how the HUD and the snapshot
 * show them), the two controls that are not percent sliders, and one flag
 * per data layer (data-layers.ts). The look's other terms have no control:
 * each is a named constant in its owner, fixed at what its slider stood at
 * by default (ADR 0017, amended 2026-10).
 */
export interface LookValues
  extends Record<LookKey, number>, Record<DataLayerKey, boolean> {
  /** rich multi-tuft crown near the camera (LOD); off = cheap crown everywhere */
  multiTuft: boolean;
  /** the picture style (render-style.ts): pastel, comic, film noir, Sin City, Papier */
  style: RenderStyle;
}

/** One row per slider, in the order the HUD renders them. */
export const LOOK_CONTROLS: readonly LookControlDef[] = [
  {
    key: "fogAmount",
    id: "atmosphere",
    label: "Nebel",
    description: undefined,
    initial: 0.2,
    snapshotKey: "fogPct",
  },
];

/**
 * Snapshot keys of controls that are gone (2026-10-10: plan 073 and the
 * performance PR before it). An old snapshot carrying one still loads —
 * the key is unknown, kept and ignored on Apply — and no row may ever take
 * one again, or a pasted old snapshot would set the new control.
 */
export const RETIRED_SNAPSHOT_KEYS: readonly string[] = [
  // the performance PR: see-through buildings, the leaf flutter and its
  // gust brightness, the river mist, the depth of field's switch and focus
  "transparencyPct",
  "leafFlutterPct",
  "leafBrightPct",
  "waterMistPct",
  "dof",
  "focusMode",
  "focusDistanceM",
  // plan 073: every slider but Nebel
  "heightFogPct",
  "gradingPct",
  "groundShadePct",
  "bandsPct",
  "rimPct",
  "tintPct",
  "roofTintPct",
  "roofVibrancePct",
  "eavePct",
  "articulationPct",
  "windowsPct",
  "facadeReadingPct",
  "duskGlowPct",
  "roughnessPct",
  "groundDetailPct",
  "urbanGreenPct",
  "meadowNdviPct",
  "shimmerPct",
  "translucencyPct",
  "contactPct",
  "skyViewPct",
  "horizonShadePct",
  "reflectionPct",
  "grainPct",
  "inkPct",
];

export const LOOK_BY_KEY: Readonly<Record<LookKey, LookControlDef>> =
  Object.fromEntries(LOOK_CONTROLS.map((def) => [def.key, def])) as Record<
    LookKey,
    LookControlDef
  >;

/** What the scene boots with: each row's `initial` plus the two flags,
 *  every data layer off. */
export const LOOK_DEFAULTS: Readonly<LookValues> = Object.freeze<LookValues>({
  ...(Object.fromEntries(
    LOOK_CONTROLS.map((def) => [def.key, def.initial])
  ) as Record<LookKey, number>),
  multiTuft: true,
  style: DEFAULT_RENDER_STYLE,
  ...DATA_LAYER_DEFAULTS,
});

/** A one-row patch for the look store (`{ [key]: value01 }`, typed). */
export function lookPatch(key: LookKey, value01: number): Partial<LookValues> {
  const patch: Partial<LookValues> = {};
  patch[key] = value01;
  return patch;
}
