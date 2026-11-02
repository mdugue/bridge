/**
 * One read of the sun's shadow map at a world point, as three's own
 * lookup takes it (ShadowNode): the point through the map's matrix,
 * nearer than its far plane, the bias towards the light, a reversed map
 * holding 1 at the light and comparing the other way round. Shared by
 * the picture styles (stylize-effect.ts `inSun`) and the nameplate's
 * cast shadow (nameplate-layer.ts), so both test the sun the scene drew.
 *
 * The map is made by the first lit material, maybe after the graph that
 * reads it: the read binds a stand-in that compares like it, swapped for
 * the map (a binding, not a build) once it exists (`ready` 1).
 */
import {
  DepthTexture,
  GreaterEqualCompare,
  LessEqualCompare,
  type Matrix4,
  type UniformNode,
} from "three/webgpu";
import { float, min, smoothstep, step, texture, vec2, vec4 } from "three/tsl";
import type { F, V3 } from "./shader-chunks";

/** A stand-in for the map until it exists: compares like it. */
export function shadowStandIn(reversed: boolean): DepthTexture {
  const t = new DepthTexture(1, 1);
  t.compareFunction = reversed ? GreaterEqualCompare : LessEqualCompare;
  return t;
}

/**
 * The map at `world` (lifted off its surface by the caller): `shadowed`
 * 0 in a cast shadow, 1 in the sun (the map's own 2×2 filter at an edge);
 * `inside` how far the point is on the map's frustum, faded in over its
 * last 4 % so a caller's stand-in beyond it draws no line; `read` the
 * texture node to bind the map to.
 */
export function readSunShadow(
  world: V3,
  map: {
    matrix: UniformNode<"mat4", Matrix4>;
    bias: UniformNode<"float", number>;
    ready: UniformNode<"float", number>;
  },
  standIn: DepthTexture,
  reversed: boolean
): { inside: F; shadowed: F; read: ReturnType<typeof texture> } {
  const s = map.matrix.mul(vec4(world, 1));
  const c = s.xyz.div(s.w);
  const at = vec2(c.x, float(1).sub(c.y));
  const edge = min(
    min(at.x, float(1).sub(at.x)),
    min(at.y, float(1).sub(at.y))
  );
  const inside = smoothstep(0, 0.04, edge)
    .mul(reversed ? step(0, c.z) : step(c.z, 1))
    .mul(map.ready);
  const read = texture(standIn, at);
  const shadowed = read.compare(
    reversed ? c.z.sub(map.bias) : c.z.add(map.bias)
  ).x;
  return { inside, shadowed, read };
}
