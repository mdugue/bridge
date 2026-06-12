import type { Group, Material, Mesh } from "three";
import {
  BufferGeometry,
  EdgesGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
} from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * City rendering styles. Picking/demolish read geometry attributes, not
 * materials, so the loader meshes can carry any material we like:
 *  - standard: the loader's per-type CityObjectsMaterial (LoD colors)
 *  - ghost: frosted-glass massing (physical transmission — the backdrop
 *    shows through blurred, consistently; never order-dependent popping)
 *  - clay: archviz clay with adjustable plain transparency
 */
export type CityStyleId = "standard" | "ghost" | "clay";
export const CITY_STYLE_IDS: CityStyleId[] = ["standard", "ghost", "clay"];

/** Transparency defaults per style (0 = solid, 1 = fully see-through). */
export const DEFAULT_GHOST_TRANSPARENCY = 0.05;
export const DEFAULT_CLAY_TRANSPARENCY = 0;
export const DEFAULT_EDGE_OPACITY = 0.7;
/** Ink edge width in device pixels (fat lines — real, continuous width). */
const EDGE_LINEWIDTH = 2.2;

export interface StyleResources {
  clay: MeshStandardMaterial;
  dispose: () => void;
  /** fat-line ink material; width needs a resolution (see setEdgeResolution) */
  edgeLines: LineMaterial;
  /** mutated by setEdgeOpacity; applyCityStyle reads it for visibility */
  edgesVisible: boolean;
  ghost: MeshPhysicalMaterial;
}

const EDGE_THRESHOLD_DEG = 30;

/** Shared materials, created once per app instance. */
export function createStyleResources(): StyleResources {
  // Frosted glass: `transmission` samples a blurred buffer of the scene
  // BEHIND (terrain, sky, hero models — other transmissive buildings are
  // excluded), so what shows through is stable under camera motion.
  const ghost = new MeshPhysicalMaterial({
    color: 0xdf_e5_e9,
    roughness: 0.8,
    metalness: 0,
    specularIntensity: 0.4,
    transmission: DEFAULT_GHOST_TRANSPARENCY,
    ior: 1.2,
    thickness: 8,
    attenuationColor: 0xb8_c4_cc,
    attenuationDistance: 12,
  });

  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
    // Hash-dithered transparency (see setCityTransparency) — opaque-pass
    // compositing keeps occlusion correct on the batched mesh.
    opacity: 1 - DEFAULT_CLAY_TRANSPARENCY,
    alphaHash: DEFAULT_CLAY_TRANSPARENCY > 0,
  });

  // Fat ink lines: real screen-space width (LineBasicMaterial ignores width
  // on most platforms). polygonOffset pulls them a hair towards the camera so
  // they don't z-fight the wall they sit on — that fighting is what made the
  // thin lines look broken / dashed.
  const edgeLines = new LineMaterial({
    color: 0x2f_35_40,
    linewidth: EDGE_LINEWIDTH,
    worldUnits: false,
    transparent: true,
    opacity: DEFAULT_EDGE_OPACITY,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    resolution: new Vector2(window.innerWidth, window.innerHeight),
  });

  // Shared across reloads — disposeObject3D must not free them mid-session.
  ghost.userData.shared = true;
  clay.userData.shared = true;
  edgeLines.userData.shared = true;

  return {
    ghost,
    clay,
    edgeLines,
    edgesVisible: DEFAULT_EDGE_OPACITY > 0,
    dispose: () => {
      ghost.dispose();
      clay.dispose();
      edgeLines.dispose();
    },
  };
}

/**
 * Transparency for the ACTIVE style, 0 (solid) .. 1 (fully see-through).
 *
 * Ghost maps it to frosted transmission (stable, but only the backdrop
 * shows through). Clay uses hash-dithered transparency (`alphaHash`):
 * stochastic coverage composited in the OPAQUE pass with full depth
 * testing, so buildings behind buildings, backsides and roofs all occlude
 * correctly — the batched mesh makes sorted alpha blending impossible.
 *
 * NOTE on needsUpdate: three bakes an OPAQUE define (alpha forced to 1)
 * and the alpha-hash/transmission code paths into the compiled program.
 * Crossing the on/off boundary without flagging needsUpdate leaves the
 * stale program running until something else (e.g. the sun light count
 * changing at sunrise) happens to force a rebuild.
 */
export function setCityTransparency(
  resources: StyleResources,
  style: CityStyleId,
  transparency: number
): void {
  const t = Math.min(Math.max(transparency, 0), 1);
  if (style === "ghost") {
    const wasTransmissive = resources.ghost.transmission > 0;
    resources.ghost.transmission = t;
    if (t > 0 !== wasTransmissive) {
      resources.ghost.needsUpdate = true;
    }
    return;
  }
  if (style === "clay") {
    const clay = resources.clay;
    const wasHashed = clay.alphaHash;
    clay.opacity = 1 - t;
    clay.alphaHash = t > 0;
    clay.transparent = false;
    if (clay.alphaHash !== wasHashed) {
      clay.needsUpdate = true;
    }
  }
}

/** Ink edge strength; 0 hides the lines entirely (via applyCityStyle). */
export function setEdgeOpacity(
  resources: StyleResources,
  opacity: number
): void {
  resources.edgeLines.opacity = Math.min(Math.max(opacity, 0), 1);
  resources.edgesVisible = opacity > 0.01;
}

/** Fat lines need the drawing-buffer size to compute their pixel width. */
export function setEdgeResolution(
  resources: StyleResources,
  width: number,
  height: number
): void {
  resources.edgeLines.resolution.set(width, height);
}

/**
 * Ink outline for one batched city mesh. The loader geometry is non-indexed
 * (flat-shaded), so EdgesGeometry would treat every triangle edge as a
 * boundary — weld a positions-only copy first, then promote to fat-line
 * geometry.
 */
function buildEdges(mesh: Mesh, material: LineMaterial): LineSegments2 {
  const positionsOnly = new BufferGeometry();
  positionsOnly.setAttribute(
    "position",
    mesh.geometry.getAttribute("position")
  );
  const welded = mergeVertices(positionsOnly, 1e-4);
  const edges = new EdgesGeometry(welded, EDGE_THRESHOLD_DEG);
  welded.dispose();
  const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edges);
  edges.dispose();
  const lines = new LineSegments2(lineGeo, material);
  lines.name = "city-edges";
  // Render AFTER all building fills so hidden edges are depth-tested away —
  // otherwise occluded edges draw through walls and the city reads x-ray.
  lines.renderOrder = 1;
  // Decoration only: keep the demolish raycast off the line segments.
  lines.raycast = () => {
    // intentionally empty
  };
  return lines;
}

interface StyledCityMesh extends Mesh {
  isCityObjectMesh?: boolean;
  userData: {
    edges?: LineSegments2;
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

    const wantEdges = style !== "standard" && resources.edgesVisible;
    if (wantEdges && !mesh.userData.edges) {
      mesh.userData.edges = buildEdges(mesh, resources.edgeLines);
      mesh.add(mesh.userData.edges);
    }
    if (mesh.userData.edges) {
      mesh.userData.edges.visible = wantEdges;
    }
  });
}
