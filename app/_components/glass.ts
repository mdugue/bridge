import { FramebufferTexture, HalfFloatType, LinearFilter } from "three/webgpu";
import {
  abs,
  cameraWorldMatrix,
  clamp,
  dot,
  float,
  fract,
  luminance,
  max,
  mix,
  normalView,
  positionView,
  pow,
  reflect,
  screenUV,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  viewportTexture,
} from "three/tsl";
import { type DataMarks } from "@/lib/city/render-style";
import { mapFadeNode } from "./map-overlay";
import type { F, Live, V3 } from "./shader-chunks";
import { styleNight } from "./sun-rig";
import { eyeDirectionView, viewParallel } from "./view-direction";

/**
 * The data layers' glass (ADR 0040): bodies that tint and bend what lies
 * behind them instead of covering it — the traffic flows, the bicycle
 * columns.
 *
 * Not `transmission`: that renders the whole scene again for every frame
 * the glass is in (ADR 0010). Here the scene is copied ONCE per frame, in
 * the frame's own render, at the moment the first glass draws — the
 * transparent objects come after every opaque one, so the copy holds the
 * city, the ground and the water — and every glass body samples that copy
 * with its UV bent by its own normal: a refraction, a whisper of
 * dispersion (the three channels bent by slightly different amounts), a
 * milky tint deepening at grazing angles, the sky's sheen and a bright
 * Fresnel rim. From the air (`mapFadeNode`) and far off the glass thickens
 * into its own colour, so a layer reads as a map there and as glass up
 * close. Glass
 * does not see glass (the copy is taken before the first one draws). The
 * copy is one texture the size of the scene target; while no data layer
 * is on, nothing samples it and no copy is made.
 *
 * The copy keeps the scene target's format (half float): WebGPU copies
 * only between equal formats, and three's shared viewport texture is 8 bit.
 * One base node, sampled through `.sample(uv)`: every material's sample
 * refers to it, so the copy is made once per render, not once per material.
 */

// Sized to the render target by the node on its first copy.
const backdropTexture = new FramebufferTexture(1, 1);
backdropTexture.type = HalfFloatType;
backdropTexture.minFilter = LinearFilter;
backdropTexture.magFilter = LinearFilter;
backdropTexture.generateMipmaps = false;
backdropTexture.name = "DataGlassBackdrop";

const backdrop = viewportTexture(screenUV, null, backdropTexture);

/** The data layers' own clock (s): the flowing light in the traffic, the
 *  rising rings in the bicycle columns. One uniform, written per frame by
 *  the render loop (create-app.ts). */
export const dataTime: Live = uniform(0);

export function setDataTime(seconds: number): void {
  dataTime.value = seconds;
}

export interface GlassOptions {
  /** the glass's colour (what it lets through, and its milk) */
  tint: V3;
  /** how strongly it bends what is behind it, in screen fractions at a
   *  hand's breadth (default 0.035) */
  bend?: number;
  /** 0 = clear, 1 = the tint alone (default 0.55) */
  density?: F | number;
  /** how bright the rim is (default 0.55) */
  rim?: number;
}

/** How much of the glass a ray grazes: 0 face on, 1 at the silhouette. */
export function glassGrazing(): F {
  const facing = abs(dot(normalView, eyeDirectionView()));
  return float(1).sub(facing).clamp(0, 1);
}

/**
 * The colour of a glass surface: what is behind it, bent, tinted and
 * rimmed. For a transparent, unlit material (opacity 1: the glass mixes
 * the backdrop itself).
 */
