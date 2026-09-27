import {
  LinearSRGBColorSpace,
  NoToneMapping,
  type BufferGeometry,
  type Object3D,
  type PerspectiveCamera,
  SRGBColorSpace,
  type Scene,
  Vector3,
} from "three";
import { dof } from "three/examples/jsm/tsl/display/DepthOfFieldNode.js";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import {
  clamp,
  dot,
  float,
  floor,
  fract,
  length,
  min,
  mix,
  nodeObject,
  pass,
  renderOutput,
  screenCoordinate,
  screenUV,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type Node, RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { type FocusMode, LOOK_DEFAULTS } from "@/lib/city/look-controls";
import {
  RENDER_STYLE_BY_ID,
  RENDER_STYLES,
  type RenderStyleDef,
} from "@/lib/city/render-style";
import { guardNodeRenderer } from "./node-render-guard";
import { createPaperScene } from "./paper-scene";
import { installSharedInstancing } from "./shared-instancing";
import { createStyleDressing } from "./style-dressing";
import { createNodeStylize } from "./stylize-node";
import type { PostStack } from "./post-stack";

/** GTAO radius in metres (view space); N8AO ran 12 m of a different algorithm. */
const AO_RADIUS_M = 6;
/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;
/**
 * Same lens model as post-stack.ts: the sharp band scales with distance,
 * generous on purpose (FOCUS_RANGE_* there), and a soft bokeh.
 */
const FOCUS_RANGE_FACTOR = 1.6;
const FOCUS_RANGE_MIN = 45;
const FOCUS_RANGE_MAX = 3000;
/** post-stack.ts BOKEH_SCALE: a soft hint of lens, never a smear. */
const BOKEH_SCALE = 0.5;
function focusRangeFor(distance: number): number {
  return Math.min(
    Math.max(distance * FOCUS_RANGE_FACTOR, FOCUS_RANGE_MIN),
    FOCUS_RANGE_MAX
  );
}
/** Depth grading reaches full strength at this view distance (m). */
const GRADE_DISTANCE_M = 800;

/** The paper-grain hash of paper-grain-effect.ts. */
function hash21(p: Node<"vec2">): Node<"float"> {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

type Drawable = Object3D & { geometry?: BufferGeometry };

/** Drawables compiled side by side (PostStack.compile). */
const COMPILE_LANES = 4;

interface RenderContexts {
  get: (renderTarget: unknown, mrt: unknown, callDepth?: number) => unknown;
}

/**
 * Every drawable under `root`, and a set that learns which of them lose
 * their geometry (a tile unloaded, a dressing thrown away) while the
 * compile still runs.
 */
function drawables(root: Object3D): {
  gone: WeakSet<BufferGeometry>;
  list: Drawable[];
  stop: () => void;
} {
  const list: Drawable[] = [];
  root.traverse((object) => {
    const o = object as Drawable & {
      isLine?: boolean;
      isMesh?: boolean;
      isPoints?: boolean;
      isSprite?: boolean;
    };
    if (o.geometry && (o.isMesh || o.isLine || o.isPoints || o.isSprite)) {
      list.push(o);
    }
  });
  const gone = new WeakSet<BufferGeometry>();
  const onDispose = (event: { target: BufferGeometry }) => {
    gone.add(event.target);
  };
  const geometries = new Set(list.map((o) => o.geometry as BufferGeometry));
  for (const geometry of geometries) {
    geometry.addEventListener("dispose", onDispose);
  }
  return {
    gone,
    list,
    stop: () => {
      for (const geometry of geometries) {
        geometry.removeEventListener("dispose", onDispose);
      }
    },
  };
}

/**
 * SPIKE (plan 020): the post stack of post-stack.ts on three's node pipeline —
 * scene pass with a normal MRT → GTAO (half res) × contact slider →
 * DoF (`DepthOfFieldNode`, crosshair autofocus, dropped while moving) → the
 * picture style (stylize-node.ts; its own pipelines, off in the default
 * style) → SMAA → depth grading (warm near, cool + desaturated far) →
 * vignette → paper grain.
 * Tone mapping and sRGB are the pipeline's output transform. Everything is a
 * few lines of TSL; `postprocessing`, `n8ao` and the two custom effect
 * classes have no counterpart here.
 */
export function createNodePostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  /** an object skipped by a frame is ready: the shadow map must catch up */
  onLate: () => void
): PostStack {
  const guard = guardNodeRenderer(renderer, onLate);
  installSharedInstancing(renderer);
  // Two pipelines, with and without DoF, both built once: DoF drops while
  // the camera moves, and swapping one pipeline's output node would
  // re-translate the whole post graph (GTAO, DoF, SMAA, grading) on the main
  // thread every time a flight starts or stops.
  const withDofPipeline = new RenderPipeline(renderer);
  const plainPipeline = new RenderPipeline(renderer);
  // sRGB is the last node of the chain, not the renderer's: the renderer
  // stays linear and untonemapped, which is the state three renders the
  // scene pass in anyway. No tone mapping: today's WebGL path has none
  // either — three tone-maps only direct-to-screen renders, the composer
  // renders to a target and postprocessing's passes are toneMapped: false,
  // so renderer.toneMapping = ACES there is inert. ACES here washed the
  // clay out. With no MRT either (GTAO
  // reconstructs normals from depth), a shader compiled ahead of time
  // (compile below) is the very one the pass uses.
  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = LinearSRGBColorSpace;
  withDofPipeline.outputColorTransform = false;
  plainPipeline.outputColorTransform = false;
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");
  const viewZ = scenePass.getViewZNode();

  // reason: GTAONode takes null to reconstruct normals from depth; the
  // @types signature does not say so.
  const aoPass = ao(depth, null as never, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = AO_RADIUS_M;
  const contact = uniform(LOOK_DEFAULTS.contact);
  const occlusion = mix(float(1), aoPass.getTextureNode().r, contact);
  const lit = vec4(color.rgb.mul(occlusion), color.a);

  const focusDistance = uniform(HYPERFOCAL_M);
  const focusRange = uniform(focusRangeFor(HYPERFOCAL_M));
  const focused = nodeObject(
    dof(lit, viewZ, focusDistance, focusRange, uniform(BOKEH_SCALE))
  ) as unknown as Node<"vec4">;

  // The picture styles (lib/city/render-style.ts): the style pass
  // (stylize-node.ts) before SMAA, as in post-stack.ts, and the scene's
  // swaps (paper-scene.ts, style-dressing.ts) around each frame.
  let style: RenderStyleDef = RENDER_STYLE_BY_ID[LOOK_DEFAULTS.style];
  const stylize = createNodeStylize(viewZ, scene, camera, () =>
    renderer.getPixelRatio()
  );
  const paperScene = createPaperScene(scene);
  const styleDressing = createStyleDressing(scene);

  const grading = uniform(LOOK_DEFAULTS.grading);
  const grain = uniform(LOOK_DEFAULTS.grain);
  const film = uniform(0);
  const vignetteOffset = uniform(style.vignette.offset);
  const vignetteDarkness = uniform(style.vignette.darkness);
  /** The finish after AO/DoF; `mode` is the picture style's shader mode
   *  (0 = none). */
  const finish = (input: Node<"vec4">, mode: number): Node<"vec4"> => {
    // The style pass reads its neighbours, so it draws the colour to a
    // texture first (one more target, paid only by the styled pipelines).
    const drawn = mode > 0 ? stylize.apply(input, mode) : input;
    // reason: the effect nodes' types don't carry their vec4 output.
    const aa = nodeObject(smaa(drawn)) as unknown as Node<"vec4">;
    const t = smoothstep(
      0.04,
      1,
      clamp(viewZ.negate().div(GRADE_DISTANCE_M), 0, 1)
    ).mul(grading);
    const tinted = aa.rgb.mul(
      mix(vec3(1.045, 1, 0.94), vec3(0.91, 0.965, 1.06), t)
    );
    const luma = dot(tinted, vec3(0.2126, 0.7152, 0.0722));
    const graded = mix(tinted, vec3(luma), t.mul(0.3));
    // postprocessing's VignetteEffect (default technique), the style's
    // offset and darkness.
    const d = length(screenUV.sub(0.5));
    const vignette = smoothstep(
      0.8,
      vignetteOffset.mul(0.799),
      d.mul(vignetteDarkness.add(vignetteOffset))
    );
    const vignetted = graded.mul(vignette);
    // paper-grain-effect.ts: the static sheet, or film grain (a new sheet
    // 24 times a second, no fibers, strongest in the mid-tones).
    const cell = floor(screenCoordinate.xy.div(1.6));
    const seed = vec2(floor(time.mul(24)).mul(7.31), 0).mul(film);
    const speckle = hash21(cell.add(seed))
      .mul(0.65)
      .add(hash21(cell.mul(0.31).add(17).add(seed)).mul(0.35));
    const fiber = hash21(vec2(cell.y.mul(0.713), 3.7))
      .sub(0.5)
      .mul(0.045)
      .mul(float(1).sub(film));
    const vl = dot(vignetted, vec3(0.2126, 0.7152, 0.0722));
    const midtones = mix(
      1,
      float(1).sub(min(vl, 1)).mul(vl).mul(2.6).add(0.35),
      film
    );
    const paper = float(1).add(
      speckle.sub(0.5).mul(0.13).mul(midtones).add(fiber).mul(grain)
    );
    return vec4(vignetted.mul(paper), aa.a);
  };
  const output = (node: Node<"vec4">): Node<"vec4"> =>
    renderOutput(node, NoToneMapping, SRGBColorSpace);
  withDofPipeline.outputNode = output(finish(focused, 0));
  plainPipeline.outputNode = output(finish(lit, 0));
  // A pipeline per style (and DoF), each built on first use (warmStyles, or
  // the first switch to the style): the default style never pays for the
  // style pass, and each style's shader holds its own treatment only.
  const styledPipelines = new Map<string, RenderPipeline>();
  const styledPipeline = (mode: number, withDof: boolean): RenderPipeline => {
    const key = `${mode}:${withDof}`;
    let p = styledPipelines.get(key);
    if (!p) {
      p = new RenderPipeline(renderer);
      p.outputColorTransform = false;
      p.outputNode = output(finish(withDof ? focused : lit, mode));
      styledPipelines.set(key, p);
    }
    return p;
  };

  let dofWanted = LOOK_DEFAULTS.dof;
  let regressed = false;
  let pipeline = plainPipeline;
  // Pipelines to render once ahead of their first real frame, so their
  // graphs build under the load screen or while the browser is idle.
  const warmQueue: RenderPipeline[] = [plainPipeline, withDofPipeline];
  const applyGating = () => {
    const withDof = dofWanted && style.allowDof && !regressed;
    pipeline =
      style.shaderMode > 0
        ? styledPipeline(style.shaderMode, withDof)
        : withDof
          ? withDofPipeline
          : plainPipeline;
  };
  applyGating();

  // The sliders' raw values; the style weights them on the way in, so a
  // style switch re-applies them without the store changing (post-stack.ts).
  const raw = {
    grading: LOOK_DEFAULTS.grading,
    grain: LOOK_DEFAULTS.grain,
    ink: LOOK_DEFAULTS.ink,
  };
  const applyStyleWeights = () => {
    grading.value = Math.min(Math.max(raw.grading * style.gradingWeight, 0), 1);
    grain.value = Math.min(Math.max(raw.grain * style.grainWeight, 0), 2);
    film.value = style.grainAnimated ? 1 : 0;
    stylize.setInk(raw.ink * style.inkWeight);
    vignetteOffset.value = style.vignette.offset;
    vignetteDarkness.value = style.vignette.darkness;
  };
  applyStyleWeights();

  let focusMode: FocusMode = LOOK_DEFAULTS.focusMode;
  let manualDistance = LOOK_DEFAULTS.focusDistanceM;
  const focusPoint = new Vector3(0, 0, -HYPERFOCAL_M);
  const inView = new Vector3();
  const updateFocus = () => {
    let d = manualDistance;
    if (focusMode === "auto") {
      inView.copy(focusPoint).applyMatrix4(camera.matrixWorldInverse);
      d = Math.max(1, -inView.z);
    }
    focusDistance.value = d;
    focusRange.value = focusRangeFor(d);
  };

  // A WebGPU pipeline is specific to the attachments it draws into: compile
  // against the scene pass's target, which compileAsync reads synchronously
  // (the shader state it reads later is the renderer's, identical above).
  // compileAsync walks a tree the way a frame does, skipping what is hidden
  // or outside the view, so each drawable is compiled on its own, shown
  // and unculled for the call: whatever the camera did not see yet would
  // otherwise build inside the frame that first shows it. One at a time,
  // so a drawable whose tile left meanwhile is skipped — compiling it
  // would re-create the GPU buffers of a disposed geometry, and nothing
  // would free them again.
  // three keys a node build by its render context too (RenderObject
  // getMaterialCacheKey), and a context by its target and the call depth it
  // is drawn at. The scene pass is drawn inside the pipeline's other draws,
  // at a depth that depends on which pass asks for it first — not the same
  // in the two pipelines — and compileAsync asks for depth 0. So what the
  // compile built was never the build a frame looked up, and every switch
  // between the pipelines (DoF drops while the camera moves) built the
  // whole scene again inside frames: a long stall, or with the guard, the
  // scene missing in patches. The scene pass's target is only ever drawn
  // once per frame, never nested in itself, so one context serves it at
  // every depth.
  const contexts = (renderer as unknown as { _renderContexts: RenderContexts })
    ._renderContexts;
  const contextAt = contexts.get.bind(contexts);
  // The same holds for the sun's shadow map, drawn inside the scene pass.
  const oncePerFrame = (target: unknown) =>
    target === scenePass.renderTarget ||
    (target as { texture?: { name?: string } } | null)?.texture?.name ===
      "ShadowMap";
  contexts.get = (target, mrt, callDepth) =>
    contextAt(target, mrt, oncePerFrame(target) ? 0 : callDepth);
  const compileOne = (object: Object3D): Promise<void> => {
    const target = renderer.getRenderTarget();
    const { visible, frustumCulled } = object;
    object.visible = true;
    object.frustumCulled = false;
    renderer.setRenderTarget(scenePass.renderTarget);
    try {
      return renderer.compileAsync(object, camera, scene);
    } finally {
      renderer.setRenderTarget(target);
      object.visible = visible;
      object.frustumCulled = frustumCulled;
    }
  };
  // What was compiled already (a tile, before the whole scene's compile at
  // boot walks it again): once is enough for a drawable and its material.
  const compiled = new WeakMap<Object3D, unknown>();

  /** Swaps the scene into `def`'s look for one render; returns the restore. */
  const dressFor = (def: RenderStyleDef): (() => void) => {
    const dressed =
      def.crowns || def.lampCones
        ? styleDressing.begin({ crowns: def.crowns, lampCones: def.lampCones })
        : null;
    const restore = def.paperScene ? paperScene.begin() : null;
    return () => {
      restore?.();
      dressed?.();
    };
  };
  // The styles' scene builds (the Papier material on every drawable, the
  // style crowns, the lamp cones), made off the frame: the whole scene is
  // compiled once in each style that swaps it. compileAsync reads the swap
  // in its synchronous half, so it is undone as soon as the call returns.
  const compileStyledScenes = async (): Promise<void> => {
    for (const def of RENDER_STYLES) {
      if (!(def.paperScene || def.crowns || def.lampCones)) {
        continue;
      }
      const undo = dressFor(def);
      let done: Promise<void>;
      const target = renderer.getRenderTarget();
      renderer.setRenderTarget(scenePass.renderTarget);
      try {
        done = renderer.compileAsync(scene, camera);
      } finally {
        renderer.setRenderTarget(target);
        undo();
      }
      await done;
    }
  };
  let stylesWarm: Promise<void> | null = null;
  return {
    compile: async (object) => {
      const { gone, list, stop } = drawables(object);
      let next = 0;
      // A few at a time: a dressing is hundreds of drawables, and each
      // compile yields to the main thread between its steps.
      const worker = async () => {
        while (next < list.length) {
          const drawable = list[next++];
          const { material } = drawable as Drawable & { material?: unknown };
          if (
            compiled.get(drawable) === material ||
            gone.has(drawable.geometry as BufferGeometry)
          ) {
            continue;
          }
          compiled.set(drawable, material);
          await compileOne(drawable);
        }
      };
      try {
        await Promise.all(Array.from({ length: COMPILE_LANES }, worker));
      } finally {
        stop();
      }
    },
    render: () => {
      guard.beginFrame();
      try {
        updateFocus();
        // Build the other graphs up front (the first frames are under the
        // load screen; the styled pair when warmStyles asks), so the first
        // toggle costs nothing.
        for (const p of warmQueue.splice(0)) {
          if (p !== pipeline) {
            p.render();
          }
        }
        // A style's scene dressing and the Papier material are swapped in
        // for this frame only, and out right after (post-stack.ts).
        const undo = dressFor(style);
        try {
          pipeline.render();
        } finally {
          undo();
        }
      } finally {
        guard.endFrame();
      }
    },
    warmStyles: () => {
      stylesWarm ??= (async () => {
        for (const def of RENDER_STYLES) {
          if (def.shaderMode > 0) {
            warmQueue.push(styledPipeline(def.shaderMode, false));
            if (def.allowDof) {
              warmQueue.push(styledPipeline(def.shaderMode, true));
            }
          }
        }
        await compileStyledScenes();
      })().catch(() => undefined);
      return stylesWarm;
    },
    sceneChanged: () => {
      paperScene.sceneChanged();
      styleDressing.sceneChanged();
    },
    setSunAltitude: (altitudeDeg) => stylize.setSunAltitude(altitudeDeg),
    getFocusInfo: () => ({
      focusDistance: focusDistance.value,
      focusRange: focusRange.value,
      bokehScale: BOKEH_SCALE,
    }),
    setSize: () => undefined, // the pipeline follows the renderer's size
    applyLook: (look) => {
      contact.value = look.contact;
      raw.grading = look.grading;
      raw.grain = look.grain;
      raw.ink = look.ink;
      style = RENDER_STYLE_BY_ID[look.style];
      applyStyleWeights();
      dofWanted = look.dof;
      focusMode = look.focusMode;
      manualDistance = Math.max(1, look.focusDistanceM);
      applyGating();
    },
    setRegressed: (on) => {
      regressed = on;
      applyGating();
    },
    setFocusTarget: (point) => {
      if (focusMode === "auto" && point) {
        focusPoint.copy(point);
      }
    },
    dispose: () => {
      paperScene.dispose();
      styleDressing.dispose();
      withDofPipeline.dispose();
      plainPipeline.dispose();
      for (const p of styledPipelines.values()) {
        p.dispose();
      }
    },
  };
}
