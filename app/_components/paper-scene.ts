import type { Material, Object3D, Scene } from "three";
import {
  type BufferGeometry,
  Color,
  Fog,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
} from "three";

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
 * style restores the scene exactly (ADR 0033). What the paper material
 * cannot stand in for is hidden for the frame — glows and sprites, and every
 * see-through sheet (the river, mist, lamp halos, nets): as opaque paper
 * they would be walls, and the river's sheet would cover the whole ground.
 * The ground draws the water itself (`PAPER_GROUND_ON`). The sky dome's inside is culled by the
 * front-sided material, so the paper-toned background shows there.
 */

/** Warm off-white: the sheet the model is cut from. */
export const PAPER_HEX = 0xf4_f0_e8;
const PAPER = new Color(PAPER_HEX);
/**
 * On (1) for Papier's frames, by reference in the materials that draw
 * themselves as paper rather than wear the paper material — the terrain's
 * (terrain-layer.ts `PAPER_GROUND`), whose markings and water only it knows.
 * Such a material says so with `userData.paperOwn`.
 */
export const PAPER_GROUND_ON = { value: 0 };
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
  return materials.every((m) => m.transparent);
}

/** A mesh's materials that draw themselves as paper (`userData.paperOwn`). */
function paperOwnMaterials(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] })
    .material;
  if (!material) {
    return [];
  }
  const materials = Array.isArray(material) ? material : [material];
  return materials.filter((m) => m.userData.paperOwn === true);
}

export interface PaperScene {
  /** Swaps the scene to paper for one render; returns the restore. */
  begin: () => () => void;
  dispose: () => void;
  /**
   * Stand-ins wearing the paper material in each shape it is drawn with
   * (plain and instanced meshes, with and without instance colours, casting
   * shadows or not), for compiling its programs ahead of the first frame.
   * They share the caller's geometry and own nothing to free.
   */
  proxies: (geometry: BufferGeometry) => Object3D[];
  /** The scene's objects changed: the next frame re-reads what to hide. */
  sceneChanged: () => void;
}

export function createPaperScene(scene: Scene): PaperScene {
  const material = paperMaterial();
  const background = PAPER_SKY.clone();
  const savedFog = new Color();
  const hidden: Object3D[] = [];
  // What the paper cannot stand in for, gathered once per scene change
  // rather than walked for every frame. Their own visibility is read per
  // frame: a hidden object is left alone, and so restored as it was.
  let candidates: Object3D[] | null = null;
  let ownPaper: Material[] = [];
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
      if (!candidates) {
        const found: Object3D[] = [];
        const own = new Set<Material>();
        scene.traverse((object) => {
          if (hiddenInPaper(object)) {
            found.push(object);
          }
          for (const m of paperOwnMaterials(object)) {
            own.add(m);
          }
        });
        candidates = found;
        ownPaper = [...own];
      }
      for (const m of ownPaper) {
        m.allowOverride = false;
      }
      PAPER_GROUND_ON.value = 1;
      hidden.length = 0;
      for (const object of candidates) {
        if (object.visible) {
          object.visible = false;
          hidden.push(object);
        }
      }
      return () => {
        for (const object of hidden) {
          object.visible = true;
        }
        hidden.length = 0;
        for (const m of ownPaper) {
          m.allowOverride = true;
        }
        PAPER_GROUND_ON.value = 0;
        scene.overrideMaterial = previousOverride;
        scene.background = previousBackground;
        fog?.color.copy(savedFog);
      };
    },
    sceneChanged: () => {
      candidates = null;
    },
    proxies: (geometry) => {
      const shapes: Mesh[] = [];
      for (const receiveShadow of [true, false]) {
        const plain = new Mesh(geometry, material);
        const instanced = new InstancedMesh(geometry, material, 1);
        const coloured = new InstancedMesh(geometry, material, 1);
        coloured.setColorAt(0, PAPER);
        for (const mesh of [plain, instanced, coloured]) {
          mesh.receiveShadow = receiveShadow;
          shapes.push(mesh);
        }
      }
      return shapes;
    },
    dispose: () => material.dispose(),
  };
}
