/**
 * The sun's shadow map as four rings (lib/city/shadow-rings.ts, ADR 0009):
 * squares of one resolution, each three times as wide as the one inside it,
 * the layers of one depth array. One layer is redrawn at a time, and the one
 * shadow camera draws them all: three keeps its state per drawable and
 * camera, so a camera per ring would cost a phone memory per tile object.
 *
 * What a fragment reads is the finest ring it lies on, across a band at that
 * ring's edge cross-faded with the next, and past the widest none: there the
 * baked horizon takes over (sky-light.ts). A layer read and a matrix belong
 * together, so a ring's matrix changes only as the ring is drawn: a ring not
 * yet redrawn shows what it held, where it held it.
 */
import {
  DepthTexture,
  GreaterEqualCompare,
  LessEqualCompare,
  Matrix4,
  RenderTarget,
  Vector3,
} from "three/webgpu";
import type {
  DirectionalLight,
  Light,
  LightShadow,
  Node,
  NodeBuilder,
  Object3D,
  UniformNode,
} from "three/webgpu";
import {
  float,
  Fn,
  If,
  int,
  min,
  mix,
  reference,
  renderGroup,
  shadowPositionWorld,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  modelQuadrants,
  nextRingDue,
  RING_EDGE_FROM,
  RING_EDGE_TO,
  RING_PCF_RADIUS,
  ringBias,
  ringDeadZone,
  ringDepth,
  ringFade,
  ringFocus,
  ringForNearBand,
  ringTouches,
  SHADOW_RING_HALVES,
  SHADOW_RINGS,
  snapToTexels,
} from "@/lib/city/shadow-rings";
import type { RingArea, RingPoint, RingView } from "@/lib/city/shadow-rings";
import type { F, I, V3 } from "./shader-chunks";
import { ShadowNodeBase } from "./shadow-node-api";
import type { FrameLike, ShadowTargets, StackBuilder } from "./shadow-node-api";
import { castsInRing } from "./three-utils";

/** What a shadow lookup reads of the rings: one set for every material and
 *  post pass, in the render group, so that no drawable holds a copy. */
export interface ShadowRingNodes {
  /** world → the ring's map (0…1 in x, y; depth as three's lookup takes it) */
  matrix: UniformNode<"mat4", Matrix4>[];
  /** 0…1: how much of the ring shows */
  fade: UniformNode<"float", number>[];
  /** the depth bias three's lookup would add, per ring */
  bias: UniformNode<"float", number>[];
}

/** After this long without a draw (ms) a ring's request no longer counts as
 *  work in hand. */
const RING_STALL_MS = 5000;

/** Every ring shows (Modell). */
const ALL_RINGS: readonly number[] = SHADOW_RING_HALVES.map(() => 1);

/** The finest ring at a point, and the next one out. */
export interface RingLookup {
  /** the ring's map coordinates, its depth with the bias */
  at: V3;
  /** its layer */
  layer: I;
  /** 0…1: how much of what shows here it gives */
  weight: F;
  /** the same for the next ring out, which gives the rest */
  nextAt: V3;
  nextLayer: I;
  nextWeight: F;
}

/** `keep` holds a node for a branch to read (`.toVar()` inside a Fn; a TSL
 *  arm would otherwise build it again). */
type Keep = <T extends F | V3 | I>(node: T) => T;
const asIs: Keep = (node) => node;

/**
 * Which rings a world point reads. Written with `mix` and `step` throughout:
 * a graph with no branch of its own, for every material and post pass.
 */
