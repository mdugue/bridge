/**
 * One read of the sun's shadow map at a world point, as the scene's own
 * lookup takes it (sun-rings.ts): the finest ring the point lies on, through
 * that ring's matrix, nearer than its far plane, the bias towards the light,
 * a reversed map holding 1 at the light and comparing the other way round.
 * Shared by the picture styles (stylize-effect.ts `inSun`) and the
 * nameplate's cast shadow (nameplate-layer.ts), so both test the sun the
 * scene drew.
 *
 * The map is made by the first lit material, maybe after the graph that
 * reads it: the read binds a stand-in that compares like it, swapped for
 * the map (a binding, not a build) once it exists (`ready` 1).
 */
import {
  DepthTexture,
  GreaterEqualCompare,
  LessEqualCompare,
} from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import { float, int, max, mix, step, texture } from "three/tsl";
import { SHADOW_RINGS } from "@/lib/city/shadow-rings";
import type { F, V3 } from "./shader-chunks";
import { ringLookup } from "./sun-rings";
import type { ShadowRingNodes } from "./sun-rings";

/** A stand-in for the map until it exists: an array like it, compares like
 *  it. */
export function shadowStandIn(reversed: boolean): DepthTexture {
  const t = new DepthTexture(
    1,
    1,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    SHADOW_RINGS
  );
  t.compareFunction = reversed ? GreaterEqualCompare : LessEqualCompare;
  return t;
}

/**
 * The map at `world` (lifted off its surface by the caller): `shadowed`
 * 0 in a cast shadow, 1 in the sun (the map's own 2×2 filter at an edge);
 * `inside` how far the point is on any ring, faded in over the widest's edge so
 * a caller's stand-in beyond it draws no line; `read` the texture node to
 * bind the map to.
 */
export function readSunShadow(
  world: V3,
  rings: ShadowRingNodes,
  ready: UniformNode<"float", number>,
  standIn: DepthTexture,
  reversed: boolean
): { inside: F; shadowed: F; read: ReturnType<typeof texture> } {
  const hit = ringLookup(world, rings, reversed);
  // a ring's edge band and a fading ring are on the map all the same: past
  // half strength the next ring out answers
  const onNext = step(hit.weight, 0.5);
  const at = mix(hit.at, hit.nextAt, onNext) as V3;
  const layer = int(
    mix(float(hit.layer), float(hit.nextLayer), onNext).add(0.5)
  );
  const read = texture(standIn, at.xy);
  const shadowed = read.depth(layer).compare(at.z).x;
  return { inside: max(hit.weight, hit.nextWeight).mul(ready), shadowed, read };
}
