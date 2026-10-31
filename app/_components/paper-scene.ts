import {
  Color,
  DataTexture,
  InterpolationSamplingType,
  MathUtils,
  FloatType,
  NearestFilter,
  RGBAFormat,
  type Material,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  type Node,
  type Object3D,
  type Scene,
  type NodeBuilder,
  type UniformNode,
  Vector3,
} from "three/webgpu";
import {
  abs,
  attribute,
  cameraWorldMatrix,
  float,
  Fn,
  int,
  ivec2,
  materialColor,
  max,
  mix,
  normalFlat,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  step,
  textureLoad,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { PaperKind } from "@/lib/city/render-style";
import { OBJECT_TEXTURE_WIDTH } from "@/lib/city/city-mesh";
import { FACADE_ROOF, NO_DOOR } from "@/lib/city/windows";
import { clayWindows } from "./clay-windows";
import { instanceTint } from "./instancing";
import { ownSlotTexture, ownSlotUniform } from "./material-slots";
import { dataPosition, type Live, type V3, type V4 } from "./shader-chunks";
import { styleNight } from "./sun-rig";
import { viewDirection } from "./view-direction";
import { shopOf, wallEaveUp } from "./visual-style";

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
  // Sin City: white, the water black
  ink: 4,
};
/** The sky and the distance: a paper a shade greyer than the model. */
const PAPER_SKY = new Color(0xe9_e6_df);
/** …and at night: the dark blue card the night is drawn on (the pass
 *  draws its sky; this is the haze the far city fades into). */
const PAPER_NIGHT_SKY = new Color(0x24_2b_40);
const PAPER_DUSK_SKY = new Color(0x99_88_99);
/** Strich's and the Schwarzplan's sheet: white. */
const SHEET_WHITE = new Color(0xff_ff_ff);
/** The Schwarzplan's figure. */
const FIGURE_BLACK = new Color(0x11_11_11);
/** Sin City's night: the sky black, the haze a pale smoke. */
const INK_NIGHT = new Color(0x00_00_00);
const INK_SMOKE = new Color(0xd8_d8_d8);
/** Sin City's one colour: the red roofs (linear). */
const INK_RED = new Color(0xc8_10_1c);
/** Foliage in Sin City: a black shape. */
const INK_FOLIAGE = 0.02;

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

/**
 * The clay's lit windows on the card, for the night (`styleNight`): the
 * windows' rhythm read from the drawn building tile's own object table
 * (its slots), as the clay reads it (visual-style.ts `clayGraph`) — only
 * the light in them, none of the clay's other terms. A paper model lit
 * from inside: the openings glow through the card, and the far city keeps
 * its lights as the windows' mean. Per build: what carries no facade (no
 * building tile) gets none.
 */
const windowGlow = Fn((builder: NodeBuilder) => {
  const geometry = builder.geometry;
  if (
    !(geometry?.hasAttribute("facade") && geometry.hasAttribute("featureId"))
  ) {
    return vec3(0);
  }
  const table = ownSlotTexture("clayObjects", OBJECT_TABLE_LIKE);
  const rows = ownSlotUniform("clayRows", 1);
  const id = int(attribute("featureId", "float").add(0.5));
  const at = ivec2(id.mod(OBJECT_TEXTURE_WIDTH), id.div(OBJECT_TEXTURE_WIDTH));
  // the object's texels (lib/city/city-mesh.ts packObjectTexels)
  const band = (k: number) =>
    textureLoad(table, at.add(ivec2(0, int(rows).mul(k))));
  const a = band(0);
  const b = band(1);
  const c = band(2);
  const facade = attribute("facade", "vec4") as unknown as V4;
  const roof = step(facade.z, float(FACADE_ROOF + 1e-3));
  const wn = normalize(cameraWorldMatrix.mul(vec4(normalFlat, 0)).xyz);
  // packed as the clay packs them (visual-style.ts `clayGraph`): the card
  // carries the standard material's varyings beside these
  const build = varying(
    vec4(
      roof,
      c.x,
      b.w.add(wallEaveUp(facade, roof)),
      dataPosition().z.sub(a.w)
    )
  );
  // flat: they seed and pack
  const word = varying(vec2(c.z, c.w)).setInterpolation(
    InterpolationSamplingType.FLAT
  );
  const windows = clayWindows({
    eave: build.z,
    facade: varying(mix(facade, vec4(0, 0, FACADE_ROOF, NO_DOOR), roof)),
    h: max(build.w, 0),
    seed: word.x,
    shop: shopOf(word.y),
    spec: varying(band(3)).setInterpolation(InterpolationSamplingType.FLAT),
    storey: build.y,
    strength: float(1),
    sun: windowSun,
    view: viewDirection(),
    wall: float(1)
      .sub(smoothstep(0.5, 0.7, abs(wn.y)))
      .mul(float(1).sub(build.x)),
    wn,
  });
  return windows.glow;
});
/** The windows' recess reads a sun; at night the glow needs none. */
const windowSun = uniform(new Vector3(0, 1, 0));

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
  // at night the windows glow through the card
  material.emissiveNode = windowGlow().mul(styleNight.mul(WINDOW_LIGHT));
  return material;
}
/** A lit window's light on the card at night (the clay's is 0.5 of its
 *  glow, visual-style.ts `DUSK_GLOW`; the card is paler, so a little more
 *  reads as warm light, not as a pale patch). */
const WINDOW_LIGHT = 0.9;

/**
 * The Schwarzplan's figure: one unlit black. three carries each drawn
 * material's position node over, as for the paper. No fog: a plan has no
 * distance — a block on the horizon is as black as the one in front (the
 * fog's white sheet had faded every building past a few hundred metres
 * into the ground, so the plan showed a handful of houses).
 */
function figureMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({ color: FIGURE_BLACK });
  material.fog = false;
  return material;
}

/** A texel of the clay's object table's kind (city-layer.ts). */
const OBJECT_TABLE_LIKE = (() => {
  const like = new DataTexture(
    new Float32Array(4),
    1,
    1,
    RGBAFormat,
    FloatType
  );
  like.magFilter = NearestFilter;
  like.minFilter = NearestFilter;
  return like;
})();

/** A roof vertex's colour: its face's own where the orthophoto read the
 *  face apart (the `facade` slots, lib/city/windows.ts), else its
 *  building's from the tile's object table — as the clay reads it
 *  (visual-style.ts), through the mesh's own material's slots. */
function roofColour(facade: V4): V3 {
  const table = ownSlotTexture("clayObjects", OBJECT_TABLE_LIKE);
  const rows = ownSlotUniform("clayRows", 1);
  const id = int(attribute("featureId", "float").add(0.5));
  const at = ivec2(id.mod(OBJECT_TEXTURE_WIDTH), id.div(OBJECT_TEXTURE_WIDTH));
  // band 1: the roof's rgb (lib/city/city-mesh.ts packObjectTexels)
  const building = textureLoad(table, at.add(ivec2(0, int(rows)))).rgb;
  const face = vec3(facade.x, facade.y, facade.w);
  const own = step(1e-5, face.x.add(face.y).add(face.z));
  return mix(building, face, own);
}

/**
 * What Sin City prints a surface in, chosen per build from what the drawn
 * geometry carries: a roof whose colour is red (its face's or its
 * building's, `roofColour`) its red, foliage (a green instance
 * tint or vertex colour) black, everything else the white card — so the
 * frame's light is the light alone, not the colour of a roof or a lawn.
 */
const inkColour = Fn((builder: NodeBuilder) => {
  const geometry = builder.geometry;
  if (geometry?.hasAttribute("facade")) {
    const facade = attribute("facade", "vec4") as unknown as V4;
    const roof = step(facade.z, float(FACADE_ROOF + 1e-3));
    const rgb = geometry.hasAttribute("featureId")
      ? roofColour(facade)
      : vec3(facade.x, facade.y, facade.w);
    const peak = max(rgb.x, max(rgb.y, rgb.z));
    const red = smoothstep(
      0.28,
      0.4,
      rgb.x.sub(max(rgb.y, rgb.z)).div(max(peak, 1e-3))
    )
      .mul(step(0.06, peak))
      .mul(roof);
    return mix(vec3(1), vec3(INK_RED.r, INK_RED.g, INK_RED.b), step(0.5, red));
  }
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
  const green = smoothstep(0.04, 0.1, own.y.sub(max(own.x, own.z)).div(peak));
  return mix(vec3(1), vec3(INK_FOLIAGE), green);
});

/** Sin City's card: Papier's, in its own two inks and red. */
function inkMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xff_ff_ff,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });
  material.colorNode = inkColour();
  return material;
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
    ink: inkMaterial(),
  };
  // (Papier's is set for each frame from the night: `begin`)
  const skies: Record<PaperKind, Color> = {
    paper: PAPER_SKY.clone(),
    line: SHEET_WHITE.clone(),
    figure: SHEET_WHITE.clone(),
    ink: INK_NIGHT.clone(),
  };
  // the haze: the sky's colour but in Sin City, whose distance is smoke
  // against a black night
  const fogs: Record<PaperKind, Color> = {
    ...skies,
    ink: INK_SMOKE.clone(),
  };
  const savedFog = new Color();
  const hidden: Object3D[] = [];
  const shown: Object3D[] = [];
  // What the swap does not draw, gathered once per scene change rather than
  // walked for every frame. Their own visibility is read per frame: a
  // hidden object is left alone, and so restored as it was.
  let candidates: Record<"figure" | "paper" | "plan", Object3D[]> | null = null;
  let ownPaper: Material[] = [];
  const gather = () => {
    const found = {
      paper: [] as Object3D[],
      figure: [] as Object3D[],
      plan: [] as Object3D[],
    };
    const own = new Set<Material>();
    scene.traverse((object) => {
      if (hiddenInPaper(object)) {
        found.paper.push(object);
      }
      if (hiddenInFigure(object)) {
        found.figure.push(object);
      }
      if (object.userData.planOnly === true) {
        found.plan.push(object);
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
    if (kind === "paper") {
      // Papier's night is drawn on dark card: its sky and its haze
      // (through a mauve dusk: halfway, day paper and night card met in
      // a dull grey)
      const night = styleNight.value;
      skies.paper
        .copy(PAPER_SKY)
        .lerp(PAPER_DUSK_SKY, MathUtils.smoothstep(night, 0, 0.5))
        .lerp(PAPER_NIGHT_SKY, MathUtils.smoothstep(night, 0.5, 1));
    }
    // (Sin City's smoke is its afternoon's: the style has no night)
    fogColor.value.copy(fogs[kind]);
    scene.overrideMaterial = materials[kind];
    scene.background = skies[kind];
    const lists = candidates ?? gather();
    const list = kind === "figure" ? lists.figure : lists.paper;
    for (const m of ownPaper) {
      m.allowOverride = false;
    }
    paperGroundOn.value = PAPER_GROUND[kind];
    hidden.length = 0;
    shown.length = 0;
    for (const object of list) {
      if (object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    }
    // what only the plan draws (tree-plan.ts): shown for its frames
    if (kind === "figure") {
      for (const object of lists.plan) {
        if (!object.visible) {
          object.visible = true;
          shown.push(object);
        }
      }
    }
    return () => {
      for (const object of hidden) {
        object.visible = true;
      }
      hidden.length = 0;
      for (const object of shown) {
        object.visible = false;
      }
      shown.length = 0;
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
