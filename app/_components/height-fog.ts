import {
  AdditiveBlending,
  Color,
  MultiplyBlending,
  type Scene,
  Vector4,
} from "three/webgpu";
import { VALLEY_FALLOFF_MAX, VALLEY_NEAR_M } from "@/lib/city/valley-fog";
import {
  clamp,
  float,
  Fn,
  fog,
  length,
  max,
  min,
  positionView,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";
import type { Node, NodeBuilder, UniformNode } from "three/webgpu";
import type { F, V3 } from "./shader-chunks";

/**
 * The scene's fog: one node for every material (`scene.fogNode`), so
 * nothing can float out of the haze — terrain, water, clay, trees, rails,
 * walls and lamps all take it without asking; a material opts out with
 * `fog = false` (the river mist). Three terms:
 *
 * - a distance fog over the view depth (three's `rangeFogFactor`, reproduced
 *   in `fogFactorAt` so the picture styles can take it off again; the
 *   *Nebel* slider's range);
 * - a world-Y pool above the valley floor (*Talnebel*): the Elbe valley
 *   pools deeper haze than bridge decks and high ground at the same
 *   distance. It builds on the distance fog, never replaces it — only adds
 *   haze toward the fog colour in low ground, so distant high ground still
 *   hazes normally. The start follows the lowest terrain landed so far.
 *   It sets in with distance (`VALLEY_NEAR_M`): what is right in front of
 *   the camera keeps its colour;
 * - the site-edge haze: the data ends at the outer tile edge, so the world
 *   dissolves into the fog colour over the last `SITE_EDGE_FADE_M` before
 *   it — never on what is right in front of the camera, so walking along
 *   the edge does not wade through a wall of mist.
 *
 * Every term is a uniform node: the sun rig writes the colour, the look the
 * range, Modell the pool's strength (`VALLEY_HAZE`, faded out as it backs
 * away), the stream the pool's start — uniform writes, never a rebuild.
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

/**
 * Talnebel: how much haze pools at the valley floor and over the Elbe —
 * light, a faint valley haze on a clear day that pairs with the ~0.2
 * distance fog; fixed at what its slider stood at (plan 073).
 */
export const VALLEY_HAZE = 0.2;

/** Default fade height (m) above the valley floor — ~the Elbe-to-rim drop;
 *  the site's own relief sets it once the tileset is read
 *  (lib/city/valley-fog.ts). */
const DEFAULT_FALLOFF = VALLEY_FALLOFF_MAX;

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
    heightStrength: uniform(VALLEY_HAZE),
    siteRect: uniform(new Vector4(-far, -far, far, far)),
  };
}

/** How much of the fog colour a fragment takes (0..1). */
export function fogFactor(f: SceneFog): F {
  return fogFactorAt(f, positionWorld, positionView);
}

/**
 * The same at any world point, `view` its view-space position — what the
 * picture styles read to take the haze off a frame again
 * (stylize-effect.ts), so they cut light and colour as they were under it.
 * three's distance fog is a smoothstep on the view depth.
 */
export function fogFactorAt(f: SceneFog, world: V3, view: V3): F {
  const depth = view.z.negate();
  const distance = smoothstep(f.near, f.far, depth);
  const pool = float(1)
    .sub(smoothstep(f.heightStart, f.heightStart.add(f.heightFalloff), world.y))
    .mul(smoothstep(VALLEY_NEAR_M[0], VALLEY_NEAR_M[1], length(view)));
  const pooled = clamp(
    distance.add(f.heightStrength.mul(pool).mul(float(1).sub(distance))),
    0,
    1
  );
  const xz = world.xz;
  const edgeD = min(xz.sub(f.siteRect.xy), f.siteRect.zw.sub(xz));
  const edge = float(1)
    .sub(smoothstep(0, SITE_EDGE_FADE_M, min(edgeD.x, edgeD.y)))
    .mul(smoothstep(60, 600, depth));
  return max(pooled, edge.mul(edge).mul(float(3).sub(edge.mul(2))));
}

/**
 * The colour a material fogs toward, chosen when its node graph is built:
 * the fog's, except for additive light (the lamp halos and pools), which
 * fades to black instead — mixed toward the fog colour, an additive
 * fragment would *add* fog-coloured light, and in the valley pool the
 * halos would glow grey rather than drown in the haze — and for a glaze
 * (MultiplyBlending: a mural's drawing on its wall, mural-layer.ts), which
 * fades to white, the colour that multiplies nothing: the wall under it
 * is fogged already. Not exact — the glaze then darkens the fog over it
 * too, by the fog's share — but a mural shows on the near LoD2 only,
 * where the haze is thin.
 */
function fogColourFor(f: SceneFog): Node {
  return Fn((builder: NodeBuilder) => {
    const blending = builder.material?.blending;
    if (blending === AdditiveBlending) {
      return vec3(0);
    }
    return blending === MultiplyBlending ? vec3(1) : f.color;
  })();
}

/** Hands the fog to the scene: every fogged material reads it. */
export function installSceneFog(scene: Scene, f: SceneFog): void {
  // reason: `fogNode` is read by WebGPURenderer but not declared on
  // three's Scene type.
  (scene as Scene & { fogNode: Node }).fogNode = fog(
    fogColourFor(f),
    fogFactor(f)
  );
}
