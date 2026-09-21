/**
 * The 0..1 "look" controls, declared ONCE. The HUD renders sliders from this
 * table, the handle/`__poc` expose one setter per row, and snapshots
 * serialise one `<snapshotKey>` per row — add a control here and every
 * consumer follows. No THREE, no DOM (the e2e harness imports this file).
 */
export type LookGroup = "atmosphere" | "buildings" | "rendering" | "vegetation";

export type LookSetterName =
  | "setAtmosphere"
  | "setBuildingBands"
  | "setBuildingDuskGlow"
  | "setBuildingEave"
  | "setBuildingGroundShade"
  | "setBuildingRim"
  | "setBuildingRoofTint"
  | "setBuildingRoofVibrance"
  | "setBuildingRoughness"
  | "setBuildingTint"
  | "setBuildingTransparency"
  | "setContactShadows"
  | "setDepthGrading"
  | "setHeightFog"
  | "setMeadowNdvi"
  | "setPaperGrain"
  | "setTreeLeafBright"
  | "setTreeLeafFlutter"
  | "setTreeShimmer"
  | "setTreeTranslucency"
  | "setWaterMist";

/** What every consumer of the look controls must provide: one 0..1 setter per row. */
export type LookTarget = Record<LookSetterName, (value01: number) => void>;

export type LookKey =
  | "bands"
  | "contact"
  | "duskGlow"
  | "eave"
  | "fogAmount"
  | "grading"
  | "grain"
  | "groundShade"
  | "heightFog"
  | "leafBright"
  | "leafFlutter"
  | "meadowNdvi"
  | "rim"
  | "roofTint"
  | "roofVibrance"
  | "roughness"
  | "shimmer"
  | "tint"
  | "translucency"
  | "transparency"
  | "waterMist";

export interface LookControlDef {
  /** slider help text (also the row's documentation) */
  description?: string;
  group: LookGroup;
  /** DOM id of the slider (stable: tests find controls by it) */
  id: string;
  /** state key */
  key: LookKey;
  label: string;
  /** slider maximum in percent (default 100) */
  max?: number;
  /** handle / __poc setter that receives value / 100 */
  setter: LookSetterName;
  /**
   * Key inside Snapshot.look — the persisted format. Never rename one (old
   * snapshots would silently lose that slider).
   */
  snapshotKey: string;
}

/** Percent values (integers 0..max) of every look control. */
export type LookPct = Record<LookKey, number>;

