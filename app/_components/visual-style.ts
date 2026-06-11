import type { Group, Material, Mesh } from "three";
import {
  BufferGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshStandardMaterial,
} from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * City rendering styles. Picking/demolish read geometry attributes, not
 * materials, so the loader meshes can carry any material we like:
 *  - standard: the loader's per-type CityObjectsMaterial (LoD colors)
 *  - ghost: translucent fresnel "massing" — context frame for hero buildings
 *  - clay: opaque archviz clay + ink edges
 */
export type CityStyleId = "standard" | "ghost" | "clay";
export const CITY_STYLE_IDS: CityStyleId[] = ["standard", "ghost", "clay"];

export interface StyleResources {
  clay: MeshStandardMaterial;
  dispose: () => void;
  edgeLines: LineBasicMaterial;
  ghost: MeshStandardMaterial;
}

const EDGE_THRESHOLD_DEG = 30;

/** Shared materials, created once per app instance. */
export function createStyleResources(): StyleResources {
  const ghost = new MeshStandardMaterial({
    color: 0xe6_ed_f3,
    roughness: 0.45,
    metalness: 0,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  // Fresnel-weighted opacity: airy in the center, defined at grazing angles —
  // the classic architecture-massing read, without true transmission costs.
  ghost.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `float ghostFresnel = pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 1.6 );
       vec4 diffuseColor = vec4( diffuse, opacity * ( 0.4 + 0.6 * ghostFresnel ) );`
    );
  };

  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
  });

  const edgeLines = new LineBasicMaterial({
    color: 0x2f_35_40,
    transparent: true,
    opacity: 0.7,
  });

  // Shared across reloads — disposeObject3D must not free them mid-session.
  ghost.userData.shared = true;
  clay.userData.shared = true;
  edgeLines.userData.shared = true;

  return {
    ghost,
    clay,
    edgeLines,
    dispose: () => {
      ghost.dispose();
      clay.dispose();
      edgeLines.dispose();
    },
  };
}

/**
 * Ink outline for one batched city mesh. The loader geometry is non-indexed
 * (flat-shaded), so EdgesGeometry would treat every triangle edge as a
 * boundary — weld a positions-only copy first.
 */
function buildEdges(mesh: Mesh, material: LineBasicMaterial): LineSegments {
  const positionsOnly = new BufferGeometry();
  positionsOnly.setAttribute(
    "position",
    mesh.geometry.getAttribute("position")
  );
  const welded = mergeVertices(positionsOnly, 1e-4);
  const edges = new EdgesGeometry(welded, EDGE_THRESHOLD_DEG);
  welded.dispose();
  const lines = new LineSegments(edges, material);
  lines.name = "city-edges";
  // Decoration only: keep the demolish raycast off ~100k line segments.
  lines.raycast = () => {
    // intentionally empty
  };
  return lines;
}

interface StyledCityMesh extends Mesh {
  isCityObjectMesh?: boolean;
  userData: {
    edges?: LineSegments;
    originalMaterial?: Material | Material[];
  };
}

/**
 * Applies a style to all batched city meshes in the loader group. Edge
 * overlays are built lazily per mesh and cached; after a demolish-reload the
 * new meshes start bare, so call this again with the current style.
 */
export function applyCityStyle(
  cityGroup: Group,
  style: CityStyleId,
  resources: StyleResources
): void {
  cityGroup.traverse((obj) => {
    const mesh = obj as StyledCityMesh;
    if (!mesh.isCityObjectMesh) {
      return;
    }
    mesh.userData.originalMaterial ??= mesh.material;

    if (style === "standard") {
      mesh.material = mesh.userData.originalMaterial;
    } else {
      mesh.material = style === "ghost" ? resources.ghost : resources.clay;
    }

    const wantEdges = style !== "standard";
    if (wantEdges && !mesh.userData.edges) {
      mesh.userData.edges = buildEdges(mesh, resources.edgeLines);
      mesh.add(mesh.userData.edges);
    }
    if (mesh.userData.edges) {
      mesh.userData.edges.visible = wantEdges;
    }
  });
}