export function ringLookup(
  world: V3,
  rings: ShadowRingNodes,
  reversed: boolean,
  keep: Keep = asIs
): RingLookup {
  const at: V3[] = [];
  const weight: F[] = [];
  for (let i = 0; i < SHADOW_RINGS; i += 1) {
    const s = rings.matrix[i].mul(vec4(world, 1));
    const uv = vec2(s.x, float(1).sub(s.y));
    const edge = min(
      min(uv.x, float(1).sub(uv.x)),
      min(uv.y, float(1).sub(uv.y))
    );
    const inDepth = reversed ? step(0, s.z) : step(s.z, 1);
    weight.push(
      keep(
        smoothstep(RING_EDGE_FROM, RING_EDGE_TO, edge)
          .mul(inDepth)
          .mul(rings.fade[i]) as F
      )
    );
    at.push(
      keep(
        vec3(
          uv,
          reversed ? s.z.sub(rings.bias[i]) : s.z.add(rings.bias[i])
        ) as V3
      )
    );
  }
  // from the widest in: a ring that reaches this point takes it over, and what
  // gives the rest is the strongest of those further out. In Modell two tiles'
  // bands meet where a third holds at full strength: not always ring i + 1.
  const last = SHADOW_RINGS - 1;
  let layer: F = float(last);
  let chosen = at[last];
  let w = weight[last];
  let nextLayer: F = float(last);
  let nextAt = at[last];
  let nextW: F = float(0);
  let bestLayer: F = float(last);
  let bestAt = at[last];
  let bestW = weight[last];
  for (let i = last - 1; i >= 0; i -= 1) {
    const here = step(1e-3, weight[i]);
    nextLayer = mix(nextLayer, bestLayer, here);
    nextAt = mix(nextAt, bestAt, here);
    nextW = mix(nextW, bestW, here);
    layer = mix(layer, float(i), here);
    chosen = mix(chosen, at[i], here);
    w = mix(w, weight[i], here);
    const stronger = step(bestW, weight[i]);
    bestLayer = mix(bestLayer, float(i), stronger);
    bestAt = mix(bestAt, at[i], stronger);
    bestW = mix(bestW, weight[i], stronger);
  }
  return {
    at: keep(chosen),
    layer: keep(int(layer.add(0.5))),
    weight: keep(w),
    nextAt: keep(nextAt),
    nextLayer: keep(int(nextLayer.add(0.5))),
    nextWeight: keep(nextW),
  };
}

/** A ring's state between its redraws. */
interface Ring {
  /** how far its depth must reach, as a half-size */
  depthHalf: number;
  /** the centre and half-size it was last drawn with */
  anchor: RingPoint | null;
  anchorHalf: number;
  /** when it was first asked to redraw (ms), null when it need not */
  dirtySince: number | null;
  drawnAt: number;
  /** where and how large it wants to be */
  focus: RingPoint;
  half: number;
  /** drawn since it last showed: else it holds nothing worth showing */
  fresh: boolean;
}

/** The rings as the rig drives them. */
export interface SunRings {
  /** Whether a ring still waits for a redraw that is coming: with nothing lit
   *  in the frame three draws none, and a ring asked long ago waits for good. */
  anyDirty: () => boolean;
  /** Frees the map. */
  dispose: () => void;
  /** Whether a ring may be drawn in the next frame. */
  due: () => boolean;
  /** Asks every ring to redraw, or those `area` can fall on, or the `finest`
   *  few: a change only they can show. */
  invalidate: (area?: RingArea, finest?: number) => void;
  /** The nodes a shadow lookup reads. */
  nodes: ShadowRingNodes;
  /** The map's depth, null until the first lit material made it. */
  depth: () => DepthTexture | null;
  /** The widest ring on the ground: its centre in the data frame (x east,
   *  y north: world x, −z) and its half-size (z, m). */
  reach: Vector3;
  /** The rings for a parallel view of the ground round `centre`. */
  setFootprint: (centre: RingPoint, radius: number) => void;
  /** The sun moved (surface → sun, unit). */
  setSun: (sun: Vector3) => void;
  /** The rings for the walking or flying camera. */
  setView: (view: RingView) => void;
}

/** A depth array of one layer a ring, comparing as the map does; a stand-in
 *  for the map must match it to be swapped for it without a build. */
