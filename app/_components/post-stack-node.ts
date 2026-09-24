import {
  LinearSRGBColorSpace,
  NoToneMapping,
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
  mix,
  nodeObject,
  pass,
  renderOutput,
  screenCoordinate,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { type Node, RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { type FocusMode, LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { PostStack } from "./post-stack";

/** GTAO radius in metres (view space); N8AO ran 12 m of a different algorithm. */
const AO_RADIUS_M = 6;
/** Initial focus distance before the first crosshair raycast lands. */
const HYPERFOCAL_M = 600;
/** Same lens model as post-stack.ts: the sharp band scales with distance. */
function focusRangeFor(distance: number): number {
  return Math.min(Math.max(distance * 0.7, 12), 2500);
}
/** Depth grading reaches full strength at this view distance (m). */
const GRADE_DISTANCE_M = 800;

/** The paper-grain hash of paper-grain-effect.ts. */
function hash21(p: Node<"vec2">): Node<"float"> {
  const q = fract(p.mul(vec2(123.34, 456.21)));
  const r = q.add(dot(q, q.add(45.32)));
  return fract(r.x.mul(r.y));
}

/**
 * SPIKE (plan 020): the post stack of post-stack.ts on three's node pipeline —
 * scene pass with a normal MRT → GTAO (half res) × contact slider →
 * DoF (`DepthOfFieldNode`, crosshair autofocus, dropped while moving) → SMAA →
 * depth grading (warm near, cool + desaturated far) → vignette → paper grain.
 * Tone mapping and sRGB are the pipeline's output transform. Everything is a
 * few lines of TSL; `postprocessing`, `n8ao` and the two custom effect
 * classes have no counterpart here.
 */
export function createNodePostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera
): PostStack {
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
    dof(lit, viewZ, focusDistance, focusRange, uniform(1))
  ) as unknown as Node<"vec4">;

  const grading = uniform(LOOK_DEFAULTS.grading);
  const grain = uniform(LOOK_DEFAULTS.grain);
  const finish = (input: Node<"vec4">): Node<"vec4"> => {
    // reason: the effect nodes' types don't carry their vec4 output.
    const aa = nodeObject(smaa(input)) as unknown as Node<"vec4">;
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
    const edge = length(screenUV.sub(0.5)).mul(2);
    const vignette = mix(float(1), float(0.5), smoothstep(0.28, 1.4, edge));
    const cell = floor(screenCoordinate.xy.div(1.6));
    const speckle = hash21(cell)
      .mul(0.65)
      .add(hash21(cell.mul(0.31).add(17)).mul(0.35));
    const fiber = hash21(vec2(cell.y.mul(0.713), 3.7))
      .sub(0.5)
      .mul(0.045);
    const paper = float(1).add(
      speckle.sub(0.5).mul(0.13).add(fiber).mul(grain)
    );
    return vec4(graded.mul(vignette).mul(paper), aa.a);
  };
  const output = (node: Node<"vec4">): Node<"vec4"> =>
    renderOutput(node, NoToneMapping, SRGBColorSpace);
  const withDof = output(finish(focused));
  const withoutDof = output(finish(lit));

  let dofWanted = LOOK_DEFAULTS.dof;
  let regressed = false;
  withDofPipeline.outputNode = withDof;
  plainPipeline.outputNode = withoutDof;
  let pipeline = plainPipeline;
  let warm = false;
  const applyGating = () => {
    pipeline = dofWanted && !regressed ? withDofPipeline : plainPipeline;
  };
  applyGating();

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
  return {
    compile: (object) => {
      const target = renderer.getRenderTarget();
      renderer.setRenderTarget(scenePass.renderTarget);
      const done = renderer.compileAsync(object, camera, scene);
      renderer.setRenderTarget(target);
      return done.then(() => undefined);
    },
    render: () => {
      updateFocus();
      if (!warm) {
        // Build both graphs up front (the first frames are under the load
        // screen), so the first toggle costs nothing.
        warm = true;
        (pipeline === plainPipeline ? withDofPipeline : plainPipeline).render();
      }
      pipeline.render();
    },
    getFocusInfo: () => ({
      focusDistance: focusDistance.value,
      focusRange: focusRange.value,
      bokehScale: 1,
    }),
    setSize: () => undefined, // the pipeline follows the renderer's size
    applyLook: (look) => {
      contact.value = look.contact;
      grading.value = Math.min(Math.max(look.grading, 0), 1);
      grain.value = Math.min(Math.max(look.grain, 0), 1);
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
      withDofPipeline.dispose();
      plainPipeline.dispose();
    },
  };
}
