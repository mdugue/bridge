import {
  AdditiveBlending,
  type BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  type InterleavedBufferAttribute,
  MeshBasicNodeMaterial,
  type Object3D,
  type Scene,
} from "three/webgpu";
import {
  abs,
  clamp,
  color,
  dot,
  mix,
  normalize,
  normalView,
  positionGeometry,
  positionView,
  pow,
} from "three/tsl";
import type { CrownStyle } from "@/lib/city/render-style";
import { Instances, instancePosition, isInstances } from "./instancing";
import { lampNight } from "./lamp-layer";
import { buildStyleCrownGeo } from "./vegetation-layer";

/**
 * The picture styles' scene dressing (lib/city/render-style.ts): geometry a
 * style draws with for its frames only, shown before the render and hidden
 * right after, like the Papier swap (paper-scene.ts). Nothing a tile builds
 * knows a style; the layers only tag what may be dressed
 * (`userData.styleCrown` on the crown sets, `userData.styleLampHeads` on
 * the lamp heads).
 *
 * - Crowns: every tagged crown set gets a sibling set wearing the style's
 *   crown (vegetation-layer.ts `buildStyleCrownGeo`) — Comic's cloud of
 *   balls, Papier's folded card — on the same instance buffers and the same
 *   material, including the per-chunk season attribute (`aBare`). For a
 *   styled frame the sibling takes the original's visibility and the
 *   original hides. A visibility swap, never a geometry swap: the sibling's
 *   material and attribute layout are the original's, so it shares the
 *   original's node build and nothing compiles when a style switches.
 * - Lamp cones (Film noir): a soft light cone under every lamp head, one
 *   set per heads set sharing its instance matrices. They glow faintly by
 *   day — the street lamps of a noir set are always on — and fill in as the
 *   lamps light: the strength reads the lamps' own night uniform.
 */

/** Light-cone strength by day, and at full night. */
const CONE_DAY = 0.22;
const CONE_NIGHT = 1;
const CONE_RADIUS = 3.4;
const CONE_COLOR = new Color(0xff_e2_b0);

interface LampHeadsTag {
  height: number;
}

type Tier = "far" | "mid" | "rich";

function coneGeometry(height: number): BufferGeometry {
  const h = height - 0.15;
  // Open-ended; apex just under the lantern, the base on the ground.
  const g = new ConeGeometry(CONE_RADIUS, h, 28, 1, true);
  g.translate(0, h / 2, 0);
  return g;
}

/**
 * The cones' material for one post height: brightest through the cone's
 * core and near the lantern, fading to the ground — a shaft of light in
 * the smoke, not a lampshade. Fog-free, as the smoke it stands in is.
 */
function coneMaterial(height: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.fog = false;
  material.positionNode = instancePosition();
  const facing = abs(
    dot(normalize(normalView), normalize(positionView.negate()))
  );
  const along = clamp(positionGeometry.y.div(height - 0.15), 0, 1);
  const core = pow(facing, 1.6);
  const fall = mix(0.12, 1, pow(along, 1.4));
  const strength = mix(CONE_DAY, CONE_NIGHT, clamp(lampNight, 0, 1));
  material.colorNode = color(CONE_COLOR).mul(
    core.mul(fall).mul(strength).mul(0.55)
  );
  return material;
}

/** An attribute that steps per instance (matrices, tints, the season). */
function isPerInstance(
  attribute: BufferAttribute | InterleavedBufferAttribute
): boolean {
  const a = attribute as {
    data?: { isInstancedInterleavedBuffer?: boolean };
    isInstancedBufferAttribute?: boolean;
  };
  return (
    a.isInstancedBufferAttribute === true ||
    a.data?.isInstancedInterleavedBuffer === true
  );
}

export interface StyleDressingOptions {
  crowns: CrownStyle | null;
  lampCones: boolean;
}

export interface StyleDressing {
  /** Dresses the scene for one render; returns the restore. */
  begin: (options: StyleDressingOptions) => () => void;
  dispose: () => void;
  /**
   * Builds (hidden) whatever a style dresses the current scene with and
   * returns what was new, for compiling its programs ahead of the style's
   * first frame.
   */
  prepare: (options: StyleDressingOptions) => Object3D[];
  /** The scene's objects changed: the next frame re-reads what to dress. */
  sceneChanged: () => void;
}

