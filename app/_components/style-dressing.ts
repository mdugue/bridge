import type { Object3D, Scene } from "three";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  type BufferAttribute,
  InstancedBufferAttribute,
  InstancedInterleavedBuffer,
  InstancedMesh,
  type InterleavedBufferAttribute,
  type Material,
  type MeshStandardMaterial,
  ShaderMaterial,
} from "three";
import type { CrownStyle } from "@/lib/city/render-style";
import { nodeRenderer } from "./gpu-mode";
import { type LampConeMaterial, nodeLampCone } from "./style-node";
import { buildStyleCrownGeo } from "./vegetation-layer";

/**
 * The picture styles' scene dressing (lib/city/render-style.ts): geometry a
 * style draws with for its frames only, swapped in before the render and
 * restored right after, like the Papier material (paper-scene.ts). Nothing a
 * tile builds knows a style; the layers only tag what may be dressed
 * (`userData.styleCrown` on the crown meshes, `userData.styleLampHeads` on
 * the lamp heads).
 *
 * - Crowns: every tagged crown mesh wears the style's crown for the frame
 *   (vegetation-layer.ts `buildStyleCrownGeo`) — Comic's cloud of balls,
 *   Papier's folded card. A seasonal crown's per-chunk attribute (`aBare`)
 *   rides along on a view of the style geometry.
 * - Lamp cones (Film noir): a soft light cone under every lamp head, one
 *   instanced mesh per heads mesh sharing its instance matrices. They glow
 *   faintly by day — the street lamps of a noir set are always on — and fill
 *   in as the lamps light (read from the heads' emissive).
 */

/** Light-cone strength by day, and at full night. */
const CONE_DAY = 0.22;
const CONE_NIGHT = 1;
const CONE_RADIUS = 3.4;
const CONE_COLOR = new Color(0xff_e2_b0);

interface LampHeadsTag {
  emissiveAtNight: number;
  height: number;
}

const coneVertex = /* glsl */ `
  uniform float coneHeight;
  varying float vHeight;
  varying float vFacing;
  void main() {
    vec4 local = instanceMatrix * vec4(position, 1.0);
    vec4 mv = modelViewMatrix * local;
    vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));
    vHeight = clamp(position.y / coneHeight, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const coneFragment = /* glsl */ `
  uniform vec3 coneColor;
  uniform float strength;
  varying float vHeight;
  varying float vFacing;
  void main() {
    // Brightest through the cone's core and near the lantern, fading to the
    // ground: a shaft of light in the smoke, not a lampshade.
    float core = pow(vFacing, 1.6);
    float fall = mix(0.12, 1.0, pow(vHeight, 1.4));
    float a = core * fall * strength * 0.55;
    gl_FragColor = vec4(coneColor * a, 1.0);
  }
