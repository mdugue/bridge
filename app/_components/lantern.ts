import { PointLight, type Vector3 } from "three/webgpu";
import { uniform } from "three/tsl";
import type { DeviceTier } from "./scene-profile";
import type { Live } from "./shader-chunks";

/**
 * Die Laterne: a small warm light the walker carries after dark, so the
 * ground, the kerbs and the house fronts within a few metres come out of
 * the night around them. One real point light, held at the hand (below
 * the eye, a little to the right and ahead), built before the first frame
 * like the lamps' pool (lamp-layer.ts `createLampLights`): a light added
 * later would rebuild every lit material. By day, in the air and in Modell
 * it sits at intensity 0.
 *
 * On a desktop it casts shadows (a small cube map: the bench, the post and
 * the tree in front of it throw theirs away from the walker), rendered only
 * when the hand has moved — never per frame while standing. A phone takes
 * the light without the shadow: six more passes over a tile's two million
 * triangles each step are more than a phone's frame has.
 *
 * The ground's far horizon and the clay's window reveals reach three's
 * shadow term of every light that casts (`receivedShadowNode`, which is
 * told nothing of the light). Both are the sun's, so after dark — when
 * the sun is below the horizon and draws nothing — they give way to
 * `nightShadowFree` (sky-light.ts, visual-style.ts), or they would black
 * out the lantern's light on the ground and on every wall turned from
 * where the sun has set.
 */

/** The lantern's warm light (a candle-warm white, warmer than the lamps). */
const LANTERN_COLOUR = 0xff_d6_a0;
/** Intensity (cd) at full night, its reach (m) and falloff. At the hand,
 *  ~1.1 m over the ground, it lights the feet about as a street lamp does
 *  under its head and fades out over a few metres. */
const LANTERN_CD = 1.6;
const LANTERN_RANGE = 14;
/** Where it is held: below the eye, to the right, ahead (m). */
const HAND = { down: 0.6, right: 0.35, ahead: 0.3 } as const;
/** The camera's height over the ground (m) where it fades out: carried on
 *  foot and just off it, gone from the air. */
const LANTERN_FADE_M = { from: 6, to: 25 } as const;
/** The night factor over which it comes on: only once the sun is below
 *  the horizon (sun-rig.ts: 0.5 is −2°), in full from −6°. */
const LANTERN_NIGHT = { from: 0.5, to: 1 } as const;
/** Desktop shadow: cube face size, softness, and the hand's move (m) that
 *  re-renders it. */
const SHADOW_MAP = 512;
const SHADOW_RADIUS = 3;
const SHADOW_MOVE_M = 0.15;

const smooth = (from: number, to: number, t: number): number => {
  const x = Math.min(Math.max((t - from) / (to - from), 0), 1);
  return x * x * (3 - 2 * x);
};

/** How far the lantern is on (0…1) after dark: the night factor's last half. */
export function lanternNight(night: number): number {
  return smooth(LANTERN_NIGHT.from, LANTERN_NIGHT.to, night);
}

/** The lantern's strength (0…1) from the night factor and the camera's
 *  height over the ground (m). */
export function lanternStrength(night: number, overGround: number): number {
  return (
    lanternNight(night) *
    (1 - smooth(LANTERN_FADE_M.from, LANTERN_FADE_M.to, overGround))
  );
}

/**
 * 1 once the night has put the sun out (the lantern's own curve), else 0:
 * the sun's shadow terms that three hands every casting light (the far
 * horizon, the window reveals) take their max with it, so they do not
 * darken the lantern. By day it is 0 and they are what they were.
 */
export const nightShadowFree: Live = uniform(0);

export interface Lantern {
  light: PointLight;
  /** the scene's night factor (0 day → 1 night), from setSun */
  setNight: (night: number) => void;
  /** carries it with the camera (`dir` its world direction), `overGround`
   *  the camera's height over the ground; call per frame on foot and in
   *  the air */
  follow: (eye: Vector3, dir: Vector3, overGround: number) => void;
  /** dark (Modell) */
  off: () => void;
  dispose: () => void;
}

export function createLantern(tier: DeviceTier): Lantern {
  const light = new PointLight(LANTERN_COLOUR, 0, LANTERN_RANGE, 2);
  light.name = "lantern";
  const shadows = tier === "desktop";
  light.castShadow = shadows;
  if (shadows) {
    light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    light.shadow.radius = SHADOW_RADIUS;
    light.shadow.bias = -0.002;
    light.shadow.normalBias = 0;
    light.shadow.camera.near = 0.1;
    light.shadow.autoUpdate = false;
  }
  let night = 0;
  let shadowAt: { x: number; y: number; z: number } | null = null;

  const setIntensity = (strength: number) => {
    light.intensity = LANTERN_CD * strength;
  };

  return {
    light,
    setNight: (t) => {
      night = Math.min(Math.max(t, 0), 1);
      nightShadowFree.value = lanternNight(night);
    },
    follow: (eye, dir, overGround) => {
      const strength = lanternStrength(night, overGround);
      setIntensity(strength);
      if (strength <= 0) {
        shadowAt = null;
        return;
      }
      // Ahead and right in the horizontal plane, whatever the pitch.
      const h = Math.hypot(dir.x, dir.z) || 1;
      const fx = dir.x / h;
      const fz = dir.z / h;
      light.position.set(
        eye.x + fx * HAND.ahead - fz * HAND.right,
        eye.y - HAND.down,
        eye.z + fz * HAND.ahead + fx * HAND.right
      );
      if (!shadows) {
        return;
      }
      const p = light.position;
      if (
        !shadowAt ||
        Math.hypot(p.x - shadowAt.x, p.y - shadowAt.y, p.z - shadowAt.z) >
          SHADOW_MOVE_M
      ) {
        shadowAt = { x: p.x, y: p.y, z: p.z };
        light.shadow.needsUpdate = true;
      }
    },
    off: () => {
      setIntensity(0);
      shadowAt = null;
    },
    dispose: () => {
      light.dispose();
    },
  };
}

/** Re-renders the lantern's shadow (scene topology changed: a tile came,
 *  went or was demolished). */
export function invalidateLanternShadow(lantern: Lantern): void {
  if (lantern.light.castShadow && lantern.light.intensity > 0) {
    lantern.light.shadow.needsUpdate = true;
  }
}
