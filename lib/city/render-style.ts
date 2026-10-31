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

/**
 * How a style swaps the scene's materials for its frames (paper-scene.ts):
 * Papier's white card, Strich's white model on the plan-coloured ground,
 * Sin City's white card with black foliage and water and red roofs (by
 * day), the Schwarzplan's black buildings on white with nothing else
 * drawn.
 */
export type PaperKind = "figure" | "ink" | "line" | "paper";

export type RenderStyle =
  | "comic"
  | "figure"
  | "line"
  | "noir"
  | "paper"
  | "pastel"
  | "sincity";

/**
 * The instant a style always draws at, whatever the HUD's date and time
 * (`styleInstant`): a style whose picture is cut from one light of its own
 * (Sin City's hard afternoon sun) or knows no light at all (the
 * Schwarzplan) would only break under another one. The HUD keeps its date
 * and greys its sun controls out with `note` while the style is on.
 */
export interface OwnLight {
  /** month, 0-based like Date's */
  month: number;
  day: number;
  /** minutes of the day in UTC: the sun must stand where the style
   *  needs it over the site (every site is in Germany, 2 h ahead in
   *  summer), wherever the viewer is */
  minutes: number;
  /** why the time does not apply (German, like the HUD) */
  note: string;
}

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
  /** weight on the depth grading (warm near / cool far; post-stack.ts
   *  `GRADING`); 0 for monochrome */
  gradingWeight: number;
  /** animated film grain instead of the static paper speckle */
  grainAnimated: boolean;
  /** weight on the paper grain (post-stack.ts `GRAIN`) */
  grainWeight: number;
  /**
   * Draw every surface with one material under the real light
   * (paper-scene.ts), or null for the scene's own. Papier and Strich: white
   * surfaces with true shading, which no post pass can recover from
   * colour; the Schwarzplan: the buildings black and nothing else.
   */
  paperScene: PaperKind | null;
  /** stable id — persisted in snapshots, never rename */
  id: RenderStyle;
  /** weight on the outline strength (post-stack.ts `INK`) */
  inkWeight: number;
  label: string;
  /** Soft light cones under the street lamps (style-dressing.ts). */
  lampCones: boolean;
  /** the style's own instant, or null to follow the HUD's (`OwnLight`) */
  ownLight: OwnLight | null;
  /**
   * The stylize pass's shader mode (stylize-effect.ts); 0 = the pass is off,
   * which is what keeps the default style free.
   */
  shaderMode: number;
  /**
   * How far the tree crowns sway in the wind (0..1; vegetation-layer.ts
   * `crownSwayShare`). A style whose shade is a pen's hatch laid on the
   * world holds its crowns still: a swaying crown slides under the hatch,
   * and every line on it crawls.
   */
  sway: number;
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
    sway: 1,
    paperScene: null,
    crowns: null,
    ownLight: null,
    lampCones: false,
    vignette: { offset: 0.28, darkness: 0.5 },
    swatch: ["#efe6d8", "#b9c7d6"],
  },
  {
    id: "comic",
    label: "Comic",
    description:
      "Pop-Art: wenige knallige Druckfarben, kräftige schwarze Konturen, Rasterpunkte im Schatten",
    shaderMode: 1,
    inkWeight: 1.2,
    // Printing inks: no warm/cool grade over them.
    gradingWeight: 0,
    grainWeight: 0.6,
    grainAnimated: false,
    allowDof: false,
    sway: 1,
    paperScene: null,
    crowns: "comic",
    ownLight: null,
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
    sway: 1,
    paperScene: null,
    crowns: null,
    ownLight: null,
    lampCones: true,
    vignette: { offset: 0.12, darkness: 0.9 },
    swatch: ["#c9c9c4", "#1b1b1d"],
  },
  {
    id: "sincity",
    label: "Sin City",
    description:
      "Harte Schwarzweiß-Flächen aus Sonne und Schatten, Bäume und Wasser tiefschwarz — nur die roten Dächer behalten Farbe",
    shaderMode: 3,
    inkWeight: 0.8,
    gradingWeight: 0,
    grainWeight: 0.35,
    grainAnimated: true,
    allowDof: false,
    sway: 1,
    paperScene: "ink",
    crowns: null,
    ownLight: {
      month: 8,
      day: 15,
      minutes: 14 * 60 + 30,
      note: "Sin City zeichnet immer im selben harten Nachmittagslicht: Datum und Uhrzeit gelten wieder, sobald du den Stil wechselst.",
    },
    lampCones: false,
    vignette: { offset: 0.3, darkness: 0.45 },
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
    sway: 1,
    paperScene: "paper",
    crowns: "paper",
    ownLight: null,
    lampCones: false,
    vignette: { offset: 0.32, darkness: 0.28 },
    swatch: ["#f4f0e8", "#7a8092"],
  },
  {
    id: "line",
    label: "Strich",
    description:
      "Strichzeichnung wie im Plan: weißes Modell, gleich starke Linien, Schatten als hellgraue Lasur, das Gelände in Planfarben",
    shaderMode: 5,
    inkWeight: 1,
    gradingWeight: 0,
    // a clean sheet: barely a grain
    grainWeight: 0.3,
    grainAnimated: false,
    allowDof: false,
    sway: 0,
    paperScene: "line",
    crowns: "paper",
    ownLight: null,
    lampCones: false,
    vignette: { offset: 0.5, darkness: 0 },
    swatch: ["#fbfaf7", "#2b2d33"],
  },
  {
    id: "figure",
    label: "Schwarzplan",
    description:
      "Die Gebäude schwarz, alles andere weiß, die Katasterbäume als Kronenkreise — keine Schatten; gemacht für den Lageplan",
    shaderMode: 6,
    // the figure is the drawing: only the hairline that parts two blocks
    inkWeight: 1,
    gradingWeight: 0,
    grainWeight: 0,
    grainAnimated: false,
    allowDof: false,
    sway: 0,
    paperScene: "figure",
    crowns: null,
    ownLight: {
      month: 5,
      day: 21,
      minutes: 11 * 60,
      note: "Der Schwarzplan kennt weder Licht noch Schatten: Datum und Uhrzeit gelten wieder, sobald du den Stil wechselst.",
    },
    lampCones: false,
    vignette: { offset: 0.5, darkness: 0 },
    swatch: ["#ffffff", "#111111"],
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

/**
 * The instant the scene draws at under `style`: the HUD's `asked` one, or
 * the style's own (`OwnLight`) in the same year.
 */
export function styleInstant(style: RenderStyleDef, asked: Date): Date {
  const own = style.ownLight;
  if (!own) {
    return asked;
  }
  return new Date(
    Date.UTC(asked.getFullYear(), own.month, own.day, 0, own.minutes)
  );
}

/** The style after `current` in picker order, wrapping around (the V key). */
export function nextRenderStyle(current: RenderStyle): RenderStyle {
  const index = RENDER_STYLES.findIndex((def) => def.id === current);
  return RENDER_STYLES[(index + 1) % RENDER_STYLES.length]?.id ?? current;
}
