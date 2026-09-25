import { Color, Fog, type Scene, Vector4 } from "three";
import {
  clamp,
  float,
  fog,
  max,
  min,
  positionView,
  positionWorld,
  rangeFogFactor,
  smoothstep,
  uniform,
} from "three/tsl";
import type { Node } from "three/webgpu";
import { type HeightFogUniforms, SITE_EDGE_FADE_M } from "./height-fog";

/**
 * SPIKE (plan 020): height-fog.ts as ONE scene fog node. The GLSL version is
 * folded into every material's `onBeforeCompile` (and a material that forgets
 * it floats out of the haze); on the node renderer a `scene.fogNode` applies
 * to every lit material — terrain, water, clay, trees, rails, walls, lamps —
 * with the same terms: three's distance fog plus a world-Y pool above the
 * valley floor, and the site-edge haze that dissolves the data's end. Colour, range and the height knobs follow the live values
 * the sun rig and the look already write.
 */
export function installNodeFog(scene: Scene, height: HeightFogUniforms): void {
  const sceneFog = () => (scene.fog instanceof Fog ? scene.fog : null);
  const colour = uniform(new Color()).onRenderUpdate(
    () => sceneFog()?.color ?? new Color()
  );
  const near = uniform(1).onRenderUpdate(() => sceneFog()?.near ?? 1);
  const far = uniform(2).onRenderUpdate(() => sceneFog()?.far ?? 2);
  const start = uniform(0).onRenderUpdate(() => height.uFogHeightStart.value);
  const falloff = uniform(1).onRenderUpdate(
    () => height.uFogHeightFalloff.value
  );
  const strength = uniform(0).onRenderUpdate(
    () => height.uFogHeightStrength.value
  );
  const rect = uniform(new Vector4()).onRenderUpdate(
    () => height.uFogSiteRect.value
  );
  const distance = rangeFogFactor(near, far);
  const pool = float(1).sub(
    smoothstep(start, start.add(falloff), positionWorld.y)
  );
  const pooled = clamp(
    distance.add(strength.mul(pool).mul(float(1).sub(distance))),
    0,
    1
  );
  // Site-edge haze, never on what is right in front of the camera.
  const xz = positionWorld.xz;
  const edgeD = min(xz.sub(rect.xy), rect.zw.sub(xz));
  const edge = float(1)
    .sub(smoothstep(0, SITE_EDGE_FADE_M, min(edgeD.x, edgeD.y)))
    .mul(smoothstep(60, 600, positionView.z.negate()));
  const factor = max(pooled, edge.mul(edge).mul(float(3).sub(edge.mul(2))));
  // reason: `fogNode` is read by the node renderer but not declared on
  // three's Scene type.
  (scene as Scene & { fogNode: Node }).fogNode = fog(colour, factor);
}
