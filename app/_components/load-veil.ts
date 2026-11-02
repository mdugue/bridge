import { type DepthTexture, Vector2 } from "three/webgpu";
import {
  abs,
  clamp,
  dot,
  float,
  fract,
  fwidth,
  getViewPosition,
  max,
  mix,
  pow,
  reference,
  screenUV,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { BOOT_VEIL, type VeilState } from "@/lib/city/load-frontier";
import type { F, Live, V3 } from "./shader-chunks";
import { styleNight } from "./sun-rig";
import type { ViewLens } from "./view-lens";

/**
 * The loading veil (lib/city/load-frontier.ts): while the city is still
 * filling in, what lies beyond the loading frontier is drawn as unfired
 * clay — its colour drained to a darker grey — and the frontier itself as
 * a thin ring on the ground, the survey line of the city being set down.
 * The ring breathes: it draws in slowly, as if air were let in, pushes the
 * colour a little farther out, and lets it go again; and as the stream
 * fills, it walks outward until, with nothing left to come, it sweeps out
 * to the horizon and the veil lifts.
 *
 * It only ever takes away — saturation and over a third of the light
 * beyond the ring — so the unfinished picture is never brighter than the finished
 * one, in every picture style (the drained grey of Sin City is still
 * darker and flatter), and the ring's ink dims with the night.
 *
 * Drawn in the last pass (post-stack.ts `finish`), from the depth it
 * already reads: no target, no texture, a few uniforms.
 */

/** The ring's ink: the brand's magenta (globals.css `--primary`), linear. */
const RING_INK = vec3(0.42, 0.06, 0.38);
/** How much of the ring's ink the night leaves. */
const RING_NIGHT = 0.25;
/** Beyond the ring: how much colour goes, and how much light. */
const DRAIN = 0.92;
const DIM = 0.62;
/** One breath (s), the share of it spent drawing in. */
const BREATH_S = 3.4;
const INHALE = 0.68;
/** How far (m) a full breath pushes the ring out, plus its share of r. */
const BREATH_M = 10;
const BREATH_SHARE = 0.05;
/** The soft band beyond the ring (m), plus its share of r. */
const BAND_M = 18;
const BAND_SHARE = 0.12;
/** The ring's width in pixels. */
const RING_PX = 2.4;
/**
 * Beyond the ring, contour lines in height (m apart): the survey's lines
 * on the clay, a model being set down rather than a picture gone grey.
 * They fade where they would crowd under a pixel.
 */
const CONTOUR_M = 2;
const CONTOUR_INK = 0.35;
/** The ring's halo beyond it (m, plus its share of r): its ink, thinning. */
const HALO_M = 14;
const HALO_SHARE = 0.06;
const HALO_INK = 0.55;

export interface LoadVeil {
  /** the veil over a finished pixel `rgb` */
  over: (rgb: V3) => V3;
  /** the veil a frame draws (stepped by create-app.ts) */
  set: (state: VeilState, centreX: number, centreZ: number) => void;
}

/**
 * The breath, 0 → 1 → 0 over `BREATH_S`: a slow ease in, a quicker
 * release.
 */
function breath(): F {
  const phase = fract(time.div(BREATH_S));
  const inhale = smoothstep(0, INHALE, phase);
  const exhale = smoothstep(INHALE, 1, phase);
  return inhale.sub(exhale);
}

export function createLoadVeil(depth: DepthTexture, lens: ViewLens): LoadVeil {
  const radius: Live = uniform(BOOT_VEIL.radius);
  const strength: Live = uniform(BOOT_VEIL.strength);
  const centre = uniform(new Vector2());
  // the lens's own matrix, written in place every frame
  const cameraWorld = uniform(lens.camera.matrixWorld);
  const far = reference("far", "float", lens.camera);

  const over = (rgb: V3): V3 => {
    const z = texture(depth, screenUV).r;
    const view = getViewPosition(screenUV, z, lens.inverseProjection);
    const world = cameraWorld.mul(vec4(view, 1)).xyz;
    const d = world.xz.sub(centre).length();
    const b = breath();
    const ring = radius.add(b.mul(radius.mul(BREATH_SHARE).add(BREATH_M)));
    const band = radius.mul(BAND_SHARE).add(BAND_M);
    const beyond = smoothstep(ring, ring.add(band), d).mul(strength);
    const luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    // a breath in lets a little colour back in
    const drain = float(DRAIN).sub(b.mul(0.1));
    const clay = mix(rgb, vec3(luma), drain).mul(DIM);
    // the ground and walls, not the sky (the far plane)
    const solid = step(view.z.negate(), far.mul(0.97));
    // the contours, AA'd on their own derivative, gone where too dense
    // and in the sky
    const h = world.y.div(CONTOUR_M);
    const hw = max(fwidth(h), 1e-4);
    const contour = clamp(
      float(1).sub(abs(fract(h.add(0.5)).sub(0.5)).div(hw.mul(1.2))),
      0,
      1
    )
      .mul(float(1).sub(smoothstep(0.12, 0.3, hw)))
      .mul(solid);
    const clayLined = clay.mul(float(1).sub(contour.mul(CONTOUR_INK)));
    const veiled = mix(rgb, clayLined, beyond);
    // The ring: a line RING_PX wide where the ground (or a wall) crosses
    // it. A silhouette's depth jump has a wide fwidth: no line there.
    const w = max(fwidth(d), 1e-3);
    const onRing = clamp(
      float(1).sub(abs(d.sub(ring)).div(w.mul(RING_PX))),
      0,
      1
    );
    const smooth = step(w, max(d.mul(0.03), 2));
    const ink = mix(float(1), float(RING_NIGHT), styleNight);
    // the halo: the ring's ink soaking into the clay just beyond it
    const halo = float(1)
      .sub(smoothstep(0, radius.mul(HALO_SHARE).add(HALO_M), d.sub(ring)))
      .mul(step(ring, d))
      .mul(solid)
      .mul(strength)
      .mul(ink)
      .mul(HALO_INK);
    const haloed = veiled.mul(mix(vec3(1), RING_INK.mul(2.2).min(1), halo));
    const line = pow(onRing, 1.5).mul(smooth).mul(solid).mul(strength);
    // By day the ink only darkens what it lies on; at night, on a city
    // near black, it is a dim line of its own colour.
    const dayInk = haloed.min(RING_INK.mul(1.9));
    const nightInk = RING_INK.mul(RING_NIGHT);
    return mix(haloed, mix(dayInk, nightInk, styleNight), line);
  };

  return {
    over,
    set: (state, centreX, centreZ) => {
      radius.value = state.radius;
      strength.value = state.strength;
      centre.value.set(centreX, centreZ);
    },
  };
}
