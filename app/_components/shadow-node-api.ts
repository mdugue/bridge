/**
 * What three's ShadowNode documents to override and read (its own comments say
 * so, and three's tiled shadows use them), missing from the @types. Only the
 * types are added: `ShadowNodeBase` is three's class.
 */
import { ShadowNode } from "three/webgpu";
import type {
  DepthTexture,
  LightShadow,
  Node,
  NodeBuilder,
  RenderTarget,
  Scene,
  WebGPURenderer,
} from "three/webgpu";
import type { F, I, V3 } from "./shader-chunks";

/** What three's filter takes (ShadowFilterNode.js). */
export type ShadowFilter = (inputs: {
  depthLayer: I;
  depthTexture: DepthTexture;
  shadow: LightShadow;
  shadowCoord: V3;
}) => F;

/** What a shadow's render reads of the frame. */
export interface FrameLike {
  renderer: WebGPURenderer;
  scene: Scene;
}

/** What `setupRenderTarget` returns. */
export interface ShadowTargets {
  depthTexture: DepthTexture;
  shadowMap: RenderTarget;
}

/** NodeBuilder's stacks, missing from its @types. */
export type StackBuilder = NodeBuilder & {
  addStack: () => void;
  removeStack: () => void;
};

declare class ShadowNodeApi extends ShadowNode {
  shadow: LightShadow;
  shadowMap: RenderTarget | null;
  getShadowFilterFn(type: number): ShadowFilter;
  renderShadow(frame: FrameLike): void;
  setupRenderTarget(shadow: LightShadow, builder: NodeBuilder): ShadowTargets;
  setupShadow(builder: NodeBuilder): Node;
}

export const ShadowNodeBase = ShadowNode as unknown as typeof ShadowNodeApi;