export function glassColour(opts: GlassOptions): V3 {
  const grazing = glassGrazing();
  const fresnel = pow(grazing, 3);
  // The bend in screen space, smaller with distance so a far body does
  // not smear the skyline; stronger where the ray grazes (a thicker path).
  const near = clamp(float(18).div(positionView.z.negate().max(1)), 0.12, 1);
  const bend = float(opts.bend ?? 0.035)
    .mul(near)
    .mul(grazing.mul(0.6).add(0.4));
  // screenUV runs down the screen, the view normal's y up
  const offset = vec2(normalView.x, normalView.y.negate()).mul(bend);
  const at = (k: number) => screenUV.add(offset.mul(k)).clamp(0.001, 0.999);
  const behind = vec3(
    backdrop.sample(at(1.12)).r,
    backdrop.sample(at(1)).g,
    backdrop.sample(at(0.88)).b
  );
  const density =
    typeof opts.density === "number"
      ? float(opts.density)
      : (opts.density ?? float(0.55));
  // From the air, and far off, clear glass would vanish into what it
  // stands on: there it thickens into its own colour — the map reading —
  // while up close it stays clear enough to see the street through.
  const far = smoothstep(180, 900, positionView.z.negate());
  const map = mapFadeNode().max(far);
  // Absorption by the tint, deeper at grazing angles (a longer path
  // through the glass), and a little milk of its own colour.
  const depth = mix(
    density.mul(grazing.mul(0.5).add(0.75)),
    float(0.9),
    map.mul(0.75)
  ).clamp(0, 1);
  const tinted = mix(behind, behind.mul(opts.tint).mul(1.15), depth).add(
    opts.tint.mul(depth.mul(0.18).add(map.mul(0.22)))
  );
  const rim = mix(opts.tint, vec3(1), 0.55).mul(fresnel.mul(opts.rim ?? 0.55));
  // The sky in it: what the surface mirrors, brighter where it faces up
  // and where the eye grazes it — the sheen that makes glass read as glass.
  const mirrored = reflect(eyeDirectionView().negate(), normalView);
  const sky = mirrored
    .transformDirection(cameraWorldMatrix)
    .y.clamp(0, 1)
    .pow(2)
    .mul(fresnel.mul(0.55).add(0.08));
  return tinted.add(rim).add(vec3(0.95, 0.97, 1).mul(sky));
}

/**
 * How the data marks draw under the picture style (render-style.ts
 * `dataMarks`), as one shared uniform the post stack writes with the
 * style: every data material is one program in every style, and a switch
 * builds nothing. The marks draw themselves in the styles that swap the
 * scene's materials, too (`userData.paperOwn`, paper-scene.ts): they are
 * what the viewer switched on, and a swap would hide them as see-through
 * sheets.
 */
export const dataMarks: Live = uniform(0);

/** `dataMarks`' value per kind. */
export const DATA_MARKS: Readonly<Record<DataMarks, number>> = {
  glass: 0,
  print: 1,
  light: 2,
  red: 3,
  tissue: 4,
  plan: 5,
  outline: 6,
};

export interface DataMarkInputs {
  /** the mark as Pastell draws it: its glass and its light */
  glass: V3;
  /** the mark's own colour */
  tint: V3;
  /** 0..1, where the mark sits on its own scale (traffic's load, a
   *  column's direction): Comic's ink and Strich's plan colour */
  scale: F;
  /** 0..1, the light moving in it (the traffic's comets, the rising
   *  rings, a tram's head) */
  light: F;
  /** 0..1, the mark's edge as the eye sees it (default: its grazing) */
  edge?: F;
  /** 0..1, its ridge — the middle of a band (default: none) */
  ridge?: F;
  /** 0..1, what of it the Schwarzplan inks black (default: its edge, wider
   *  than `edge`'s; a thin mark, a tram's trail, is one black line) */
  ink?: F;
  /** 0..1, how stale the mark's data is: a style draws it without its
   *  colour (Pastell's own tint already says so) */
  muted?: F;
  /** false for a mark its alpha blends over the scene (a tram's trail):
   *  it reads no copy of the scene, so none is made for it alone — its
   *  blend lays it over what is behind (default true) */
  backdrop?: boolean;
}

/** 1 while the marks draw as `kind`, else 0 — a mix per kind, not a
 *  select: a select's arms are scopes, and a node first built in one arm
 *  is not there in the next. */
export function dataMarksAre(kind: DataMarks): F {
  return step(abs(dataMarks.sub(DATA_MARKS[kind])), 0.5);
}

/**
 * A blended mark's alpha under the style: Comic prints only what reaches
 * the frame as a full marker ink, so there it is opaque or gone (a
 * half-blended ink falls out of the pass's print and is drawn as clay).
 */
export function dataMarkAlpha(alpha: F): F {
  return mix(alpha, step(0.3, alpha), dataMarksAre("print"));
}

/** A fully saturated colour of hue `h` (0..1) at value 0.9, one channel
 *  at zero: what Comic's pass reads as a marker ink (stylize-effect.ts). */
function marker(h: F): V3 {
  const k = fract(vec3(h).add(vec3(0, 2 / 3, 1 / 3)))
    .mul(6)
    .sub(3);
  return abs(k).sub(1).clamp(0, 1).mul(0.9);
}

