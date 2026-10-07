import {
  type BufferAttribute,
  BufferGeometry,
  type Camera,
  CustomBlending,
  Float32BufferAttribute,
  LinearFilter,
  MaxEquation,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  OneFactor,
  QuadMesh,
  RGFormat,
  RenderTarget,
  Scene,
  type DepthTexture,
  type Texture,
  type UniformNode,
  UnsignedByteType,
  Vector2,
  type WebGPURenderer,
  Color,
  DoubleSide,
  Uint32BufferAttribute,
} from "three/webgpu";
import {
  float,
  fwidth,
  max,
  select,
  mix,
  positionView,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  OUTLINE_BAND,
  OUTLINE_HALO,
  OUTLINE_HIDDEN,
  OUTLINE_KEEP_MS,
  OUTLINE_PULSE,
  outlinePulse,
  SELECTION_ACCENT,
  outlineKernel,
  outlineSpread,
} from "@/lib/city/outline";
import type { F, V4 } from "./shader-chunks";
import { TRAFFIC_ATTRIBUTES, trafficPositionNode } from "./traffic-layer";
import type { ViewLens } from "./view-lens";

/**
 * What the outline goes around: an element's triangles in world space
 * (non-indexed) with how far behind them the scene's surface may lie and
 * still be the element where it shows (`reach`, m — 0 for its own
 * triangles; a stand-in's depth, so what shows is what the scene drew
 * inside it; unbounded for glass, which writes no depth) — or one counted
 * section of a traffic
 * flow (`triangles` of the tile's `flow` mesh), drawn as the layer draws
 * it, grown with the hour and widened from the air.
 */
export type OutlineSelection =
  | { positions: Float32Array; reach: number }
  | { flow: Mesh; triangles: Uint32Array };

/** The flow bodies' attributes the mask's flow program reads. */
const FLOW_ATTRIBUTES = ["position", ...TRAFFIC_ATTRIBUTES] as const;

/**
 * The outline around the asked element (plan 052): one line along its
 * silhouette as the camera sees it now — not along every edge of it —
 * thick, soft and a little rounded, in the HUD's accent on a hair of its
 * pale (`SELECTION_ACCENT`), a constant width on screen whatever the
 * distance. A new question flashes: the halo widens and glows in the
 * accent, then settles (`OUTLINE_PULSE`); a hover over a candidate
 * does not.
 *
 * The line goes round the whole element, never along what stands in
 * front of it, and is drawn over everything: a house behind a tree is
 * outlined as a house, not as the tree's edge against it. Where something
 * in front hides the element, the line is lighter (`OUTLINE_HIDDEN`) — the
 * draughtsman's hidden edge — so it still says which is in front; the
 * hatch, on the clay itself, stays where the element shows.
 *
 * How: the element's own triangles (world positions, `set`) are drawn
 * into a two-channel mask: red wherever they fall, green only where the
 * scene shows them (the scene pass's depth decides), merged by MAX
 * blending so a hidden back face never clears a shown front. The mask
 * is blurred at half resolution, which rounds its corners, drops what is
 * finer than the line and leaves a smooth ramp across the silhouette;
 * the line is the band of that ramp around its middle, anti-aliased by
 * its own gradient (`fwidth`), so it never steps like a pixel edge. The
 * blur's reach follows the device pixel ratio: the width is in CSS
 * pixels. The line's band is red's; green over red near it is the share
 * of the element there that shows. The halo is the pale the hatch lifts
 * the building towards, so mark and outline read as one drawing.
 *
 * Memory: the mask and the blur hold two bytes a texel (each channel 0 or
 * 1 in the mask, in the blur a ramp the band reads to a few hundredths),
 * and the mask and
 * the blur's two passes are drawn only while something is asked. With
 * nothing asked the last pass reads the blur's cleared target, and the
 * mask and the first blur target go some seconds after the last question
 * (`OUTLINE_KEEP_MS`): on an iPhone 9 MB of half-float targets, drawn
 * every frame, became one 0.4 MB target. The mask stays at the drawing
 * buffer's resolution: the blur's taps step less than a texel of the half
 * resolution it writes, so it reads the mask's edge between those texels.
 */
