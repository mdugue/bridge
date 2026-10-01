import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  type PerspectiveCamera,
  RenderTarget,
  Scene,
  type DepthTexture,
  type WebGPURenderer,
  Color,
  DoubleSide,
} from "three/webgpu";
import {
  float,
  fwidth,
  max,
  mix,
  nodeObject,
  perspectiveDepthToViewZ,
  positionView,
  reference,
  screenUV,
  smoothstep,
  texture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { OUTLINE_BAND, OUTLINE_HALO, outlineSpread } from "@/lib/city/outline";
import type { V4 } from "./shader-chunks";

/**
 * The outline around the asked element (plan 049): one line along its
 * silhouette as the camera sees it now — not along every edge of it —
 * thick, soft and a little rounded, in the hatch's graphite on a hair of
 * its paper, a constant width on screen whatever the distance.
 *
 * How: the element's own triangles (world positions, `set`) are drawn
 * into a mask, only where the scene shows them (the scene pass's depth
 * decides: a house behind another is outlined where it shows). The mask
 * is blurred at half resolution, which rounds its corners, drops what is
 * finer than the line and leaves a smooth ramp across the silhouette;
 * the line is the band of that ramp around its middle, anti-aliased by
 * its own gradient (`fwidth`), so it never steps like a pixel edge. The
 * blur's reach follows the device pixel ratio: the width is in CSS
 * pixels. The halo is the paper the hatch lifts the building towards, so
 * mark and outline read as one drawing.
 */
export interface SelectionOutline {
  /**
   * The element's triangles in world space (non-indexed), or null. `reach`
   * (m): how far behind them the scene's own surface may lie and still be
   * the element — 0 for the element's own triangles; for a stand-in shape
   * (a tree's crown, a monument) its depth, so the mask is what the scene
   * drew inside the stand-in, not the stand-in.
   */
  set: (positions: Float32Array | null, reach?: number) => void;
  /** draws the mask after the scene pass (nothing when nothing is asked) */
  renderMask: (renderer: WebGPURenderer, camera: PerspectiveCamera) => void;
  /** the frame with the outline over it */
  over: (colour: V4) => V4;
  /** follows the device pixel ratio (the width is in CSS px) */
  update: (pixelRatio: number) => void;
  setSize: (width: number, height: number) => void;
  /** builds the mask's program off the frame */
  compile: (
    renderer: WebGPURenderer,
    camera: PerspectiveCamera
  ) => Promise<void>;
  dispose: () => void;
}

/** The hatch's ink and paper (visual-style.ts `askedColour`). */
const GRAPHITE = new Color(0.24, 0.22, 0.21);
const PAPER = new Color(0.97, 0.93, 0.85);
/** A tree sways and a proxy is not the drawn shape: how far behind the
 *  scene's surface the element may lie and still count as seen (m, and a
 *  share of the distance). */
const SEEN_SLACK_M = 0.6;
const SEEN_SLACK_SHARE = 0.01;

export function createSelectionOutline(deps: {
  camera: PerspectiveCamera;
  /** the scene pass's depth */
  depthTexture: DepthTexture;
  height: number;
  width: number;
}): SelectionOutline {
  const mask = new RenderTarget(deps.width, deps.height, {
    type: HalfFloatType,
    depthBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  mask.texture.name = "SelectionMask";

  // Seen where the scene's surface is not in front of it: the scene's
  // view depth at this pixel against the element's own.
  const sceneZ = perspectiveDepthToViewZ(
    texture(deps.depthTexture, screenUV).r,
    reference("near", "float", deps.camera),
    reference("far", "float", deps.camera)
  );
  const slack = sceneZ.negate().mul(SEEN_SLACK_SHARE).add(SEEN_SLACK_M);
  // how far the scene's surface lies behind the element's (view z falls
  // with depth): about 0 on its own triangles, up to `reach` in a stand-in
  const behind = positionView.z.sub(sceneZ);
  const reach = uniform(0);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(1, 1, 1, 1);
  material.maskNode = behind
    .greaterThanEqual(slack.negate())
    .and(behind.lessThanEqual(reach.add(slack)));
  // both faces: the LoD2's polygons do not all face out (the clay draws
  // both sides too)
  material.side = DoubleSide;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.name = "selection-mask";

  const scene = new Scene();
  const shape = new Mesh(new BufferGeometry(), material);
  shape.frustumCulled = false;
  shape.visible = false;
  scene.add(shape);
  // whether something is asked (the compile shows the shape for a moment)
  let selected = false;
  let drawn = false;

  const spread = uniform(outlineSpread(1));
  // reason: GaussianBlurNode's types don't carry its vec4 output.
  const blurred = nodeObject(
    gaussianBlur(texture(mask.texture), spread, OUTLINE_BAND.sigma, {
      resolutionScale: 0.5,
    })
  ) as unknown as V4;

  const over = (colour: V4): V4 => {
    const f = blurred.r;
    const aa = max(fwidth(f), 1e-4);
    const band = (from: number, to: number) =>
      smoothstep(float(from).sub(aa), float(from).add(aa), f).mul(
        float(1).sub(smoothstep(float(to).sub(aa), float(to).add(aa), f))
      );
    const ink = band(OUTLINE_BAND.from, OUTLINE_BAND.to);
    const halo = band(OUTLINE_HALO.from, OUTLINE_HALO.to);
    const onPaper = mix(
      colour.rgb,
      vec3(PAPER.r, PAPER.g, PAPER.b),
      halo.mul(OUTLINE_HALO.strength)
    );
    return vec4(
      mix(
        onPaper,
        vec3(GRAPHITE.r, GRAPHITE.g, GRAPHITE.b),
        ink.mul(OUTLINE_BAND.strength)
      ),
      colour.a
    );
  };

  const clearMask = (renderer: WebGPURenderer) => {
    const previous = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(mask);
    renderer.setClearColor(0x00_00_00, 0);
    try {
      renderer.clear(true, false, false);
    } finally {
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setRenderTarget(previous);
    }
  };

  return {
    set: (positions, depth = 0) => {
      reach.value = depth;
      shape.geometry.dispose();
      const geometry = new BufferGeometry();
      selected = positions !== null && positions.length >= 9;
      if (positions && selected) {
        geometry.setAttribute(
          "position",
          new Float32BufferAttribute(positions, 3)
        );
      }
      shape.geometry = geometry;
      shape.visible = selected;
    },
    renderMask: (renderer, camera) => {
      if (!selected) {
        if (drawn) {
          clearMask(renderer);
          drawn = false;
        }
        return;
      }
      clearMask(renderer);
      const previous = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.setRenderTarget(mask);
      renderer.autoClear = false;
      try {
        renderer.render(scene, camera);
      } finally {
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previous);
      }
      drawn = true;
    },
    over,
    update: (pixelRatio) => {
      spread.value = outlineSpread(pixelRatio);
    },
    setSize: (width, height) => mask.setSize(width, height),
    // like PostStack's compileOne: the call builds the program before it
    // returns, so the target and the shape are restored before a frame
    compile: (renderer, camera) => {
      const previous = renderer.getRenderTarget();
      shape.visible = true;
      renderer.setRenderTarget(mask);
      try {
        return renderer.compileAsync(scene, camera);
      } finally {
        shape.visible = selected;
        renderer.setRenderTarget(previous);
      }
    },
    dispose: () => {
      shape.geometry.dispose();
      material.dispose();
      mask.dispose();
    },
  };
}
