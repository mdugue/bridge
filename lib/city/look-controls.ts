/**
 * The look controls, declared ONCE. The HUD renders sliders from this table,
 * the look store (look-state.ts) clamps and holds one value per row, the
 * snapshot codec (snapshot.ts) serialises one `<snapshotKey>` per row, and
 * the scene applies the values to its materials — add a control here and
 * every consumer follows. No THREE, no DOM (the e2e harness imports this
 * file).
 */
export type LookGroup = "atmosphere" | "buildings" | "rendering" | "vegetation";

/** Rows the scene itself applies: fog, the valley haze, the ground, the river mist. */
export type SceneLookKey =
  | "fogAmount"
  | "groundDetail"
  | "heightFog"
  | "meadowNdvi"
  | "urbanGreen"
  | "waterMist";
/** Rows the shared clay material applies (visual-style.ts). */
export type ClayLookKey =
  | "bands"
  | "duskGlow"
  | "eave"
  | "groundShade"
  | "rim"
  | "roofTint"
  | "roofVibrance"
  | "roughness"
  | "tint"
  | "transparency";
/** Rows the post stack applies (post-stack.ts). */
export type PostLookKey = "contact" | "grading" | "grain";
/** Rows every vegetation tile applies (vegetation-layer.ts). */
export type VegetationLookKey =
  | "leafBright"
  | "leafFlutter"
  | "shimmer"
  | "translucency";
/**
 * Every percent row. Each key belongs to exactly one owner union above, and
 * each owner applies its rows through a `Record<…LookKey, …>` the compiler
 * keeps complete — so a row added here without an owner entry is a type
 * error, never a slider that renders nothing.
 */
export type LookKey =
  | ClayLookKey
  | PostLookKey
  | SceneLookKey
  | VegetationLookKey;

/** Depth-of-field focus: "auto" tracks the crosshair, "manual" uses a fixed distance. */
export type FocusMode = "auto" | "manual";

export interface LookControlDef {
  /** slider help text (also the row's documentation) */
  description?: string;
  group: LookGroup;
  /** DOM id of the slider (stable: tests find controls by it) */
  id: string;
  /** the value the scene boots with (0..1) */
  initial: number;
  /** state key */
  key: LookKey;
  label: string;
  /** slider maximum in percent (default 100) */
  max?: number;
  /**
   * Key inside Snapshot.look — the persisted format. Never rename one (old
   * snapshots would silently lose that slider).
   */
  snapshotKey: string;
}

/**
 * Every look value the scene renders with, as the scene consumes it: the
 * table rows as 0..1 floats (percent is only how the HUD and the snapshot
 * show them) plus the four controls that are not percent sliders.
 */
export interface LookValues extends Record<LookKey, number> {
  /** photographic depth of field with crosshair autofocus */
  dof: boolean;
  /** manual focus distance (m), used when focusMode is "manual" */
  focusDistanceM: number;
  focusMode: FocusMode;
  /** rich multi-tuft crown near the camera (LOD); off = cheap crown everywhere */
  multiTuft: boolean;
}

