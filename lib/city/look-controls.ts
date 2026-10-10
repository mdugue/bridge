/**
 * The look controls, declared ONCE. The HUD renders sliders from this table,
 * the look store (look-state.ts) clamps and holds one value per row, the
 * snapshot codec (snapshot.ts) serialises one `<snapshotKey>` per row, and
 * the scene applies the values to its materials — add a control here and
 * every consumer follows. No THREE, no DOM (the e2e harness imports this
 * file).
 */
import { DATA_LAYER_DEFAULTS, type DataLayerKey } from "./data-layers";
import { DEFAULT_RENDER_STYLE, type RenderStyle } from "./render-style";

export type LookGroup = "atmosphere" | "buildings" | "rendering" | "vegetation";

/** Rows the scene itself applies: fog, the valley haze, the ground, the sky's reflection. */
export type SceneLookKey =
  | "fogAmount"
  | "groundDetail"
  | "heightFog"
  | "horizonShade"
  | "meadowNdvi"
  | "reflections"
  | "skyView"
  | "urbanGreen";
/** Rows the shared clay material applies (visual-style.ts). */
export type ClayLookKey =
  | "articulation"
  | "bands"
  | "duskGlow"
  | "eave"
  | "facadeReading"
  | "groundShade"
  | "rim"
  | "roofTint"
  | "roofVibrance"
  | "roughness"
  | "tint"
  | "windows";
/** Rows the post stack applies (post-stack.ts). */
export type PostLookKey = "contact" | "grading" | "grain" | "ink";
/** Rows every vegetation tile applies (vegetation-layer.ts). */
export type VegetationLookKey = "shimmer" | "translucency";
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
  /**
   * Key inside Snapshot.look — the persisted format. Never rename one (old
   * snapshots would silently lose that slider).
   */
  snapshotKey: string;
}

/**
 * Every look value the scene renders with, as the scene consumes it: the
 * table rows as 0..1 floats (percent is only how the HUD and the snapshot
 * show them), the two controls that are not percent sliders, and one flag
 * per data layer (data-layers.ts). The depth of field (autofocus), the
 * river mist and the crowns' gust brightening are no controls any more:
 * fixed at what their controls defaulted to.
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
    key: "articulation",
    id: "building-articulation",
    label: "Gliederung",
    description:
      "Gemalter Sockel, Traufgesims und Ladenzonen; Sockel und Gesims über dem Erdgeschoss sind modelliert",
    group: "buildings",
    initial: 0.8,
    snapshotKey: "articulationPct",
  },
  {
    key: "windows",
    id: "building-windows",
    label: "Fenster",
    description:
      "Fensterreihen auf jeder Fassade: Takt und Größe aus Straßenfotos, sonst vom nächsten gemessenen Haus oder vom Haustyp — vertiefte Öffnungen mit schmaler Sohlbank, ohne Glas und Sprossen",
    group: "buildings",
    initial: 1,
    snapshotKey: "windowsPct",
  },
  {
    key: "facadeReading",
    id: "building-facade-reading",
    label: "Fassadenbild",
    description:
      "Was Straßenfotos über eine Fassade sagen: feines Relief, wo sie unruhig ist, ein dunklerer Ton, Ladensockel",
    group: "buildings",
    initial: 1,
    snapshotKey: "facadeReadingPct",
  },
  {
    key: "duskGlow",
    id: "building-dusk-glow",
    label: "Abendlicht",
    description:
      "Warmes Licht in öffentlichen Bauten und Ladenfronten zur Dämmerung",
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
      "Bordsteine, Rasenkanten, Stellplätze, Fahrbahnmarkierungen, Kleingartenbeete und Beläge (Asphalt, Platten, Kopfsteinpflaster aus OpenStreetMap) aus der Nähe",
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
    key: "skyView",
    id: "sky-view",
    label: "Himmelslicht",
    description:
      "Enge Höfe und Straßenschluchten bekommen weniger Himmelslicht als offene Wiesen (Himmelssichtfaktor aus Gelände und Gebäuden)",
    group: "rendering",
    // Conservative until judged on GPU plates (plan 033): half the
    // physical darkening, so SSAO does not stack into dirt.
    initial: 0.5,
    snapshotKey: "skyViewPct",
  },
  {
    key: "horizonShade",
    id: "horizon-shade",
    label: "Ferne Schatten",
    description:
      "Schatten jenseits der Schattenkarte: ferne Gebäude und Hänge bei tiefer Sonne, in der Ferne auch die Nachbarhäuser (gebackener Horizont)",
    group: "rendering",
    // Below full strength until judged on GPU plates (plan 033).
    initial: 0.8,
    snapshotKey: "horizonShadePct",
  },
  {
    key: "reflections",
    id: "reflections",
    label: "Spiegelung",
    description:
      "Der Himmel spiegelt sich in Glasfassaden, Vergoldungen und im Wasser (nur der Himmel, nicht die Stadt)",
    group: "rendering",
    initial: 1,
    snapshotKey: "reflectionPct",
  },
  {
    key: "grain",
    id: "paper-grain",
    label: "Papierkorn",
    group: "rendering",
    initial: 0.25,
    snapshotKey: "grainPct",
  },
  {
    key: "ink",
    id: "ink-lines",
    label: "Tuschelinien",
    description:
      "Stärke der Umrisslinien in den Stilen Comic, Film noir, Sin City und Papier",
    group: "rendering",
    initial: 0.7,
    snapshotKey: "inkPct",
  },
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
