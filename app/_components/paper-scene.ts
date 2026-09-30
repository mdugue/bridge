import {
  Color,
  type Material,
  MeshStandardNodeMaterial,
  type Node,
  type Object3D,
  type Scene,
  type NodeBuilder,
  type UniformNode,
} from "three/webgpu";
import {
  attribute,
  float,
  Fn,
  materialColor,
  max,
  mix,
  positionWorld,
  sin,
  uniform,
  vec3,
} from "three/tsl";
import { instanceTint } from "./instancing";
import type { Live, V3 } from "./shader-chunks";

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
 * style restores the scene exactly (ADR 0034). three carries each drawn
 * material's `positionNode` over to the override, so instanced sets stay
 * where they are and crowns keep their sway. What the paper material
 * cannot stand in for is hidden for the frame — glows and sprites, and
 * every see-through sheet (the river, mist, lamp halos, nets): as opaque
 * paper they would be walls, and the river's sheet would cover the whole
 * ground. The ground draws the water itself (`paperGroundOn`). The sky
 * dome's inside is culled by the front-sided material, so the paper-toned
 * background shows there.
 */

/** Warm off-white: the sheet the model is cut from. */
export const PAPER_HEX = 0xf4_f0_e8;
const PAPER = new Color(PAPER_HEX);
/**
 * On (1) for Papier's frames, read by the materials that draw themselves as
 * paper rather than wear the paper material — the terrain's
 * (terrain-layer.ts), whose markings and water only it knows. Such a
 * material says so with `userData.paperOwn`. A uniform node: one shared
 * value, no extra program.
 */
export const paperGroundOn: Live = uniform(0);
/** The sky and the distance: a paper a shade greyer than the model. */
const PAPER_SKY = new Color(0xe9_e6_df);

/**
 * A layer's own colour — vertex colours (stairs, furniture) or an instanced
 * set's tints (crowns) — survives only as a whisper, a greenish or a stone
 * paper: chosen per build from what the drawn geometry carries.
 */
const ownColour = Fn((builder: NodeBuilder) => {
  const geometry = builder.geometry;
  let own: V3 | null = null;
  if (geometry?.hasAttribute("iColor")) {
    own = instanceTint();
  } else if (geometry?.hasAttribute("color")) {
    own = attribute("color", "vec3") as unknown as V3;
  }
  if (!own) {
    return vec3(1);
  }
  const peak = max(max(own.x, max(own.y, own.z)), 1e-3);
  return mix(vec3(1), own.div(peak), 0.1);
});

function paperMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: PAPER,
    roughness: 0.95,
    metalness: 0,
    // Faceted, like folded card — and independent of how a layer bakes its
    // normals (radial crowns, quantised terrain).
    flatShading: true,
  });
  // A very slow world-space drift keeps the sheets from being one flat
  // white.
  const drift = positionWorld.xz.div(70);
  const sheet = sin(drift.x.add(sin(drift.y.mul(0.8)).mul(1.7))).mul(
    sin(drift.y.mul(1.3).add(sin(drift.x).mul(0.6)))
  );
  material.colorNode = vec3(materialColor)
    .mul(ownColour())
    .mul(vec3(0.012, 0.004, -0.014).mul(sheet).add(float(1)));
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

/**
 * The position node three carries from `object`'s material over to the
 * override (its first material's, for a multi-material mesh).
 */
function positionNodeOf(object: Object3D): Node | null {
  const material = (object as Object3D & { material?: Material | Material[] })
    .material;
  const first = Array.isArray(material) ? material[0] : material;
  const node = (first as { positionNode?: Node | null } | undefined)
    ?.positionNode;
  return node?.isNode === true ? node : null;
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
   * Runs `during` with the scene swapped to paper as `object` draws it,
   * then restores it — for compiling the paper programs of the scene's own
   * objects ahead of the first Papier frame (`PostStack.warmStyles`):
   * three carries each drawn material's position node over to the
   * override, so no stand-in could match what a frame builds. The paper
   * material holds `object`'s position node for all of `during`: three
   * carries it over for the draw call only and puts it back before
   * `compileAsync` makes the render object and starts its build (in the
   * call's synchronous half), which then saw no position node — an
   * instanced set built so drew every instance at its origin in Papier.
   */
  swapped: <T>(object: Object3D, during: () => T) => T;
  /**
   * Whether the swap draws `object` with the paper material (not hidden
   * for the frame, and not a material that papers itself).
   */
  drawsAsPaper: (object: Object3D) => boolean;
  /** The scene's objects changed: the next frame re-reads what to hide. */
  sceneChanged: () => void;
}

export function createPaperScene(
  scene: Scene,
  /** the scene fog's colour (height-fog.ts), papered for the frame */
  fogColor: UniformNode<"color", Color>
): PaperScene {
  const material = paperMaterial();
  const background = PAPER_SKY.clone();
  const savedFog = new Color();
  const hidden: Object3D[] = [];
  // What the paper cannot stand in for, gathered once per scene change
  // rather than walked for every frame. Their own visibility is read per
  // frame: a hidden object is left alone, and so restored as it was.
  let candidates: Object3D[] | null = null;
  let ownPaper: Material[] = [];
  const gather = () => {
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
    return found;
  };
  const begin = () => {
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    savedFog.copy(fogColor.value);
    fogColor.value.copy(PAPER_SKY);
    scene.overrideMaterial = material;
    scene.background = background;
    const list = candidates ?? gather();
    for (const m of ownPaper) {
      m.allowOverride = false;
    }
    paperGroundOn.value = 1;
    hidden.length = 0;
    for (const object of list) {
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
      paperGroundOn.value = 0;
      scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;
      fogColor.value.copy(savedFog);
    };
  };
  return {
    begin,
    swapped: (object, during) => {
      const restore = begin();
      const own = positionNodeOf(object);
      const previous = material.positionNode;
      if (own) {
        material.positionNode = own;
      }
      try {
        return during();
      } finally {
        material.positionNode = previous;
        restore();
      }
    },
    drawsAsPaper: (object) =>
      !hiddenInPaper(object) && paperOwnMaterials(object).length === 0,
    sceneChanged: () => {
      candidates = null;
    },
    dispose: () => material.dispose(),
  };
}
