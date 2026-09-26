import { Color, type Scene, Vector4 } from "three/webgpu";
import {
  clamp,
  float,
  fog,
  max,
  min,
  positionView,
  positionWorld,
  rangeFogFactor,
  smoothstep,
  uniform,
} from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { F } from "./shader-chunks";

/**
 * The scene's fog: one node for every material (`scene.fogNode`), so
 * nothing can float out of the haze — terrain, water, clay, trees, rails,
 * walls and lamps all take it without asking; a material opts out with
 * `fog = false` (the river mist). Three terms:
 *
 * - three's distance fog (`rangeFogFactor`, the *Nebel* slider's range);
 * - a world-Y pool above the valley floor (*Talnebel*): the Elbe valley
 *   pools deeper haze than bridge decks and high ground at the same
 *   distance. It builds on the distance fog, never replaces it — only adds
 *   haze toward the fog colour in low ground, so distant high ground still
 *   hazes normally. The start follows the lowest terrain landed so far;
 * - the site-edge haze: the data ends at the outer tile edge, so the world
 *   dissolves into the fog colour over the last `SITE_EDGE_FADE_M` before
 *   it — never on what is right in front of the camera, so walking along
 *   the edge does not wade through a wall of mist.
 *
 * Every term is a uniform node: the sun rig writes the colour, the look the
 * range and the pool's strength, the stream the pool's start — uniform
 * writes, never a rebuild.
 */
export interface SceneFog {
  /** the palette fog colour (sun-rig.ts); also the water's sky tint */
  color: UniformNode<"color", Color>;
  /** distance fog range (m) */
  near: UniformNode<"float", number>;
  far: UniformNode<"float", number>;
  /** world-Y (elevation, m) below which the extra haze pools */
  heightStart: UniformNode<"float", number>;
  /** metres of fade above the start over which the pool decays to 0 */
  heightFalloff: UniformNode<"float", number>;
  /** 0..1 — extra haze toward the fog colour in low ground */
  heightStrength: UniformNode<"float", number>;
  /** the site's extent in world XZ (minX, minZ, maxX, maxZ); infinite =
   *  no edge haze */
  siteRect: UniformNode<"vec4", Vector4>;
}

/** Default fade height (m) above the valley floor — ~the Elbe-to-rim drop. */
const DEFAULT_FALLOFF = 28;

/**
 * Width (m) of the haze band inside the site's outer edge. Wide enough that
 * the tile edge (and the terrain skirt under it) is fully fogged before the
 * data stops, narrow enough that the walkable city keeps its colour.
 */
export const SITE_EDGE_FADE_M = 450;

/** The fog's uniforms (no edge until the site is known). */
export function createSceneFog(
  colour: number,
  range: { far: number; near: number }
): SceneFog {
  const far = 1e9;
  return {
    color: uniform(new Color(colour)),
    near: uniform(range.near),
    far: uniform(range.far),
    heightStart: uniform(0),
    heightFalloff: uniform(DEFAULT_FALLOFF),
    heightStrength: uniform(LOOK_DEFAULTS.heightFog),
    siteRect: uniform(new Vector4(-far, -far, far, far)),
  };
}

/** How much of the fog colour a fragment takes (0..1). */
export function fogFactor(f: SceneFog): F {
  const distance = rangeFogFactor(f.near, f.far);
  const pool = float(1).sub(
    smoothstep(
      f.heightStart,
      f.heightStart.add(f.heightFalloff),
      positionWorld.y
    )
  );
  const pooled = clamp(
    distance.add(f.heightStrength.mul(pool).mul(float(1).sub(distance))),
    0,
    1
  );
  const xz = positionWorld.xz;
  const edgeD = min(xz.sub(f.siteRect.xy), f.siteRect.zw.sub(xz));
  const edge = float(1)
    .sub(smoothstep(0, SITE_EDGE_FADE_M, min(edgeD.x, edgeD.y)))
    .mul(smoothstep(60, 600, positionView.z.negate()));
  return max(pooled, edge.mul(edge).mul(float(3).sub(edge.mul(2))));
}

/** Hands the fog to the scene: every fogged material reads it. */
export function installSceneFog(scene: Scene, f: SceneFog): void {
  // reason: `fogNode` is read by WebGPURenderer but not declared on
  // three's Scene type.
  (scene as Scene & { fogNode: Node }).fogNode = fog(f.color, fogFactor(f));
}