/** One row per slider, in the order the HUD renders them. */
export const LOOK_CONTROLS: readonly LookControlDef[] = [
  // --- Atmosphere ---
  {
    key: "fogAmount",
    id: "atmosphere",
    label: "Fog",
    description: undefined,
    group: "atmosphere",
    setter: "setAtmosphere",
    snapshotKey: "fogPct",
  },
  {
    key: "heightFog",
    id: "height-fog",
    label: "Talnebel",
    description: "Haze pooling along the valley floor / the Elbe",
    group: "atmosphere",
    setter: "setHeightFog",
    snapshotKey: "heightFogPct",
  },
  {
    key: "waterMist",
    id: "water-mist",
    label: "Flussnebel",
    description: "Drifting mist over the river",
    group: "atmosphere",
    setter: "setWaterMist",
    snapshotKey: "waterMistPct",
  },
  {
    key: "grading",
    id: "depth-grading",
    label: "Depth color · warm near, cool far",
    group: "atmosphere",
    setter: "setDepthGrading",
    snapshotKey: "gradingPct",
  },
  // --- Buildings ---
  {
    key: "transparency",
    id: "building-transparency",
    label: "Transparency",
    description: "Plain see-through",
    group: "buildings",
    max: 90,
    setter: "setBuildingTransparency",
    snapshotKey: "transparencyPct",
  },
  {
    key: "groundShade",
    id: "building-ground-shade",
    label: "Boden-Verlauf",
    group: "buildings",
    setter: "setBuildingGroundShade",
    snapshotKey: "groundShadePct",
  },
  {
    key: "bands",
    id: "building-bands",
    label: "Höhenlinien",
    group: "buildings",
    setter: "setBuildingBands",
    snapshotKey: "bandsPct",
  },
  {
    key: "rim",
    id: "building-rim",
    label: "Streiflicht",
    group: "buildings",
    setter: "setBuildingRim",
    snapshotKey: "rimPct",
  },
  {
    key: "tint",
    id: "building-tint",
    label: "Farbvariation",
    description:
      "Per-building clay tint from use & height, blended into the base",
    group: "buildings",
    setter: "setBuildingTint",
    snapshotKey: "tintPct",
  },
  {
    key: "roofTint",
    id: "building-roof-tint",
    label: "Dachfarbe",
    description: "Terracotta or slate per roof, from roofType & pitch",
    group: "buildings",
    setter: "setBuildingRoofTint",
    snapshotKey: "roofTintPct",
  },
  {
    key: "roofVibrance",
    id: "building-roof-vibrance",
    label: "Dachsättigung",
    description:
      "Lift roof colour vividness, keeping each roof's true hue — copper-green, terracotta & slate alike (0 = raw aerial)",
    group: "buildings",
    setter: "setBuildingRoofVibrance",
    snapshotKey: "roofVibrancePct",
  },
  {
    key: "eave",
    id: "building-eave",
    label: "Traufkante",
    description: "Soft cornice line where wall meets roof",
    group: "buildings",
    setter: "setBuildingEave",
    snapshotKey: "eavePct",
  },
  {
    key: "duskGlow",
    id: "building-dusk-glow",
    label: "Abendlicht",
    description: "Warm interior glow on civic/commercial buildings at dusk",
    group: "buildings",
    setter: "setBuildingDuskGlow",
    snapshotKey: "duskGlowPct",
  },
  {
    key: "roughness",
    id: "building-roughness",
    label: "Materialstreuung",
    description: "Subtle per-building matte/sheen variation",
    group: "buildings",
    setter: "setBuildingRoughness",
    snapshotKey: "roughnessPct",
  },
  // --- Vegetation ---
  {
    key: "meadowNdvi",
    id: "meadow-ndvi",
    label: "Wiesenfärbung",
    description: "Tint meadows lush-green↔dry from the DOP infrared (NDVI)",
    group: "vegetation",
    setter: "setMeadowNdvi",
    snapshotKey: "meadowNdviPct",
  },
  {
    key: "shimmer",
    id: "tree-shimmer",
    label: "Gegenlicht-Schimmer",
    group: "vegetation",
    setter: "setTreeShimmer",
    snapshotKey: "shimmerPct",
  },
  {
    key: "translucency",
    id: "tree-translucency",
    label: "Blattdurchscheinen",
    description: "Backlit glow on near/large crowns (shadow-gated)",
    group: "vegetation",
    setter: "setTreeTranslucency",
    snapshotKey: "translucencyPct",
  },
  {
    key: "leafFlutter",
    id: "tree-leaf-flutter",
    label: "Blattflimmern",
    description:
      "(A) Windböen lassen Blätter ihre helle Unterseite zeigen — Farbe flimmert über sonnige Kronen. 0 = nur (B) sichtbar.",
    group: "vegetation",
    setter: "setTreeLeafFlutter",
    snapshotKey: "leafFlutterPct",
  },
  {
    key: "leafBright",
    id: "tree-leaf-bright",
    label: "Windhelligkeit",
    description:
      "(B) Krone hellt auf, wenn sie sich in die Böe neigt (an die Wiege-Bewegung gekoppelt). 0 = nur (A) sichtbar.",
    group: "vegetation",
    setter: "setTreeLeafBright",
    snapshotKey: "leafBrightPct",
  },
  // --- Rendering ---
  {
    key: "contact",
    id: "contact-shadows",
    label: "Contact shadows",
    group: "rendering",
    setter: "setContactShadows",
    snapshotKey: "contactPct",
  },
  {
    key: "grain",
    id: "paper-grain",
    label: "Paper grain",
    group: "rendering",
    setter: "setPaperGrain",
    snapshotKey: "grainPct",
  },
];

export const LOOK_BY_KEY: Readonly<Record<LookKey, LookControlDef>> =
  Object.fromEntries(LOOK_CONTROLS.map((def) => [def.key, def])) as Record<
    LookKey,
    LookControlDef
  >;

/** Rounds to an integer percent and clamps to the control's [0, max]. */
export function clampPct(def: LookControlDef, value: number): number {
  const max = def.max ?? 100;
  return Math.min(Math.max(Math.round(value), 0), max);
}
