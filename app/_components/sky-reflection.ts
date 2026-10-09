import {
  CubeUVReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  PMREMGenerator,
  RenderTarget,
  RGBAFormat,
  type Scene,
  type WebGPURenderer,
} from "three/webgpu";
import {
  cameraPosition,
  dot,
  float,
  normalize,
  pmremTexture,
  positionWorld,
  reflect,
  uniform,
} from "three/tsl";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { F, Live, V3 } from "./shader-chunks";

/**
 * Spiegelung: the sky in glass, gilding and water.
 *
 * The scene has no environment map on purpose — set on the scene, one
 * would light every surface with its diffuse irradiance too and lift the
 * clay out of its matte look. So the reflection is a term of its own,
 * sampled only by the few materials that mirror: a PMREM of the sky dome
 * alone (the sun rig keeps a second `SkyMesh` in a scene of its own,
 * fed the same sun and haze), 64 px a cube face — the sky is a soft
 * gradient, a larger map would only cost memory (336 × 256 half float,
 * ≈ 0.7 MB, and the generator's ping-pong target as much again).
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

function createTarget(): RenderTarget {
  // As PMREMGenerator allocates its own (its _createRenderTarget), so the
  // generator renders into it and PMREMNode reads it as a ready PMREM.
  const target = new RenderTarget(
    3 * Math.max(CUBE_SIZE, 16 * 7),
    4 * CUBE_SIZE,
    {
      magFilter: LinearFilter,
      minFilter: LinearFilter,
      generateMipmaps: false,
      type: HalfFloatType,
      format: RGBAFormat,
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: true,
    }
  );
  target.texture.mapping = CubeUVReflectionMapping;
  target.texture.name = "SkyReflection";
  // reason: PMREMNode takes a texture flagged so as a finished PMREM;
  // the flag is missing from Texture's @types.
  (
    target.texture as typeof target.texture & { isPMREMTexture: boolean }
  ).isPMREMTexture = true;
  target.scissorTest = true;
  return target;
}

const target = createTarget();

/** The `Spiegelung` row (0..1), one uniform every mirroring material reads. */
export const reflectionStrength: Live = uniform(LOOK_DEFAULTS.reflections);

/** GPU bytes the reflection holds: its map and the generator's ping-pong. */
export const SKY_REFLECTION_BYTES = 2 * target.width * target.height * 8;

/**
 * The sky seen in a mirror with world normal `n`, blurred by `roughness`
 * (0 sharp, 1 a wash of the whole hemisphere) — linear radiance, not yet
 * weighted by the row or a Fresnel term.
 */
export function skyReflection(n: V3, roughness: F | number): V3 {
  const incident = normalize(positionWorld.sub(cameraPosition));
  const level = typeof roughness === "number" ? float(roughness) : roughness;
  return pmremTexture(target.texture, reflect(incident, n), level);
}

/**
 * How much a mirror shows at this angle: `base` face on, rising to 1 at
 * a grazing view (a softened Schlick: the fourth power, not the fifth, so
 * a facade seen along the street already catches the sky).
 */
export function mirrorWeight(n: V3, base: number): F {
  const view = normalize(cameraPosition.sub(positionWorld));
  const grazing = float(1).sub(dot(view, n).abs().clamp(0, 1));
  return float(base).add(float(1 - base).mul(grazing.pow(4)));
}

/** Smallest sun move (radians) that re-renders the map. */
const MIN_TURN = (0.5 * Math.PI) / 180;

/**
 * Least time (ms) between two renders while the time of day is dragged:
 * a drag turns the sun by degrees a step, and each render is the dome on
 * six faces and the generator's blur, some twenty passes — four a second
 * keep the mirrors moving with the sky.
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

/** The app's reflection: a generator over the module's one target. */
export function createSkyReflection(
  renderer: WebGPURenderer,
  skyScene: Scene
): SkyReflection {
  const generator = new PMREMGenerator(renderer);
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
    // The dome sits at the cube camera (its own onBeforeRender), 4.5 km
    // across: near and far keep it whole.
    generator.fromScene(skyScene, 0, 1, 10_000, {
      size: CUBE_SIZE,
      renderTarget: target,
    });
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
      generator.dispose();
      target.dispose();
    },
  };
}