/** One row per slider, in the order the HUD renders them. */
export const LOOK_CONTROLS: readonly LookControlDef[] = [
  // --- Atmosphere ---
  {
    key: "fogAmount",
    id: "atmosphere",
    label: "Nebel",
    description: undefined,
    group: "atmosphere",
    initial: 0.2,
    snapshotKey: "fogPct",
  },
  {
    key: "heightFog",
    id: "height-fog",
    label: "Talnebel",
    description: "Dunst am Talboden und über der Elbe",
    group: "atmosphere",
    // Light — a faint valley haze on a clear day; pairs with the ~0.2
    // distance fog for a regular day. Dial up for foggy-morning moods.
    initial: 0.2,
    snapshotKey: "heightFogPct",
  },
  {
    key: "waterMist",
    id: "water-mist",
    label: "Flussnebel",
    description: "Treibender Nebel über dem Fluss",
    group: "atmosphere",
    initial: 0.6,
    snapshotKey: "waterMistPct",
  },
  {
    key: "grading",
    id: "depth-grading",
    label: "Tiefenfärbung",
    description: "Warm nah, kühl fern",
    group: "atmosphere",
    initial: 0.5,
    snapshotKey: "gradingPct",
  },
  // --- Buildings ---
  {
    key: "transparency",
    id: "building-transparency",
    label: "Transparenz",
    description: "Einfaches Durchsehen",
    group: "buildings",
    initial: 0,
    max: 90,
    snapshotKey: "transparencyPct",
  },
  {
    key: "groundShade",
    id: "building-ground-shade",
    label: "Boden-Verlauf",
    group: "buildings",
    initial: 0.34,
    snapshotKey: "groundShadePct",
  },
  {
    key: "bands",
    id: "building-bands",
    label: "Höhenlinien",
    group: "buildings",
    initial: 0.18,
    snapshotKey: "bandsPct",
  },
  {
    key: "rim",
    id: "building-rim",
    label: "Streiflicht",
    group: "buildings",
    initial: 0.6,
    snapshotKey: "rimPct",
  },
  {
    key: "tint",
    id: "building-tint",
    label: "Farbvariation",
    description:
      "Tonfarbe je Gebäude aus Nutzung & Höhe, in den Grundton gemischt",
    group: "buildings",
    // A middling mix already breaks the uniform massing while staying painterly.
    initial: 0.6,
    snapshotKey: "tintPct",
  },
  {
    key: "roofTint",
    id: "building-roof-tint",
    label: "Dachfarbe",
    description: "Terrakotta oder Schiefer je Dach, aus Dachform & Neigung",
    group: "buildings",
    // Roofs carry more colour than walls — they are the strongest readability cue.
    initial: 0.7,
    snapshotKey: "roofTintPct",
  },
  {
    key: "roofVibrance",
    id: "building-roof-vibrance",
    label: "Dachsättigung",
    description:
      "Hebt die Leuchtkraft der Dachfarben, ohne den Farbton zu verschieben — Kupfergrün, Terrakotta und Schiefer gleichermaßen (0 = rohes Luftbild)",
    group: "buildings",
    initial: 0.5,
    snapshotKey: "roofVibrancePct",
  },
  {
    key: "eave",
    id: "building-eave",
    label: "Traufkante",
    description: "Weiche Kante, wo Wand auf Dach trifft",
    group: "buildings",
    initial: 0.35,
    snapshotKey: "eavePct",
  },
  {
    key: "duskGlow",
    id: "building-dusk-glow",
    label: "Abendlicht",
    description:
      "Warmes Licht in öffentlichen und gewerblichen Bauten zur Dämmerung",
    group: "buildings",
    initial: 0.5,
    snapshotKey: "duskGlowPct",
  },
  {
    key: "roughness",
    id: "building-roughness",
    label: "Materialstreuung",
    description: "Feine Streuung zwischen matt und seidig je Gebäude",
    group: "buildings",
    initial: 0.12,
    snapshotKey: "roughnessPct",
  },
  // --- Vegetation ---
  {
    key: "groundDetail",
    id: "ground-detail",
    label: "Bodendetail",
    description:
      "Bordsteine, Rasenkanten, Stellplätze und Beläge (Asphalt, Platten, Kopfsteinpflaster aus OpenStreetMap) aus der Nähe",
    group: "vegetation",
    initial: 0.7,
    snapshotKey: "groundDetailPct",
  },
  {
    key: "urbanGreen",
    id: "urban-green",
    label: "Stadtgrün",
    description:
      "Zeigt begrünte Höfe, Vorgärten und Parks im Siedlungsgebiet (aus dem DOP-Infrarot, NDVI) als Wiese",
    group: "vegetation",
    initial: 1,
    snapshotKey: "urbanGreenPct",
  },
  {
    key: "meadowNdvi",
    id: "meadow-ndvi",
    label: "Wiesenfärbung",
    description: "Färbt Wiesen saftig↔trocken aus dem DOP-Infrarot (NDVI)",
    group: "vegetation",
    // A middling default reads without looking like a heat map.
    initial: 0.6,
    snapshotKey: "meadowNdviPct",
  },
  {
    key: "shimmer",
    id: "tree-shimmer",
    label: "Gegenlicht-Schimmer",
    group: "vegetation",
    initial: 0.45,
    snapshotKey: "shimmerPct",
  },
  {
    key: "translucency",
    id: "tree-translucency",
    label: "Blattdurchscheinen",
    description: "Durchleuchtete nahe und große Kronen (schattenabhängig)",
    group: "vegetation",
    initial: 0.5,
    snapshotKey: "translucencyPct",
  },
  {
    key: "leafFlutter",
    id: "tree-leaf-flutter",
    label: "Blattflimmern",
    description:
      "(A) Windböen lassen Blätter ihre helle Unterseite zeigen — Farbe flimmert über sonnige Kronen. 0 = nur (B) sichtbar.",
    group: "vegetation",
    initial: 0.5,
    snapshotKey: "leafFlutterPct",
  },
  {
    key: "leafBright",
    id: "tree-leaf-bright",
    label: "Windhelligkeit",
    description:
      "(B) Krone hellt auf, wenn sie sich in die Böe neigt (an die Wiege-Bewegung gekoppelt). 0 = nur (A) sichtbar.",
    group: "vegetation",
    initial: 0.5,
    snapshotKey: "leafBrightPct",
  },
  // --- Rendering ---
  {
    key: "contact",
    id: "contact-shadows",
    label: "Kontaktschatten",
    group: "rendering",
    initial: 0.5,
    snapshotKey: "contactPct",
  },
  {
    key: "grain",
    id: "paper-grain",
    label: "Papierkorn",
    group: "rendering",
    initial: 0.25,
    snapshotKey: "grainPct",
  },
];

export const LOOK_BY_KEY: Readonly<Record<LookKey, LookControlDef>> =
  Object.fromEntries(LOOK_CONTROLS.map((def) => [def.key, def])) as Record<
    LookKey,
    LookControlDef
  >;

/** What the scene boots with: each row's `initial` plus the four flags. */
export const LOOK_DEFAULTS: Readonly<LookValues> = Object.freeze<LookValues>({
  ...(Object.fromEntries(
    LOOK_CONTROLS.map((def) => [def.key, def.initial])
  ) as Record<LookKey, number>),
  dof: true,
  focusMode: "auto",
  focusDistanceM: 40,
  multiTuft: true,
});

/** A row's slider maximum as a 0..1 value. */
export function maxValueOf(def: LookControlDef): number {
  return (def.max ?? 100) / 100;
}

/** A one-row patch for the look store (`{ [key]: value01 }`, typed). */
export function lookPatch(key: LookKey, value01: number): Partial<LookValues> {
  const patch: Partial<LookValues> = {};
  patch[key] = value01;
  return patch;
}
