import {
  Color,
  type Material,
  MeshBasicNodeMaterial,
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
import type { PaperKind } from "@/lib/city/render-style";
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
 * Which paper the ground draws for this frame, read by the materials that
 * draw themselves rather than wear the swap's material — the terrain's
 * (terrain-layer.ts), whose markings and water only it knows. Such a
 * material says so with `userData.paperOwn`. 0 = its own colours, then
 * `PAPER_GROUND`'s values. A uniform node: one shared value, no extra
 * program.
 */
export const paperGroundOn: Live = uniform(0);
/** `paperGroundOn`'s value per kind of swap. */
export const PAPER_GROUND: Readonly<Record<PaperKind, number>> = {
  paper: 1,
  // Strich: the ground in muted plan colours
  line: 2,
  // the Schwarzplan: plain white
  figure: 3,
};
/** The sky and the distance: a paper a shade greyer than the model. */
const PAPER_SKY = new Color(0xe9_e6_df);
/** Strich's and the Schwarzplan's sheet: white. */
const SHEET_WHITE = new Color(0xff_ff_ff);
/** The Schwarzplan's figure. */
const FIGURE_BLACK = new Color(0x11_11_11);

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

/**
 * The Schwarzplan's figure: one unlit black. three carries each drawn
 * material's position node over, as for the paper.
 */
function figureMaterial(): MeshBasicNodeMaterial {
  return new MeshBasicNodeMaterial({ color: FIGURE_BLACK });
}

/** The materials a mesh draws with. */
function materialsOf(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] })
    .material;
  if (!material) {
    return [];
  }
  return Array.isArray(material) ? material : [material];
}

/**
 * Objects the Schwarzplan does not draw at all: everything but the
 * buildings (`userData.figure` on the clay) and the ground (which draws
 * itself white) — trees, walls, furniture, bridges, rails, the sky.
 */
function hiddenInFigure(object: Object3D): boolean {
  const o = object as Object3D & {
    isLine?: boolean;
    isMesh?: boolean;
    isPoints?: boolean;
    isSprite?: boolean;
  };
  if (o.isSprite || o.isPoints || o.isLine) {
    return true;
  }
  if (!o.isMesh) {
    return false;
  }
  const materials = materialsOf(object);
  return !materials.some(
    (m) => m.userData.figure === true || m.userData.paperOwn === true
  );
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
  begin: (kind?: PaperKind) => () => void;
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
  swapped: <T>(object: Object3D, during: () => T, kind?: PaperKind) => T;
  /**
   * Whether the swap draws `object` with the swap's material (not hidden
   * for the frame, and not a material that papers itself).
   */
  drawsAsPaper: (object: Object3D, kind?: PaperKind) => boolean;
  /** The scene's objects changed: the next frame re-reads what to hide. */
  sceneChanged: () => void;
}

export function createPaperScene(
  scene: Scene,
  /** the scene fog's colour (height-fog.ts), papered for the frame */
  fogColor: UniformNode<"color", Color>
): PaperScene {
  const card = paperMaterial();
  const materials: Record<
    PaperKind,
    MeshBasicNodeMaterial | MeshStandardNodeMaterial
  > = {
    paper: card,
    // Strich's white model is Papier's card (its builds too); its ground
    // and its pass differ
    line: card,
    figure: figureMaterial(),
  };
  const skies: Record<PaperKind, Color> = {
    paper: PAPER_SKY.clone(),
    line: SHEET_WHITE.clone(),
    figure: SHEET_WHITE.clone(),
  };
  const savedFog = new Color();
  const hidden: Object3D[] = [];
  // What the swap does not draw, gathered once per scene change rather than
  // walked for every frame. Their own visibility is read per frame: a
  // hidden object is left alone, and so restored as it was.
  let candidates: Record<"figure" | "paper", Object3D[]> | null = null;
  let ownPaper: Material[] = [];
  const gather = () => {
    const found = { paper: [] as Object3D[], figure: [] as Object3D[] };
    const own = new Set<Material>();
    scene.traverse((object) => {
      if (hiddenInPaper(object)) {
        found.paper.push(object);
      }
      if (hiddenInFigure(object)) {
        found.figure.push(object);
      }
      for (const m of paperOwnMaterials(object)) {
        own.add(m);
      }
    });
    candidates = found;
    ownPaper = [...own];
    return found;
  };
  const begin = (kind: PaperKind = "paper") => {
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    savedFog.copy(fogColor.value);
    fogColor.value.copy(skies[kind]);
    scene.overrideMaterial = materials[kind];
    scene.background = skies[kind];
    const lists = candidates ?? gather();
    const list = kind === "figure" ? lists.figure : lists.paper;
    for (const m of ownPaper) {
      m.allowOverride = false;
    }
    paperGroundOn.value = PAPER_GROUND[kind];
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
    swapped: (object, during, kind = "paper") => {
      const restore = begin(kind);
      const material = materials[kind];
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
    drawsAsPaper: (object, kind = "paper") =>
      !(kind === "figure" ? hiddenInFigure(object) : hiddenInPaper(object)) &&
      paperOwnMaterials(object).length === 0,
    sceneChanged: () => {
      candidates = null;
    },
    dispose: () => {
      for (const m of new Set(Object.values(materials))) {
        m.dispose();
      }
    },
  };
}