/** Where on the marker hues Comic's data inks lie (stylize-effect.ts
 *  `DATA_HUE`): blue (low) to rose (high), clear of the crowns'. */
export const DATA_HUE = { from: 0.55, to: 0.95 } as const;

/**
 * A data mark's colour under the picture style (`dataMarks`) — the
 * reading each style knows for a mark laid over its picture:
 * - glass (Pastell): the glass as it is.
 * - print (Comic): a marker ink the pass prints flat in a pop ink of the
 *   mark's place on its scale (blue, yellow, red), its light white, its
 *   edge a black contour.
 * - light (Film noir): a long exposure — the mark a dark glass, its light
 *   white streaks.
 * - red (Sin City): the one colour the panel carries — oxblood, its light
 *   a bright red.
 * - tissue (Papier): coloured tissue paper over the white model; at night
 *   lit from inside, like the windows.
 * - plan (Strich): a plan's colour (blue to violet with the scale), edged
 *   with the pen; at night a warm light the etching leaves white.
 * - outline (Schwarzplan): white, edged in black, its light dashed along
 *   its ridge — a band of lines in the plan, not a fill its threshold
 *   would drop.
 */
export function dataMarkColour(i: DataMarkInputs): V3 {
  const edge = i.edge ?? smoothstep(0.72, 0.9, glassGrazing());
  const behind =
    i.backdrop === false ? null : backdrop.sample(screenUV).rgb.toVar();
  const light = i.light.clamp(0, 1);
  // (its light decided whole: a half-white marker is no longer a marker
  // ink to the pass, and printed as clay — a speckled halo)
  const printed = mix(
    mix(
      marker(mix(DATA_HUE.from, DATA_HUE.to, i.scale)),
      vec3(1),
      step(0.5, light)
    ),
    vec3(0.02),
    // (whole, as the light: a half-black marker is no ink to the pass)
    step(0.5, edge)
  );
  // (a blended mark: a dark glass, and a tissue over the white card)
  const exposure = (behind?.mul(0.55) ?? vec3(0)).add(
    vec3(1, 0.97, 0.9).mul(light.mul(1.4))
  );
  const red = mix(vec3(0.55, 0.012, 0.03), vec3(1, 0.36, 0.36), light);
  // (the tints are pastel: the tissue's colour is the tint, twice as
  // vivid, so it stays a colour on the white card)
  const vivid = mix(vec3(luminance(i.tint)), i.tint, 2.2).clamp(0, 1);
  const pale = mix(vec3(1), vivid, 0.75);
  const card = behind ?? vec3(1);
  const tissue = mix(card, card.mul(pale).add(pale.mul(0.12)), 0.8)
    .add(i.tint.mul(styleNight.mul(0.35)))
    .add(light.mul(0.25));
  const plan = mix(
    mix(vec3(0.55, 0.63, 0.88), vec3(0.42, 0.24, 0.62), i.scale),
    vec3(1),
    light.mul(0.6)
  );
  const glowing = vec3(1, 0.82, 0.5).mul(light.mul(0.6).add(0.55));
  // (a plan — Modell's parallel view — has no night: its marks keep their
  // plan colours)
  const planNight = styleNight.mul(float(1).sub(viewParallel));
  const planned = mix(
    mix(plan, glowing, planNight),
    vec3(0.08),
    edge.mul(float(1).sub(planNight))
  );
  // (its own, wider edge: a plan's band is two lines, its light a dashed
  // line along its ridge — a dash as wide as the band read as a blot)
  const outlined = mix(
    vec3(1),
    vec3(0),
    max(
      i.ink ?? i.edge ?? smoothstep(0.5, 0.7, glassGrazing()),
      step(0.5, light).mul(i.ridge ?? 0)
    )
  );
  const is = dataMarksAre;
  let col = i.glass;
  col = mix(col, printed, is("print"));
  col = mix(col, exposure, is("light"));
  col = mix(col, red, is("red"));
  col = mix(col, tissue, is("tissue"));
  col = mix(col, planned, is("plan"));
  col = mix(col, outlined, is("outline"));
  // stale data: the style's mark without its colour
  const grey = vec3(luminance(col));
  return mix(col, grey, (i.muted ?? float(0)).mul(float(1).sub(is("glass"))));
}