export function createStyleDressing(scene: Scene): StyleDressing {
  // Style crown geometry: built on first use, shared by every tile.
  const crownGeos = new Map<string, BufferGeometry>();
  const crownGeo = (kind: CrownStyle, tier: Tier): BufferGeometry => {
    const key = `${kind}:${tier}`;
    let g = crownGeos.get(key);
    if (!g) {
      g = buildStyleCrownGeo(kind, tier);
      g.computeBoundingSphere();
      crownGeos.set(key, g);
    }
    return g;
  };
  // Each crown set's styled siblings, made on first use and freed with the
  // tile (they are its children).
  const siblings = new WeakMap<Instances, Map<CrownStyle, Instances>>();
  let made: Object3D[] = [];
  const styledFor = (
    mesh: Instances,
    kind: CrownStyle,
    tier: Tier
  ): Instances | null => {
    let byKind = siblings.get(mesh);
    let styled = byKind?.get(kind);
    if (styled) {
      return styled;
    }
    if (!mesh.parent) {
      return null;
    }
    styled = new Instances(
      crownGeo(kind, tier),
      mesh.material,
      mesh.capacity,
      mesh.instanceMatrix
    );
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      if (!styled.geometry.hasAttribute(name) && isPerInstance(attribute)) {
        styled.geometry.setAttribute(name, attribute);
      }
    }
    styled.name = `${mesh.name}-${kind}`;
    styled.castShadow = mesh.castShadow;
    styled.receiveShadow = mesh.receiveShadow;
    styled.visible = false;
    mesh.parent.add(styled);
    if (!byKind) {
      byKind = new Map();
      siblings.set(mesh, byKind);
    }
    byKind.set(kind, styled);
    made.push(styled);
    return styled;
  };

  // Lamp cones: one material per post height, one set per heads set.
  const coneGeos = new Map<number, BufferGeometry>();
  const coneMats = new Map<number, MeshBasicNodeMaterial>();
  const cones = new WeakMap<Instances, Instances>();
  const coneFor = (heads: Instances, tag: LampHeadsTag): Instances | null => {
    let cone = cones.get(heads);
    if (cone) {
      return cone;
    }
    if (!heads.parent) {
      return null;
    }
    let geo = coneGeos.get(tag.height);
    let material = coneMats.get(tag.height);
    if (!(geo && material)) {
      geo = coneGeometry(tag.height);
      material = coneMaterial(tag.height);
      coneGeos.set(tag.height, geo);
      coneMats.set(tag.height, material);
    }
    cone = new Instances(geo, material, heads.capacity, heads.instanceMatrix);
    cone.drawCount = heads.drawCount;
    cone.computeBoundingSphere();
    cone.castShadow = false;
    cone.receiveShadow = false;
    cone.name = "style-lamp-cones";
    cone.visible = false;
    heads.parent.add(cone);
    cones.set(heads, cone);
    made.push(cone);
    return cone;
  };

  // The tagged sets, gathered once per scene change rather than walked for
  // every frame.
  let tagged: {
    crowns: { mesh: Instances; tier: Tier }[];
    lamps: { heads: Instances; tag: LampHeadsTag }[];
  } | null = null;
  const gather = () => {
    const found: NonNullable<typeof tagged> = { crowns: [], lamps: [] };
    scene.traverse((node) => {
      if (!isInstances(node)) {
        return;
      }
      const tier = node.userData.styleCrown as Tier | undefined;
      const lamp = node.userData.styleLampHeads as LampHeadsTag | undefined;
      if (tier) {
        found.crowns.push({ mesh: node, tier });
      } else if (lamp) {
        found.lamps.push({ heads: node, tag: lamp });
      }
    });
    tagged = found;
    return found;
  };

  const shown: Object3D[] = [];
  const hidden: Object3D[] = [];
  const dress = ({ crowns: kind, lampCones }: StyleDressingOptions) => {
    const list = tagged ?? gather();
    if (kind) {
      for (const { mesh, tier } of list.crowns) {
        const styled = styledFor(mesh, kind, tier);
        if (!(styled && mesh.visible)) {
          continue;
        }
        // Follows the original: the season may have swapped its material,
        // the level of detail its count.
        styled.material = mesh.material;
        styled.drawCount = mesh.drawCount;
        styled.geometry.boundingSphere = mesh.geometry.boundingSphere;
        styled.visible = true;
        mesh.visible = false;
        shown.push(styled);
        hidden.push(mesh);
      }
    }
    for (const { heads, tag } of lampCones ? list.lamps : []) {
      const cone = coneFor(heads, tag);
      if (cone && heads.visible) {
        cone.visible = true;
        shown.push(cone);
      }
    }
  };
  const undress = () => {
    for (const object of shown) {
      object.visible = false;
    }
    for (const object of hidden) {
      object.visible = true;
    }
    shown.length = 0;
    hidden.length = 0;
  };

  return {
    begin: (options) => {
      dress(options);
      return undress;
    },
    prepare: (options) => {
      made = [];
      dress(options);
      undress();
      return made;
    },
    sceneChanged: () => {
      tagged = null;
    },
    dispose: () => {
      for (const g of crownGeos.values()) {
        g.dispose();
      }
      for (const g of coneGeos.values()) {
        g.dispose();
      }
      for (const m of coneMats.values()) {
        m.dispose();
      }
    },
  };
}
