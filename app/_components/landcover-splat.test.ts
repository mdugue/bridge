import { expect, test } from "bun:test";
import {
  DataTexture,
  LinearMipmapLinearFilter,
  type Material,
  type Node,
  type NodeMaterial,
  type Object3D,
  type RenderTarget,
  SRGBColorSpace,
  type WebGPURenderer,
} from "three/webgpu";
import { paintLandcoverSplat } from "./landcover-splat";
import { retainSceneMaterials } from "./three-utils";

/** A renderer that records what it was asked to draw, and into what. */
function fakeRenderer() {
  let target: RenderTarget | null = null;
  const draws: {
    classes: unknown[];
    material: Material;
    target: RenderTarget | null;
  }[] = [];
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: (t: RenderTarget | null) => {
      target = t;
    },
    render: (object: Object3D) => {
      const { material } = object as Object3D & { material: NodeMaterial };
      // the textures the pass reads at the moment it is drawn
      const classes = new Set<unknown>();
      (material.fragmentNode as Node).traverse((n: Node) => {
        const t = n as Node & { isTextureNode?: boolean; value?: unknown };
        if (t.isTextureNode) {
          classes.add(t.value);
        }
      });
      draws.push({ classes: [...classes], material, target });
    },
  };
  return { draws, renderer: renderer as unknown as WebGPURenderer };
}

test("every tile of a raster size paints with one pass, into its own target", () => {
  const release = retainSceneMaterials();
  const { draws, renderer } = fakeRenderer();
  const classA = new DataTexture();
  const classB = new DataTexture();
  const a = paintLandcoverSplat(renderer, classA, 64, 64);
  const b = paintLandcoverSplat(renderer, classB, 64, 64);
  const c = paintLandcoverSplat(renderer, new DataTexture(), 32, 32);
  expect(draws).toHaveLength(3);
  expect(draws[0].material).toBe(draws[1].material);
  expect(draws[2].material).not.toBe(draws[0].material);
  // the class raster is swapped in, never a new pass
  expect(draws[0].classes).toEqual([classA]);
  expect(draws[1].classes).toEqual([classB]);
  expect(draws[0].target?.texture).toBe(a.texture);
  expect(draws[1].target?.texture).toBe(b.texture);
  // the renderer's own target is restored
  expect(renderer.getRenderTarget()).toBeNull();
  // sampled as the baked PNG was: sRGB, LINEAR + mipmapped + anisotropic
  expect(a.texture.colorSpace).toBe(SRGBColorSpace);
  expect(a.texture.minFilter).toBe(LinearMipmapLinearFilter);
  expect(a.texture.generateMipmaps).toBe(true);
  expect(a.texture.anisotropy).toBe(16);
  for (const splat of [a, b, c]) {
    splat.dispose();
  }
  release();
});
