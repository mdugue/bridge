import type { Material, Mesh, Object3D } from "three/webgpu";
import {
  isLineNode,
  LINE_ATTRIBUTES,
  LINE_LAYERS,
  LINE_NODES,
  type LineLayer,
  type LineNode,
} from "@/lib/city/line-nodes";
import { setGraph } from "./material-slots";
import { RAIL_LOOKS } from "./rail-layer";
import { RIVERSIDE_LOOKS } from "./riverside-layer";
import { TRAM_LOOKS } from "./tram-layer";

/**
 * The rails, trams and riverside the build bakes into the fine terrain
 * glTF (scripts/bake-lines.ts, plan 074 part A, ADR 0029): the viewer only
 * finds their nodes by name and gives each the look its layer drew it
 * with — the same scene-wide material (its colour, finish and nodes), cast
 * or not — as the walls and stairs are given theirs (wall-layer.ts,
 * stair-layer.ts). They arrive and leave with the fine level.
 */
export interface LineLook {
  /** whether the part casts into the sun's shadow map */
  cast: boolean;
  /** the layer's scene-wide material (three-utils.ts `sceneMaterial`) */
  material: () => Material;
  /** receives the sun's shadow (default true) */
  receive?: boolean;
  /** drawn after the water sheet (the ferry wake) */
  renderOrder?: number;
}

const LOOKS = {
  ...RAIL_LOOKS,
  ...TRAM_LOOKS,
  ...RIVERSIDE_LOOKS,
} as const satisfies Record<LineNode, LineLook>;

/**
 * The tile's own copy of a scene-wide material. The tile renderer records
 * every material in a tile's content after the dressing plugin dressed it
 * and disposes them all when the tile unloads, so a scene-wide material
 * there would be disposed for the whole scene, and every tile wearing it
 * would rebuild its shaders inside the frames of a flight. The copy keeps
 * the original's nodes (one build for every tile) and names that build
 * (material-slots.ts `setGraph`), so the pipeline anchors keep it when the
 * last tile wearing it leaves.
 */
function tileMaterial(shared: Material): Material {
  const material = shared.clone();
  delete material.userData.shared;
  material.name = shared.name;
  setGraph(material, `line:${shared.name}`);
  return material;
}

/** The baked line meshes of a fine terrain level, by the layer they are
 *  part of. */
export type LineMeshes = Record<LineLayer, Mesh[]>;

/**
 * Gives every baked line node under `root` its look: its layer's
 * material (a copy of its own), cast and receive as the layer drew it,
 * and its custom attributes under the names the material reads (the glTF
 * loader lower-cases them, line-nodes.ts `LINE_ATTRIBUTES`).
 */
export function dressLines(root: Object3D): LineMeshes {
  const out = Object.fromEntries(
    LINE_LAYERS.map((layer) => [layer, [] as Mesh[]])
  ) as LineMeshes;
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!(mesh.isMesh && isLineNode(mesh.name))) {
      return;
    }
    const look: LineLook = LOOKS[mesh.name];
    const geometry = mesh.geometry;
    for (const [from, to] of Object.entries(LINE_ATTRIBUTES)) {
      const attribute = geometry.getAttribute(from);
      if (attribute) {
        geometry.setAttribute(to, attribute);
        geometry.deleteAttribute(from);
      }
    }
    mesh.material = tileMaterial(look.material());
    mesh.castShadow = look.cast;
    mesh.receiveShadow = look.receive ?? true;
    if (look.renderOrder !== undefined) {
      mesh.renderOrder = look.renderOrder;
    }
    out[LINE_NODES[mesh.name]].push(mesh);
  });
  return out;
}

/** Every baked line mesh of a level, whatever its layer. */
export function lineMeshes(lines: LineMeshes | undefined): Mesh[] {
  return lines ? LINE_LAYERS.flatMap((layer) => lines[layer]) : [];
}
