import type { Material, Object3D, Scene } from "three";
import { Color, Fog, MeshStandardMaterial } from "three";

/**
 * The Papier style's scene half (lib/city/render-style.ts `paperScene`):
 * for the frames of that style every surface is drawn with ONE white paper
 * material — buildings, ground, trees, furniture — under the scene's own sun,
 * sky light, shadow map and AO. A post pass cannot do this: it sees a
 * colour, not how much of it is the surface and how much the light, so a
 * green crown or a grey road can never turn into a white one with its
 * shading intact.
 *
 * It is a render-time swap (`scene.overrideMaterial`), not a branch in any
 * layer's material: nothing a tile builds knows about it, and leaving the
 * style restores the scene exactly (ADR 0032). What the paper material
 * cannot stand in for is hidden for the frame — glows and sprites, and the
 * see-through sheets that write no depth (mist, lamp halos, nets): as
 * opaque paper they would be walls. The sky dome's inside is culled by the
 * front-sided material, so the paper-toned background shows there.
 */

/** Warm off-white: the sheet the model is cut from. */
const PAPER = new Color(0xf4_f0_e8);
/** The sky and the distance: a paper a shade greyer than the model. */
const PAPER_SKY = new Color(0xe9_e6_df);

function paperMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: PAPER,
    roughness: 0.95,
    metalness: 0,
    // Faceted, like folded card — and independent of how a layer bakes its
    // normals (radial crowns, quantised terrain).
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    // A layer's own colour (instance or vertex colours: crowns, furniture,
    // stairs) survives only as a whisper — a greenish or a stone paper —
    // and a very slow world-space drift keeps the sheets from being one
    // flat white.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      /* glsl */ `
      #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
        vec3 ownColour = vColor.rgb / max(max(vColor.r, max(vColor.g, vColor.b)), 1e-3);
        diffuseColor.rgb *= mix(vec3(1.0), ownColour, 0.1);
      #endif
      vec3 paperWorld = (inverse(viewMatrix) * vec4(-vViewPosition, 1.0)).xyz;
      vec2 drift = paperWorld.xz / 70.0;
      float sheet = sin(drift.x + 1.7 * sin(drift.y * 0.8)) * sin(drift.y * 1.3 + 0.6 * sin(drift.x));
      diffuseColor.rgb *= 1.0 + vec3(0.012, 0.004, -0.014) * sheet;
      `
    );
  };
  return material;
}

/** Objects the paper material must not stand in for this frame. */
function hiddenInPaper(object: Object3D): boolean {
  const o = object as Object3D & {
    isLine?: boolean;
    isMesh?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
    material?: Material | Material[];
  };
  if (o.isSprite || o.isPoints || o.isLine) {
    return true;
  }
  if (!(o.isMesh && o.material)) {
    return false;
  }
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  return materials.every((m) => m.transparent && !m.depthWrite);
}

export interface PaperScene {
  /** Swaps the scene to paper for one render; returns the restore. */
  begin: () => () => void;
  dispose: () => void;
}

export function createPaperScene(scene: Scene): PaperScene {
  const material = paperMaterial();
  const background = PAPER_SKY.clone();
  const savedFog = new Color();
  const hidden: Object3D[] = [];
  return {
    begin: () => {
      const previousOverride = scene.overrideMaterial;
      const previousBackground = scene.background;
      const fog = scene.fog instanceof Fog ? scene.fog : null;
      if (fog) {
        savedFog.copy(fog.color);
        fog.color.copy(PAPER_SKY);
      }
      scene.overrideMaterial = material;
      scene.background = background;
      hidden.length = 0;
      scene.traverseVisible((object) => {
        if (hiddenInPaper(object)) {
          hidden.push(object);
        }
      });
      for (const object of hidden) {
        object.visible = false;
      }
      return () => {
        for (const object of hidden) {
          object.visible = true;
        }
        hidden.length = 0;
        scene.overrideMaterial = previousOverride;
        scene.background = previousBackground;
        fog?.color.copy(savedFog);
      };
    },
    dispose: () => material.dispose(),
  };
}