export function ringDepthTexture(
  width: number,
  height: number,
  reversed: boolean
): DepthTexture {
  const texture = new DepthTexture(
    width,
    height,
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
  texture.name = "ShadowRingsDepth";
  texture.compareFunction = reversed ? GreaterEqualCompare : LessEqualCompare;
  return texture;
}

/** The rings' uniforms, in the render group. */
function ringUniforms(): ShadowRingNodes {
  const nodes: ShadowRingNodes = { matrix: [], fade: [], bias: [] };
  for (let i = 0; i < SHADOW_RINGS; i += 1) {
    nodes.matrix.push(uniform(new Matrix4()).setGroup(renderGroup));
    nodes.fade.push(uniform(0).setGroup(renderGroup));
    nodes.bias.push(uniform(0).setGroup(renderGroup));
  }
  return nodes;
}

/**
 * The map: three's shadow node, its target a depth array with no colour beside
 * it (`count: 0`, as three's tiled shadows draw theirs; three's own map keeps
 * a colour as large again that only coloured shadows read), its lookup the
 * rings', its draw one layer at a time. Installed as the light's
 * `shadow.shadowNode`, what three's own CSM plugs in through, so nothing of
 * three is patched (ADR 0027).
 */
class RingShadowNode extends ShadowNodeBase {
  /** the map's depth, once the first lit material made it */
  depth: DepthTexture | null = null;
  readonly #nodes: ShadowRingNodes;
  readonly #drawNext: () => { every: boolean; index: number } | null;

  constructor(
    light: Light,
    shadow: LightShadow,
    nodes: ShadowRingNodes,
    drawNext: () => { every: boolean; index: number } | null
  ) {
    super(light, shadow);
    this.#nodes = nodes;
    this.#drawNext = drawNext;
  }

  override setupRenderTarget(
    shadow: LightShadow,
    builder: NodeBuilder
  ): ShadowTargets {
    const { width, height } = shadow.mapSize;
    const depthTexture = ringDepthTexture(
      width,
      height,
      builder.renderer.reversedDepthBuffer
    );
    const shadowMap = new RenderTarget(width, height, {
      count: 0,
      depth: SHADOW_RINGS,
      useArrayDepthTexture: true,
    });
    shadowMap.depthTexture = depthTexture;
    this.depth = depthTexture;
    return { shadowMap, depthTexture };
  }

  /** three's setup makes the target and readies its camera for the backend's
   *  depth (what it builds of a lookup is left unused); the lookup is ours. */
  override setupShadow(builder: NodeBuilder): Node {
    // in a stack of its own, dropped: `toVar` writes its lookup into the stack
    // it runs in, which would put a second filter in the first lit material
    (builder as StackBuilder).addStack();
    super.setupShadow(builder);
    (builder as StackBuilder).removeStack();
    const { renderer } = builder;
    const { shadow } = this;
    const nodes = this.#nodes;
    const reversed = renderer.reversedDepthBuffer;
    const filter = this.getShadowFilterFn(renderer.shadowMap.type);
    const { depth: depthTexture } = this;
    if (!depthTexture) {
      throw new Error("three's setup made no shadow map");
    }
    const intensity = reference("intensity", "float", shadow).setGroup(
      renderGroup
    );
    return Fn(() => {
      const hit = ringLookup(
        shadowPositionWorld as unknown as V3,
        nodes,
        reversed,
        // reason: toVar keeps a node's type; the union of the three loses it
        (node) => node.toVar() as unknown as typeof node
      );
      const lit = float(1).toVar();
      // most of what is on screen lies well inside one ring: one lookup
      If(
        hit.weight.lessThan(0.999).and(hit.nextWeight.greaterThan(1e-3)),
        () => {
          lit.assign(
            mix(
              1,
              filter({
                depthLayer: hit.nextLayer,
                depthTexture,
                shadow,
                shadowCoord: hit.nextAt,
              }),
              hit.nextWeight
            )
          );
        }
      );
      If(hit.weight.greaterThan(1e-3), () => {
        lit.assign(
          mix(
            lit,
            filter({
              depthLayer: hit.layer,
              depthTexture,
              shadow,
              shadowCoord: hit.at,
            }),
            hit.weight
          )
        );
      });
      return mix(1, lit, intensity);
    })();
  }

  override renderShadow(frame: FrameLike): void {
    const { renderer, scene } = frame;
    const ring = this.#drawNext();
    const map = this.shadowMap;
    if (!(ring && map)) {
      return;
    }
    const { shadow } = this;
    map.setSize(shadow.mapSize.width, shadow.mapSize.height, SHADOW_RINGS);
    renderer.setRenderTarget(map, ring.index);
    const drawn = renderer.getRenderObjectFunction();
    if (!ring.every && drawn) {
      renderer.setRenderObjectFunction((object: Object3D, ...rest) => {
        if (castsInRing(object, ring.index)) {
          drawn(object, ...rest);
        }
      });
    }
    renderer.render(scene, shadow.camera);
    renderer.setRenderObjectFunction(drawn);
  }
}

/** The rings for `light`, each of `mapEdge`² texels. */
export function createSunRings(
  light: DirectionalLight,
  mapEdge: number
): SunRings {
  const { shadow } = light;
  const { camera } = shadow;
  const nodes = ringUniforms();
  const sun = new Vector3(0, 1, 0);
  const reach = new Vector3();
  const rings: Ring[] = SHADOW_RING_HALVES.map((half) => ({
    anchor: null,
    anchorHalf: half,
    // the map holds nothing yet
    dirtySince: 0,
    drawnAt: Number.NEGATIVE_INFINITY,
    focus: { x: 0, y: 0, z: 0 },
    fresh: false,
    half,
    depthHalf: half,
  }));
  let wanted: readonly number[] = rings.map(() => 1);
  // kept between frames: this runs in every one of them
  const viewWant: number[] = rings.map(() => 1);
  // the baked horizon's near band stays off inside this ring and comes on past
  // it: the widest whose texels can still draw what that band knows
  const reachRing = ringForNearBand(mapEdge);
  // Modell's rings tile one square, and it says what they reach
  let tiled = false;
  let lastDraw = Number.NEGATIVE_INFINITY;
  // what they were last fitted to: a still picture asks nothing new
  const fitted = { radius: 0, x: 0, y: 0, z: 0 };

  const ask = (ring: Ring, now: number) => {
    ring.dirtySince ??= now;
  };

  /** Asks `ring` to redraw if what it wants left what it holds. */
  const wantRing = (ring: Ring, half: number, now: number) => {
    const { focus } = ring;
    ring.half = half;
    const { anchor } = ring;
    if (
      !anchor ||
      half !== ring.anchorHalf ||
      Math.hypot(focus.x - anchor.x, focus.y - anchor.y, focus.z - anchor.z) >=
        ringDeadZone(half, tiled)
    ) {
      ask(ring, now);
    }
  };

  /** How much each ring shows: nothing of one not drawn since it last did. */
  const showRings = (want: readonly number[], now: number) => {
    wanted = want;
    for (let i = 0; i < SHADOW_RINGS; i += 1) {
      const ring = rings[i];
      if (want[i] <= 0) {
        ring.fresh = false;
        ring.dirtySince = null;
      } else if (!ring.fresh) {
        ask(ring, now);
      }
      nodes.fade[i].value = ring.fresh ? want[i] : 0;
    }
    // a faded ring reaches nothing: the near band comes on everywhere
    if (!tiled && want[reachRing] <= 0) {
      reach.z = 0;
    }
  };

  /** The rings as Modell's tiles of the square round `centre`. */
  const fitFootprint = (centre: RingPoint, radius: number, now: number) => {
    const {
      depthHalf,
      focus,
      half,
      reach: holds,
    } = modelQuadrants(centre, radius, sun);
    for (let i = 0; i < SHADOW_RINGS; i += 1) {
      rings[i].depthHalf = depthHalf;
      rings[i].focus = focus[i];
      wantRing(rings[i], half, now);
    }
    reach.set(centre.x, -centre.z, holds);
  };

  /** Asks every ring that shows, and that `which` picks, to redraw. */
  const askShown = (which?: (ring: Ring, i: number) => boolean) => {
    const now = performance.now();
    for (let i = 0; i < SHADOW_RINGS; i += 1) {
      if (wanted[i] > 0 && (!which || which(rings[i], i))) {
        ask(rings[i], now);
      }
    }
  };

  /** Points the camera and the light at ring `index` and records its matrix:
   *  a ring's matrix changes only here, as it is drawn. */
  const placeRing = (index: number) => {
    const ring = rings[index];
    const { half } = ring;
    const centre = snapToTexels(ring.focus, sun, (half * 2) / mapEdge);
    const { down, up } = ringDepth(ring.depthHalf, sun.y);
    const distance = up + 1;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 1;
    camera.far = distance + down;
    camera.updateProjectionMatrix();
    light.target.position.set(centre.x, centre.y, centre.z);
    light.position.copy(light.target.position).addScaledVector(sun, distance);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    shadow.updateMatrices(light);
    nodes.matrix[index].value.copy(shadow.matrix);
    nodes.bias[index].value = ringBias(half, mapEdge, camera.far - camera.near);
    ring.anchor ??= { x: 0, y: 0, z: 0 };
    ring.anchor.x = ring.focus.x;
    ring.anchor.y = ring.focus.y;
    ring.anchor.z = ring.focus.z;
    ring.anchorHalf = half;
    ring.fresh = true;
    nodes.fade[index].value = wanted[index];
    if (index === reachRing && !tiled) {
      reach.set(centre.x, -centre.z, half);
    }
  };

  const drawNext = () => {
    const now = performance.now();
    const index = nextRingDue(rings, now, !tiled);
    if (index < 0) {
      return null;
    }
    const ring = rings[index];
    placeRing(index);
    ring.dirtySince = null;
    ring.drawnAt = now;
    lastDraw = now;
    return { every: tiled, index };
  };

  shadow.mapSize.set(mapEdge, mapEdge);
  shadow.radius = RING_PCF_RADIUS;
  shadow.normalBias = 0;
  const node = new RingShadowNode(light, shadow, nodes, drawNext);
  // reason: `shadowNode` is read by three's AnalyticLightNode but missing
  // from LightShadow's @types.
  (shadow as LightShadow & { shadowNode?: Node }).shadowNode = node;

  return {
    anyDirty: () => {
      const now = performance.now();
      return rings.some(
        (ring) =>
          ring.dirtySince !== null &&
          now - Math.max(ring.dirtySince, lastDraw) < RING_STALL_MS
      );
    },
    depth: () => node.depth,
    due: () => nextRingDue(rings, performance.now(), !tiled) >= 0,
    dispose: () => {
      node.dispose();
    },
    invalidate: (area, finest = SHADOW_RINGS) => {
      askShown(
        (ring, i) =>
          (tiled || i < finest) &&
          (!area ||
            !ring.anchor ||
            ringTouches(ring.anchor, ring.anchorHalf, area, sun))
      );
    },
    nodes,
    reach,
    setFootprint: (centre, radius) => {
      const now = performance.now();
      if (
        !tiled ||
        fitted.radius !== radius ||
        fitted.x !== centre.x ||
        fitted.y !== centre.y ||
        fitted.z !== centre.z
      ) {
        tiled = true;
        fitted.radius = radius;
        fitted.x = centre.x;
        fitted.y = centre.y;
        fitted.z = centre.z;
        fitFootprint(centre, radius, now);
      }
      showRings(ALL_RINGS, now);
    },
    setSun: (next) => {
      sun.copy(next);
      // a parallel view's tiles lie along the light's axes
      fitted.radius = 0;
      // the light turns at once; each ring keeps the matrix it was drawn with
      light.position.copy(light.target.position).addScaledVector(sun, 1);
      light.updateMatrixWorld();
      askShown();
    },
    setView: (view) => {
      const now = performance.now();
      tiled = false;
      for (let i = 0; i < SHADOW_RINGS; i += 1) {
        const half = SHADOW_RING_HALVES[i];
        const fade = ringFade(i, view.height);
        viewWant[i] = fade;
        rings[i].depthHalf = half;
        if (fade > 0) {
          ringFocus(half, view, rings[i].focus);
          wantRing(rings[i], half, now);
        }
      }
      showRings(viewWant, now);
    },
  };
}