export interface SelectionOutline {
  /** what to outline, or null for nothing; a new question flashes
   *  (`flash`, by default), a hover over a candidate does not */
  set: (selection: OutlineSelection | null, flash?: boolean) => void;
  /** draws the mask and its blur after the scene pass (nothing when
   *  nothing is asked) */
  renderMask: (renderer: WebGPURenderer, camera: Camera) => void;
  /** the frame with the outline over it */
  over: (colour: V4) => V4;
  /** follows the device pixel ratio (the width is in CSS px) */
  update: (pixelRatio: number) => void;
  setSize: (width: number, height: number) => void;
  /** builds the mask's and the blur's programs off the frame */
  compile: (renderer: WebGPURenderer, camera: Camera) => Promise<void>;
  dispose: () => void;
}

const LINE = vec3(...SELECTION_ACCENT.line);
const HALO = vec3(...SELECTION_ACCENT.halo);
/** A tree sways and a proxy is not the drawn shape: how far behind the
 *  scene's surface the element may lie and still count as seen (m, and a
 *  share of the distance). */
const SEEN_SLACK_M = 0.6;
const SEEN_SLACK_SHARE = 0.01;

/** A two-byte target (red, green) without depth, read with linear
 *  filtering. */
function byteTarget(width: number, height: number, name: string) {
  const target = new RenderTarget(width, height, {
    format: RGFormat,
    type: UnsignedByteType,
    depthBuffer: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
  });
  target.texture.name = name;
  return target;
}

/** The blur's resolution for the drawing buffer's (GaussianBlurNode's). */
const halved = (n: number) => Math.max(Math.round(n * 0.5), 1);

/**
 * One pass of the blur over `source`'s red and green: the kernel's taps
 * along `across` (1, 0 or 0, 1), `spread` half-resolution texels (`texel`)
 * apart — three's GaussianBlurNode, which the outline used before, made
 * the same sums into half-float RGBA targets it kept for good.
 */
function blurPass(
  source: Texture,
  across: [number, number],
  spread: UniformNode<"float", number>,
  texel: UniformNode<"vec2", Vector2>,
  name: string
): { material: NodeMaterial; quad: QuadMesh } {
  const weights = outlineKernel();
  const at = uv();
  const step = vec2(across[0], across[1]).mul(spread).mul(texel);
  let sum = texture(source, at).rg.mul(weights[0]);
  for (let i = 1; i < weights.length; i++) {
    const offset = step.mul(i);
    sum = sum.add(
      texture(source, at.add(offset))
        .rg.add(texture(source, at.sub(offset)).rg)
        .mul(weights[i])
    );
  }
  const material = new NodeMaterial();
  material.fragmentNode = vec4(sum, 0, 1);
  material.name = name;
  return { material, quad: new QuadMesh(material) };
}

