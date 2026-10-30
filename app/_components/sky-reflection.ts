import {
  CubeCamera,
  CubeRenderTarget,
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  type Scene,
  type WebGPURenderer,
} from "three/webgpu";
import { cubeTexture, dot, float, reflect } from "three/tsl";
import type { F, V3 } from "./shader-chunks";
import { viewDirection } from "./view-direction";

/**
 * Spiegelung: the sky in glass, gilding and fountain water (the river is
 * matte, water-layer.ts).
 *
 * The scene has no environment map on purpose — set on the scene, one
 * would light every surface with its diffuse irradiance too and lift the
 * clay out of its matte look. So the reflection is a term of its own,
 * sampled only by the few materials that mirror: a cube map of the sky
 * dome alone (the sun rig keeps a second `SkyMesh` in a scene of its own,
 * fed the same sun and haze), 64 px a face, its mip chain the blur.
 *
 * Not three's PMREMGenerator: since r187 it renders cube targets of at
 * least 256 px a face plus a source cube as large (≈ 10 MB), where the
 * mirrors read a soft gradient at roughness 0.15–0.3 — a GGX lobe a few
 * texels wide, which the box-filtered mips of a small cube match. This
 * one holds 6 × 64² half floats with mips and a depth buffer, ≈ 0.4 MB.
 *
 * It mirrors the sky only, never the city: what lies across the street
 * would take screen-space reflections or baked probes, both far dearer.
 * The map is re-rendered when the sun or the palette moves (`refresh`,
 * throttled to a visible change), never per frame; a material reads it
 * through `skyReflection`, weighted by the `Spiegelung` row — at 0 every
 * material draws exactly what it drew before.
 *
 * One target for the module, like glass.ts's backdrop: the materials'
 * nodes hold its texture, which stays the same object across refreshes
 * and app instances (a new renderer uploads it anew).
 */

/** Cube face edge in texels. */
const CUBE_SIZE = 64;

/**
 * The mip a roughness of 1 reads: three's PMREM convention, whose
 * roughest level is 8 px a face (log2 64 − 3), so a roughness maps to
 * the same blur it did through PMREMNode (`roughnessToMip`).
 */
const MAX_LOD = Math.log2(CUBE_SIZE) - 3;

function createTarget(): CubeRenderTarget {
  const target = new CubeRenderTarget(CUBE_SIZE, {
    minFilter: LinearMipmapLinearFilter,
    generateMipmaps: true,
    type: HalfFloatType,
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: true,
  });
  target.texture.name = "SkyReflection";
  return target;
}

const target = createTarget();

/** Spiegelung's strength (0..1), one constant every mirroring material
 *  reads: the full sky, fixed since its slider went (plan 073). */
export const REFLECTIONS: F = float(1);

/** GPU bytes the reflection holds: six faces of half-float RGBA with
 *  their mips (a third more) and a 32-bit depth buffer. */
export const SKY_REFLECTION_BYTES =
  6 * CUBE_SIZE * CUBE_SIZE * ((8 * 4) / 3 + 4);

/**
 * The sky seen in a mirror with world normal `n`, blurred by `roughness`
 * (0 sharp, 1 a wash of the whole hemisphere) — linear radiance, not yet
 * weighted by `REFLECTIONS` or a Fresnel term.
 */
export function skyReflection(n: V3, roughness: F | number): V3 {
  const incident = viewDirection();
  const r = (
    typeof roughness === "number" ? float(roughness) : roughness
  ).clamp(0, 1);
  return cubeTexture(target.texture, reflect(incident, n)).level(
    r.mul(float(2).sub(r)).mul(MAX_LOD)
  ).rgb;
}

/**
 * How much a mirror shows at this angle: `base` face on, rising to 1 at
 * a grazing view (a softened Schlick: the fourth power, not the fifth, so
 * a facade seen along the street already catches the sky).
 */
export function mirrorWeight(n: V3, base: number): F {
  const view = viewDirection().negate();
  const grazing = float(1).sub(dot(view, n).abs().clamp(0, 1));
  return float(base).add(float(1 - base).mul(grazing.pow(4)));
}

/** Smallest sun move (radians) that re-renders the map. */
const MIN_TURN = (0.5 * Math.PI) / 180;

/**
 * Least time (ms) between two renders while the time of day is dragged:
 * a drag turns the sun by degrees a step, and each render is the dome on
 * six faces and their mips — four a second keep the mirrors moving with
 * the sky.
 */
const PREVIEW_INTERVAL_MS = 250;

interface Direction {
  x: number;
  y: number;
  z: number;
}

export interface SkyReflection {
  /**
   * Re-renders the map from `skyScene` once the sun turned by a visible
   * angle (the palette follows the sun's altitude, so it moves with it) —
   * call outside a frame. `preview` (a step of a drag) renders at most
   * every `PREVIEW_INTERVAL_MS`, the last step after the wait; a plain
   * call renders at once.
   */
  refresh: (sunDirection: Direction, preview?: boolean) => void;
  dispose: () => void;
}

/** The app's reflection: a cube camera over the module's one target. */
export function createSkyReflection(
  renderer: WebGPURenderer,
  skyScene: Scene
): SkyReflection {
  // The dome sits at the cube camera (its own onBeforeRender), 4.5 km
  // across: near and far keep it whole.
  const camera = new CubeCamera(1, 10_000, target);
  let last: Direction | null = null;
  let next: Direction = { x: 0, y: 1, z: 0 };
  let renderedAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const render = () => {
    const sun = next;
    if (
      last &&
      Math.acos(Math.min(1, last.x * sun.x + last.y * sun.y + last.z * sun.z)) <
        MIN_TURN
    ) {
      return;
    }
    last = sun;
    renderedAt = performance.now();
    // Every face cleared whatever the app's clear settings, as three's
    // own PMREMGenerator.fromScene does.
    const { autoClear, autoClearColor, autoClearDepth } = renderer;
    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    camera.update(renderer, skyScene);
    renderer.autoClear = autoClear;
    renderer.autoClearColor = autoClearColor;
    renderer.autoClearDepth = autoClearDepth;
  };
  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  return {
    refresh: (sun, preview = false) => {
      next = { x: sun.x, y: sun.y, z: sun.z };
      if (!preview) {
        cancel();
        render();
        return;
      }
      if (timer !== null) {
        return;
      }
      const wait = renderedAt + PREVIEW_INTERVAL_MS - performance.now();
      if (wait <= 0) {
        render();
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        render();
      }, wait);
    },
    dispose: () => {
      cancel();
      target.dispose();
    },
  };
}
