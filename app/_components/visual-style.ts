import type {
  Group,
  Material,
  Mesh,
  WebGLProgramParametersWithUniforms,
} from "three";
import {
  BufferGeometry,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
} from "three";
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
export const DEFAULT_GHOST_TRANSPARENCY = 0.35;
export const DEFAULT_CLAY_TRANSPARENCY = 0;
export const DEFAULT_EDGE_OPACITY = 0.7;
/** 0 = smooth shading; >= 2 = gradient-mapped toon bands. */
export const DEFAULT_TOON_BANDS = 0;

export interface StyleResources {
  clay: MeshStandardMaterial;
  dispose: () => void;
  edgeLines: LineBasicMaterial;
  /** mutated by setEdgeOpacity; applyCityStyle reads it for visibility */
  edgesVisible: boolean;
  ghost: MeshPhysicalMaterial;
  /** shared uniform driving the toon banding in ghost + clay shaders */
  toonBands: { value: number };
}

const EDGE_THRESHOLD_DEG = 30;

/**
 * Gradient-mapped toon banding, injected into the lit materials and driven
 * by a shared uniform — toggling does not recompile shaders. Quantizes the
 * final lit luminance (in gamma space, so bands are perceptually even)
 * while preserving hue.
 */
const TOON_CHUNK = /* glsl */ `
  if ( toonBands >= 1.5 ) {
    float toonLuma = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
    float toonGamma = pow( max( toonLuma, 0.0 ), 0.4545 );
    float toonQuant = ( floor( toonGamma * toonBands ) + 0.5 ) / toonBands;
    float toonTarget = pow( toonQuant, 2.2 );
    outgoingLight *= toonTarget / max( toonLuma, 1e-5 );
  }
`;

function injectToon(
  shader: WebGLProgramParametersWithUniforms,
  toonBands: { value: number }
): void {
  shader.uniforms.toonBands = toonBands;
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float toonBands;")
    .replace(
      "#include <opaque_fragment>",
      `${TOON_CHUNK}\n#include <opaque_fragment>`
    );
}

/** Shared materials, created once per app instance. */
export function createStyleResources(): StyleResources {
  const toonBands = { value: DEFAULT_TOON_BANDS };

  // Frosted glass: `transmission` samples a blurred buffer of the scene
  // BEHIND (terrain, sky, hero models — other transmissive buildings are
  // excluded), so what shows through is stable under camera motion. This
  // replaces the depthWrite-transparency approach whose visibility of
  // occluded walls flipped with draw order while moving.
  // Dense, milky glass: high roughness + low specular kill the glassy
  // shine; thickness + attenuation give the body density so transmitted
  // bright sky doesn't wash the buildings out.
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
  ghost.onBeforeCompile = (shader) => injectToon(shader, toonBands);

  const clay = new MeshStandardMaterial({
    color: 0xec_e7_df,
    roughness: 1,
    metalness: 0,
    // Hash-dithered transparency (see setCityTransparency) — opaque-pass
    // compositing keeps occlusion correct on the batched mesh.
    opacity: 1 - DEFAULT_CLAY_TRANSPARENCY,
    alphaHash: DEFAULT_CLAY_TRANSPARENCY > 0,
  });
  clay.onBeforeCompile = (shader) => injectToon(shader, toonBands);

  const edgeLines = new LineBasicMaterial({
    color: 0x2f_35_40,
    transparent: true,
    opacity: DEFAULT_EDGE_OPACITY,
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
    toonBands,
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

/** 0 disables toon banding; 2..6 are sensible band counts. */
export function setToonBands(resources: StyleResources, bands: number): void {
  resources.toonBands.value = bands;
}

/** Ink edge strength; 0 hides the lines entirely (via applyCityStyle). */
export function setEdgeOpacity(
  resources: StyleResources,
  opacity: number
): void {
  resources.edgeLines.opacity = Math.min(Math.max(opacity, 0), 1);
  resources.edgesVisible = opacity > 0.01;
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
  // Render AFTER all building fills so hidden edges are depth-tested away —
  // otherwise lines of occluded buildings draw through walls and the whole
  // city reads as x-ray glass no matter how opaque the fills are.
  lines.renderOrder = 1;
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