`;

/** The GLSL cone: its material and its two live uniforms. */
function glLampCone(): LampConeMaterial {
  const material = new ShaderMaterial({
    vertexShader: coneVertex,
    fragmentShader: coneFragment,
    uniforms: {
      coneColor: { value: CONE_COLOR },
      coneHeight: { value: 5 },
      strength: { value: CONE_DAY },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  return {
    material: material as unknown as MeshStandardMaterial,
    height: material.uniforms.coneHeight as { value: number },
    strength: material.uniforms.strength as { value: number },
  };
}

/**
 * Per-instance data of a crown mesh: an instanced attribute, or a view of
 * one (the node renderer's shared instancing hands the instance matrices to
 * the build as views of an instanced buffer — shared-instancing.ts).
 */
function isPerInstance(
  attr: BufferAttribute | InterleavedBufferAttribute
): boolean {
  return (
    attr instanceof InstancedBufferAttribute ||
    (attr as InterleavedBufferAttribute).data instanceof
      InstancedInterleavedBuffer
  );
}

function coneGeometry(height: number): BufferGeometry {
  const h = height - 0.15;
  // Open-ended; apex just under the lantern, the base on the ground.
  const g = new ConeGeometry(CONE_RADIUS, h, 28, 1, true);
  g.translate(0, h / 2, 0);
  return g;
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
   * A stand-in wearing the lamp cones' material, for compiling its program
   * ahead of the first noir frame; shares the caller's geometry.
   */
  proxies: (geometry: BufferGeometry) => Object3D[];
  /** The scene's objects changed: the next frame re-reads what to dress. */
  sceneChanged: () => void;
}

export function createStyleDressing(scene: Scene): StyleDressing {
  // Style crowns: built on first use, shared by every tile.
  const crownGeos = new Map<string, BufferGeometry>();
  const crownGeo = (kind: CrownStyle, tier: string): BufferGeometry => {
    const key = `${kind}:${tier}`;
    let g = crownGeos.get(key);
    if (!g) {
      g = buildStyleCrownGeo(kind, tier as "far" | "mid" | "rich");
      g.computeBoundingSphere();
      crownGeos.set(key, g);
    }
    return g;
  };
  // A view of a style crown carrying the original's per-chunk instanced
  // attributes (the season's aBare); freed with the original.
  const views = new WeakMap<BufferGeometry, Map<string, BufferGeometry>>();
  const styledFor = (
    original: BufferGeometry,
    kind: CrownStyle,
    tier: string
  ): BufferGeometry => {
    const style = crownGeo(kind, tier);
    const extras = Object.entries(original.attributes).filter(
      ([name, attr]) => isPerInstance(attr) && !(name in style.attributes)
    );
    if (extras.length === 0) {
      return style;
    }
    let byKey = views.get(original);
    if (!byKey) {
      byKey = new Map();
      views.set(original, byKey);
      const own = byKey;
      original.addEventListener("dispose", () => {
        for (const view of own.values()) {
          view.dispose();
        }
        own.clear();
      });
    }
    const key = `${kind}:${tier}`;
    let view = byKey.get(key);
    if (!view) {
      view = new BufferGeometry();
      view.setIndex(style.index);
      for (const [name, attr] of Object.entries(style.attributes)) {
        view.setAttribute(name, attr);
      }
      for (const [name, attr] of extras) {
        view.setAttribute(name, attr);
      }
      view.boundingSphere = style.boundingSphere;
      byKey.set(key, view);
    }
    return view;
  };

  // Lamp cones: one material for the scene, one geometry per post height,
  // one mesh per heads mesh (collected with it).
  // SPIKE (plan 020): the node renderer runs no ShaderMaterial.
  const coneLook = nodeRenderer() ? nodeLampCone(CONE_COLOR) : glLampCone();
  const coneMaterial: Material = coneLook.material;
  const coneGeos = new Map<number, BufferGeometry>();
  const cones = new WeakMap<InstancedMesh, InstancedMesh>();
  const coneFor = (heads: InstancedMesh, tag: LampHeadsTag): InstancedMesh => {
    let cone = cones.get(heads);
    if (!cone) {
      let geo = coneGeos.get(tag.height);
      if (!geo) {
        geo = coneGeometry(tag.height);
        coneGeos.set(tag.height, geo);
      }
      cone = new InstancedMesh(geo, coneMaterial, heads.count);
      cone.instanceMatrix = heads.instanceMatrix;
      cone.castShadow = false;
      cone.receiveShadow = false;
      cone.name = "style-lamp-cones";
      cone.computeBoundingSphere();
      cones.set(heads, cone);
    }
    cone.count = heads.count;
    return cone;
  };

  const crowns: { geometry: BufferGeometry; mesh: InstancedMesh }[] = [];
  const added: { cone: InstancedMesh; parent: Object3D }[] = [];
  // The tagged meshes, gathered once per scene change rather than walked
  // for every frame. A crown hidden by its level of detail may wear the
  // style's geometry unseen; a lamp's own visibility is read per frame.
  let tagged: {
    crowns: { mesh: InstancedMesh; tier: string }[];
    lamps: { heads: InstancedMesh; tag: LampHeadsTag }[];
  } | null = null;
  const gather = () => {
    const found: NonNullable<typeof tagged> = { crowns: [], lamps: [] };
    scene.traverse((node) => {
      if (!(node instanceof InstancedMesh)) {
        return;
      }
      const mesh = node as InstancedMesh;
      const tier = mesh.userData.styleCrown as string | undefined;
      const lamp = mesh.userData.styleLampHeads as LampHeadsTag | undefined;
      if (tier) {
        found.crowns.push({ mesh, tier });
      } else if (lamp) {
        found.lamps.push({ heads: mesh, tag: lamp });
      }
    });
    return found;
  };

  return {
    begin: ({ crowns: crownStyle, lampCones }) => {
      crowns.length = 0;
      added.length = 0;
      tagged ??= gather();
      let night = 0;
      if (crownStyle) {
        for (const { mesh, tier } of tagged.crowns) {
          crowns.push({ mesh, geometry: mesh.geometry });
          mesh.geometry = styledFor(mesh.geometry, crownStyle, tier);
        }
      }
      for (const { heads, tag } of lampCones ? tagged.lamps : []) {
        if (!(heads.visible && heads.parent)) {
          continue;
        }
        const material = heads.material as MeshStandardMaterial;
        night = Math.max(
          night,
          material.emissiveIntensity / tag.emissiveAtNight
        );
        coneLook.height.value = tag.height;
        added.push({ cone: coneFor(heads, tag), parent: heads.parent });
      }
      coneLook.strength.value =
        CONE_DAY + (CONE_NIGHT - CONE_DAY) * Math.min(Math.max(night, 0), 1);
      for (const { cone, parent } of added) {
        parent.add(cone);
      }
      return () => {
        for (const { mesh, geometry } of crowns) {
          mesh.geometry = geometry;
        }
        for (const { cone, parent } of added) {
          parent.remove(cone);
        }
        crowns.length = 0;
        added.length = 0;
      };
    },
    sceneChanged: () => {
      tagged = null;
    },
    proxies: (geometry) => [new InstancedMesh(geometry, coneMaterial, 1)],
    dispose: () => {
      for (const g of crownGeos.values()) {
        g.dispose();
      }
      for (const g of coneGeos.values()) {
        g.dispose();
      }
      coneMaterial.dispose();
    },
  };
}
