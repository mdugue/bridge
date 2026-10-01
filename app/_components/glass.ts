import { FramebufferTexture, HalfFloatType, LinearFilter } from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  mix,
  normalView,
  positionView,
  positionViewDirection,
  pow,
  reflectVector,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  viewportTexture,
} from "three/tsl";
import { mapFadeNode } from "./map-overlay";
import type { F, Live, V3 } from "./shader-chunks";

/**
 * The data layers' glass (ADR 0037): bodies that tint and bend what lies
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
  const facing = abs(dot(normalView, positionViewDirection));
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
  const sky = reflectVector.y
    .clamp(0, 1)
    .pow(2)
    .mul(fresnel.mul(0.55).add(0.08));
  return tinted.add(rim).add(vec3(0.95, 0.97, 1).mul(sky));
}