export function createSelectionOutline(deps: {
  /** what the passes know of the camera (view-lens.ts) */
  lens: ViewLens;
  /** the scene pass's depth */
  depthTexture: DepthTexture;
  height: number;
  width: number;
}): SelectionOutline {
  const mask = byteTarget(deps.width, deps.height, "SelectionMask");
  const across = byteTarget(
    halved(deps.width),
    halved(deps.height),
    "SelectionBlurAcross"
  );
  const blurred = byteTarget(
    halved(deps.width),
    halved(deps.height),
    "SelectionBlur"
  );

  // Seen where the scene's surface is not in front of it: the scene's
  // view depth at this pixel against the element's own.
  const sceneZ = deps.lens.viewZ(texture(deps.depthTexture, screenUV).r);
  // a share of the distance — in a parallel view, of the distance the
  // picture is equivalent to (every surface is 20 km off the camera there)
  const slack = deps.lens
    .fade(sceneZ.negate())
    .mul(SEEN_SLACK_SHARE)
    .add(SEEN_SLACK_M);
  // how far the scene's surface lies behind the element's (view z falls
  // with depth): about 0 on its own triangles, up to `reach` in a stand-in
  const behind = positionView.z.sub(sceneZ);
  const reach = uniform(0);
  // red: the element; green: where the scene shows it. MAX keeps a shown
  // face's green under a hidden one drawn after it.
  const maskMaterial = (name: string, seen: Parameters<typeof select>[0]) => {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = vec4(1, select(seen, float(1), float(0)), 0, 1);
    // both faces: the LoD2's polygons do not all face out (the clay draws
    // both sides too)
    m.side = DoubleSide;
    m.depthTest = false;
    m.depthWrite = false;
    m.fog = false;
    m.blending = CustomBlending;
    m.blendEquation = MaxEquation;
    m.blendSrc = OneFactor;
    m.blendDst = OneFactor;
    m.name = name;
    return m;
  };
  const material = maskMaterial(
    "selection-mask",
    behind
      .greaterThanEqual(slack.negate())
      .and(behind.lessThanEqual(reach.add(slack)))
  );
  // A flow is glass: no depth of its own, so only what stands in front of
  // it hides it.
  const flowMaterial = maskMaterial(
    "selection-mask-flow",
    behind.greaterThanEqual(slack.negate())
  );
  flowMaterial.positionNode = trafficPositionNode();

  // Always a position attribute, even with nothing asked (one degenerate
  // triangle): the program is built from the geometry's attributes, and
  // the boot's compile (`compile`, before any question) must build the one
  // a question draws with — compiled without positions, every vertex sat
  // at the origin and the mask stayed empty.
  const shapeGeometry = (positions: Float32Array | null) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions ?? new Float32Array(9), 3)
    );
    return geometry;
  };
  // The flow's own attributes over the asked section's triangles; nothing
  // asked: one degenerate triangle with every attribute (see above).
  const flowGeometry = (source: Mesh | null, triangles: Uint32Array) => {
    const geometry = new BufferGeometry();
    for (const name of FLOW_ATTRIBUTES) {
      const own = source?.geometry.getAttribute(name) as
        | BufferAttribute
        | undefined;
      const size = name === "trafficLane" ? 4 : 3;
      geometry.setAttribute(
        name,
        own ?? new Float32BufferAttribute(new Float32Array(3 * size), size)
      );
    }
    geometry.setIndex(new Uint32BufferAttribute(triangles, 1));
    return geometry;
  };
  // Frees the wrapper's own index only: the attributes are the flow's,
  // and a geometry's dispose frees every attribute it holds.
  const dropFlowGeometry = (geometry: BufferGeometry, shared: boolean) => {
    if (shared) {
      for (const name of FLOW_ATTRIBUTES) {
        geometry.deleteAttribute(name);
      }
    }
    geometry.dispose();
  };
  const scene = new Scene();
  const shape = new Mesh(shapeGeometry(null), material);
  shape.frustumCulled = false;
  shape.visible = false;
  scene.add(shape);
  const flow = new Mesh(flowGeometry(null, new Uint32Array(3)), flowMaterial);
  flow.frustumCulled = false;
  flow.visible = false;
  flow.matrixAutoUpdate = false;
  flow.matrixWorldAutoUpdate = false;
  let flowShared = false;
  scene.add(flow);
  // whether something is asked (the compile shows the shape for a moment)
  let selected = false;
  // whether the last pass reads a cleared blur (nothing asked since)
  let clean = false;
  // whether the mask and the first blur target hold memory, and since when
  // nothing has used them (performance.now())
  let held = false;
  let lastUsed = 0;

  const spread = uniform(outlineSpread(1));
  // the flash of a new question (OUTLINE_PULSE), and when it was asked
  const pulse = uniform(0);
  let askedAt = Number.NEGATIVE_INFINITY;
  const texel = uniform(
    new Vector2(1 / halved(deps.width), 1 / halved(deps.height))
  );
  const blurAcross = blurPass(
    mask.texture,
    [1, 0],
    spread,
    texel,
    "selection-blur-across"
  );
  const blurDown = blurPass(
    across.texture,
    [0, 1],
    spread,
    texel,
    "selection-blur-down"
  );
  const blurredMask = texture(blurred.texture);

  const over = (colour: V4): V4 => {
    const f = blurredMask.r;
    // the share of the element near here that the scene shows: 1 on a
    // line round what shows, 0 round what is hidden
    const shown = smoothstep(0.25, 0.75, blurredMask.g.div(max(f, 1e-3)));
    const ink = mix(float(OUTLINE_HIDDEN.strength), float(1), shown);
    const aa = max(fwidth(f), 1e-4);
    const band = (from: F, to: F) =>
      smoothstep(from.sub(aa), from.add(aa), f).mul(
        float(1).sub(smoothstep(to.sub(aa), to.add(aa), f))
      );
    const line = band(float(OUTLINE_BAND.from), float(OUTLINE_BAND.to));
    // the flash widens the halo outward and lights it in the accent
    const halo = band(
      mix(float(OUTLINE_HALO.from), float(OUTLINE_PULSE.from), pulse),
      float(OUTLINE_HALO.to)
    );
    const onHalo = mix(
      colour.rgb,
      mix(HALO, LINE, pulse.mul(OUTLINE_PULSE.glow)),
      halo.mul(mix(float(OUTLINE_HALO.strength), float(1), pulse))
    );
    return vec4(
      mix(onHalo, LINE, line.mul(ink).mul(OUTLINE_BAND.strength)),
      colour.a
    );
  };

  const clearTarget = (renderer: WebGPURenderer, target: RenderTarget) => {
    const previous = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(new Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x00_00_00, 0);
    try {
      renderer.clear(true, false, false);
    } finally {
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setRenderTarget(previous);
    }
  };

  /** One full-screen pass into `target`. */
  const pass = (
    renderer: WebGPURenderer,
    quad: QuadMesh,
    target: RenderTarget
  ) => {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
      quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previous);
    }
  };
  /** A new question restarts the flash; nothing asked ends it. */
  const flashFrom = (flash: boolean) => {
    if (flash || !selected) {
      askedAt = selected ? performance.now() : Number.NEGATIVE_INFINITY;
    }
  };
  /** Nothing asked: the last pass reads nothing, the memory goes in time. */
  const idle = (renderer: WebGPURenderer) => {
    if (!clean) {
      clearTarget(renderer, blurred);
      clean = true;
    }
    if (held && performance.now() - lastUsed > OUTLINE_KEEP_MS) {
      // drawn into again, a target is allocated again (three re-creates
      // what a dispose freed, as on every resize)
      mask.dispose();
      across.dispose();
      held = false;
    }
  };

  return {
    set: (selection, flash = true) => {
      shape.geometry.dispose();
      dropFlowGeometry(flow.geometry, flowShared);
      const positions =
        selection && "positions" in selection ? selection.positions : null;
      const section = selection && "flow" in selection ? selection : null;
      reach.value = selection && "reach" in selection ? selection.reach : 0;
      shape.geometry = shapeGeometry(
        positions && positions.length >= 9 ? positions : null
      );
      shape.visible = positions !== null && positions.length >= 9;
      flowShared = section !== null && section.triangles.length >= 3;
      flow.geometry = flowShared
        ? flowGeometry(
            section?.flow ?? null,
            section?.triangles ?? new Uint32Array(3)
          )
        : flowGeometry(null, new Uint32Array(3));
      if (section && flowShared) {
        section.flow.updateWorldMatrix(true, false);
        flow.matrix.copy(section.flow.matrixWorld);
        flow.matrixWorld.copy(section.flow.matrixWorld);
      }
      flow.visible = flowShared;
      selected = shape.visible || flow.visible;
      flashFrom(flash);
    },
    renderMask: (renderer, camera) => {
      if (!selected) {
        idle(renderer);
        return;
      }
      clearTarget(renderer, mask);
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
      pass(renderer, blurAcross.quad, across);
      pass(renderer, blurDown.quad, blurred);
      clean = false;
      held = true;
      lastUsed = performance.now();
      pulse.value = outlinePulse(lastUsed - askedAt);
    },
    over,
    update: (pixelRatio) => {
      spread.value = outlineSpread(pixelRatio);
    },
    setSize: (width, height) => {
      // a new size frees the old textures: the blur is cleared again
      mask.setSize(width, height);
      across.setSize(halved(width), halved(height));
      blurred.setSize(halved(width), halved(height));
      texel.value.set(1 / halved(width), 1 / halved(height));
      clean = false;
    },
    // like PostStack's compileOne: each call builds its program before it
    // returns, so the target and the shape are restored before a frame.
    // Compiling against the targets allocates them: they go in time, as
    // after a question.
    compile: async (renderer, camera) => {
      const previous = renderer.getRenderTarget();
      const shown = [shape.visible, flow.visible] as const;
      shape.visible = true;
      flow.visible = true;
      const builds: Promise<void>[] = [];
      try {
        renderer.setRenderTarget(mask);
        builds.push(renderer.compileAsync(scene, camera));
        renderer.setRenderTarget(across);
        builds.push(
          renderer.compileAsync(blurAcross.quad, blurAcross.quad.camera)
        );
        renderer.setRenderTarget(blurred);
        builds.push(renderer.compileAsync(blurDown.quad, blurDown.quad.camera));
      } finally {
        [shape.visible, flow.visible] = shown;
        renderer.setRenderTarget(previous);
      }
      held = true;
      lastUsed = performance.now();
      await Promise.all(builds);
    },
    dispose: () => {
      shape.geometry.dispose();
      dropFlowGeometry(flow.geometry, flowShared);
      material.dispose();
      flowMaterial.dispose();
      blurAcross.material.dispose();
      blurDown.material.dispose();
      mask.dispose();
      across.dispose();
      blurred.dispose();
    },
  };
}
