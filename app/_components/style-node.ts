import {
  AdditiveBlending,
  type Color,
  DoubleSide,
  type MeshStandardMaterial,
} from "three";
import {
  abs,
  clamp,
  color,
  diffuseColor,
  dot,
  float,
  instanceColor,
  max,
  mix,
  normalize,
  normalView,
  positionGeometry,
  positionView,
  positionWorld,
  pow,
  sin,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import {
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type NodeBuilder,
} from "three/webgpu";

/**
 * SPIKE (plan 020): the picture styles' scene materials on the node
 * renderer — paper-scene.ts's paper and style-dressing.ts's lamp cones,
 * whose GLSL (`onBeforeCompile`, a ShaderMaterial) the node renderer does
 * not run.
 */

/**
 * paper-scene.ts `paperMaterial`: one white card for every surface, faceted,
 * with a whisper of a layer's instance colour (crowns, furniture) and a very
 * slow world-space drift, so the sheets are not one flat white.
 */
class PaperNodeMaterial extends MeshStandardNodeMaterial {
  constructor(private readonly paper: Color) {
    super({ roughness: 0.95, metalness: 0, flatShading: true });
  }

  override setupDiffuseColor(builder: NodeBuilder): void {
    // As USE_INSTANCING_COLOR in the GLSL: only an instance colour shows
    // through (the override material has no vertex colours).
    let col: Node<"vec3"> = vec3(this.paper.r, this.paper.g, this.paper.b);
    if ((builder.object as { instanceColor?: unknown }).instanceColor) {
      // reason: the varying property is typed loosely in @types/three.
      const own = instanceColor as unknown as Node<"vec3">;
      const n = own.div(max(max(own.r, max(own.g, own.b)), 1e-3));
      col = col.mul(mix(vec3(1), n, 0.1));
    }
    const drift = positionWorld.xz.div(70);
    const sheet = sin(drift.x.add(sin(drift.y.mul(0.8)).mul(1.7))).mul(
      sin(drift.y.mul(1.3).add(sin(drift.x).mul(0.6)))
    );
    col = col.mul(vec3(0.012, 0.004, -0.014).mul(sheet).add(1));
    diffuseColor.assign(vec4(col, 1));
  }
}

export function paperNodeMaterial(paper: Color): MeshStandardMaterial {
  // reason: the scene swaps it in as a Material; three takes node materials.
  return new PaperNodeMaterial(paper) as unknown as MeshStandardMaterial;
}

/** style-dressing.ts's lamp cone: its material and its two live values. */
export interface LampConeMaterial {
  height: { value: number };
  material: MeshStandardMaterial;
  strength: { value: number };
}

/**
 * The noir lamp cone of style-dressing.ts: brightest through the cone's
 * core and near the lantern, fading to the ground, added onto the scene.
 */
export function nodeLampCone(coneColor: Color): LampConeMaterial {
  const height = uniform(5);
  const strength = uniform(0.22);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.fog = false;
  const facing = abs(
    dot(normalize(normalView), normalize(positionView.negate()))
  );
  const h = clamp(positionGeometry.y.div(height), 0, 1);
  const a = pow(facing, 1.6)
    .mul(mix(0.12, 1, pow(h, 1.4)))
    .mul(strength)
    .mul(0.55);
  material.colorNode = color(coneColor).mul(a);
  material.opacityNode = float(1);
  return {
    // reason: TSL uniform nodes carry their value like a GLSL uniform.
    height: height,
    strength: strength,
    material: material as unknown as MeshStandardMaterial,
  };
}
