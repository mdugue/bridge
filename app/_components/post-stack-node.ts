import type { PerspectiveCamera, Scene } from "three";
import { ao } from "three/examples/jsm/tsl/display/GTAONode.js";
import { smaa } from "three/examples/jsm/tsl/display/SMAANode.js";
import {
  unpackRGBToNormal,
  packNormalToRGB,
  float,
  length,
  mix,
  mrt,
  normalView,
  output,
  pass,
  sample,
  screenUV,
  smoothstep,
  uniform,
  vec4,
} from "three/tsl";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import { LOOK_DEFAULTS } from "@/lib/city/look-controls";
import type { PostStack } from "./post-stack";

/** GTAO radius in metres (view space). N8AO's was 12 m of a different
 *  algorithm; tuned by eye on the spike's plates. */
const AO_RADIUS_M = 6;

/**
 * SPIKE (plan 020): the node post pipeline on WebGPURenderer — scene pass
 * with a normal MRT → GTAO at half resolution, multiplied in by the
 * contact-shadows slider → vignette → SMAA. Tone mapping and the sRGB
 * conversion are the pipeline's output transform. Not ported for the
 * spike: DoF, depth grading, paper grain.
 */
export function createNodePostStack(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera
): PostStack {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, normal: packNormalToRGB(normalView) }));
  const color = scenePass.getTextureNode("output");
  const normalColor = scenePass.getTextureNode("normal");
  const depth = scenePass.getTextureNode("depth");
  const normal = sample((uv) => unpackRGBToNormal(normalColor.sample(uv)));

  const aoPass = ao(depth, normal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.radius.value = AO_RADIUS_M;
  const contact = uniform(LOOK_DEFAULTS.contact);
  const occlusion = mix(float(1), aoPass.getTextureNode().r, contact);

  // The old VignetteEffect (offset 0.28, darkness 0.5), approximately.
  const edge = length(screenUV.sub(0.5)).mul(2);
  const vignette = mix(float(1), float(0.5), smoothstep(0.28, 1.4, edge));

  const lit = vec4(color.rgb.mul(occlusion).mul(vignette), color.a);
  pipeline.outputNode = smaa(lit);

  return {
    render: () => pipeline.render(),
    getFocusInfo: () => ({ focusDistance: 0, focusRange: 0, bokehScale: 0 }),
    setSize: () => undefined, // the pipeline follows the renderer's size
    applyLook: (look) => {
      contact.value = look.contact;
    },
    setRegressed: () => undefined,
    setFocusTarget: () => undefined,
    dispose: () => pipeline.dispose(),
  };
}
