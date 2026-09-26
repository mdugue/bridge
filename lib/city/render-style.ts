/**
 * The picture styles (Bildstile), declared ONCE. A style is a way of drawing
 * the same scene — the clay city, the painted ground, the trees — not a
 * different scene: it lives in the post stack (post-stack.ts + the stylize
 * pass in stylize-effect.ts), so switching it at runtime rebuilds no
 * material and recompiles nothing. One style also swaps the scene's
 * materials for the frame (`paperScene`, paper-scene.ts) — a render-time
 * override, still no branch in any layer. The HUD renders its picker from this
 * table, the look store validates against it and the snapshot codec
 * persists `id`. No THREE, no DOM.
 */
/** A style's own tree crowns (style-dressing.ts), or null for the scene's. */
export type CrownStyle = "comic" | "paper";

export type RenderStyle = "comic" | "noir" | "paper" | "pastel" | "sincity";

export interface RenderStyleDef {
  /**
   * May the photographic depth of field run under this style? A graphic
   * style draws its background as crisply as its foreground; a blurred
   * plate under sharp ink lines reads as a mistake. The user's DoF switch is
   * kept, only gated (post-stack.ts), like the motion regression.
   */
  allowDof: boolean;
  /**
   * The tree crowns this style draws with (style-dressing.ts swaps them in
   * for its frames): Comic's cloud of balls, Papier's folded card, or null
   * for the scene's own lumpy crowns.
   */
  crowns: CrownStyle | null;
  /** one line for the picker (German, like the rest of the HUD) */
  description: string;
  /** weight on the depth-grading slider (warm near / cool far); 0 for monochrome */
  gradingWeight: number;
  /** animated film grain instead of the static paper speckle */
  grainAnimated: boolean;
  /** weight on the grain slider */
  grainWeight: number;
  /**
   * Draw every surface with one white paper material under the real light
   * (paper-scene.ts). Only the Papier style: its whole point is white
   * surfaces with true shading, which no post pass can recover from colour.
   */
  paperScene: boolean;
  /** stable id — persisted in snapshots, never rename */
  id: RenderStyle;
  /** weight on the ink slider (the outline strength) */
  inkWeight: number;
  label: string;
  /** Soft light cones under the street lamps (style-dressing.ts). */
  lampCones: boolean;
  /**
   * The stylize pass's shader mode (stylize-effect.ts); 0 = the pass is off,
   * which is what keeps the default style free.
   */
  shaderMode: number;
  /** two perceptual swatches for the picker: paper and ink */
  swatch: readonly [string, string];
  /** the vignette (postprocessing VignetteEffect offset/darkness) */
  vignette: { darkness: number; offset: number };
}

/** In the order the picker shows them and V cycles through them. */
export const RENDER_STYLES: readonly RenderStyleDef[] = [
  {
    id: "pastel",
    label: "Pastell",
    description: "Tonmodell auf Papier, weiches Licht — der Grundstil",
    shaderMode: 0,
    inkWeight: 0,
    gradingWeight: 1,
    grainWeight: 1,
    grainAnimated: false,
    allowDof: true,
    paperScene: false,
    crowns: null,
    lampCones: false,
    vignette: { offset: 0.28, darkness: 0.5 },
    swatch: ["#efe6d8", "#b9c7d6"],
  },
  {
    id: "comic",
    label: "Comic",
    description:
      "Feine, handgezogene Tuschelinien, flache Farbflächen, Raster im Schatten",
    shaderMode: 1,
    inkWeight: 1,
    // Keeps a hint of the warm-near/cool-far cue; the flat bands carry depth.
    gradingWeight: 0.4,
    grainWeight: 1.2,
    grainAnimated: false,
    allowDof: false,
    paperScene: false,
    crowns: "comic",
    lampCones: false,
    vignette: { offset: 0.35, darkness: 0.22 },
    swatch: ["#f6ecd2", "#e0674f"],
  },
  {
    id: "noir",
    label: "Film noir",
    description:
      "Schwarzweiß mit harter Kurve, rauchige Ferne, Filmkorn und dunkler Rand",
    shaderMode: 2,
    inkWeight: 0.3,
    gradingWeight: 0,
    grainWeight: 1.6,
    grainAnimated: true,
    allowDof: true,
    paperScene: false,
    crowns: null,
    lampCones: true,
    vignette: { offset: 0.12, darkness: 0.9 },
    swatch: ["#c9c9c4", "#1b1b1d"],
  },
  {
    id: "sincity",
    label: "Sin City",
    description:
      "Harte schwarze und weiße Flächen, schwarze Bäume, die Skyline weiß gegen die Nacht — nur die roten Dächer behalten Farbe",
    shaderMode: 3,
    inkWeight: 0.8,
    gradingWeight: 0,
    grainWeight: 0.5,
    grainAnimated: true,
    allowDof: false,
    paperScene: false,
    crowns: null,
    lampCones: false,
    vignette: { offset: 0.25, darkness: 0.55 },
    swatch: ["#f4f4f0", "#c1121f"],
  },
  {
    id: "paper",
    label: "Papier",
    description:
      "Die Stadt als weißes Papiermodell: echtes Licht und Schatten, feine, gezeichnete Konturen",
    shaderMode: 4,
    inkWeight: 1,
    // The duotone carries the light; a warm/cool grade would tint the paper.
    gradingWeight: 0,
    grainWeight: 1.1,
    grainAnimated: false,
    // A shallow focus on a white model reads as a miniature — welcome here.
    allowDof: true,
    paperScene: true,
    crowns: "paper",
    lampCones: false,
    vignette: { offset: 0.32, darkness: 0.28 },
    swatch: ["#f4f0e8", "#7a8092"],
  },
];

export const DEFAULT_RENDER_STYLE: RenderStyle = "pastel";

export const RENDER_STYLE_BY_ID: Readonly<Record<RenderStyle, RenderStyleDef>> =
  Object.fromEntries(RENDER_STYLES.map((def) => [def.id, def])) as Record<
    RenderStyle,
    RenderStyleDef
  >;

export function isRenderStyle(value: unknown): value is RenderStyle {
  return (
    typeof value === "string" &&
    RENDER_STYLES.some((def) => def.id === (value as RenderStyle))
  );
}

/** The style after `current` in picker order, wrapping around (the V key). */
export function nextRenderStyle(current: RenderStyle): RenderStyle {
  const index = RENDER_STYLES.findIndex((def) => def.id === current);
  return RENDER_STYLES[(index + 1) % RENDER_STYLES.length]?.id ?? current;
}
