import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NodeMaterial,
  QuadMesh,
  RedFormat,
  RenderTarget,
  SRGBColorSpace,
  type Texture,
  UnsignedByteType,
  Vector3,
  type WebGPURenderer,
} from "three/webgpu";
import {
  float,
  int,
  ivec2,
  screenCoordinate,
  select,
  textureLoad,
  texture,
  uniformArray,
  vec2,
  vec4,
} from "three/tsl";
import {
  LANDCOVER_CLASSES,
  linearPalette,
  WATER_CLASS,
} from "@/lib/city/landcover";
import {
  sceneMaterial,
  textureBytes,
  trackTexture,
  untrackTexture,
} from "./three-utils";
import type { F } from "./shader-chunks";

/**
 * The terrain's colour splat, painted on the GPU from the class-id raster and
 * the palette in lib/city/landcover.ts. It used to be baked into a committed
 * RGBA PNG per tile (plus a downsampled variant), which put the look in the
 * bake: a colour change meant a re-bake, and the alpha channel (= water
 * coverage) had to be protected from every image tool's premultiplied resize.
 *
 * One full-screen pass per tile, at load: RGB = the class's pastel tint
 * (linear; the sRGB target encodes it), A = water coverage, a 3×3 tent over
 * the water class — the soft shoreline the water sheet smoothsteps. The
 * target is LINEAR + mipmapped + anisotropic, exactly what the baked PNG was
 * sampled with, so boundaries stay anti-aliased at grazing angles.
 *
 * Orientation: `screenCoordinate` follows WebGPU (y = 0 is the target's
 * first row) on both backends — on WebGL three flips `gl_FragCoord`, and
 * flips a render target's uv again when it is sampled — so the texel the
 * pass writes for class row y is read back at the class raster's own uv
 * (flipY false, v southward) either way.
 */

const CLASSES = LANDCOVER_CLASSES.length;

/** The palette as vec3s (linear), one per class id. */
function paletteVectors(): Vector3[] {
  const flat = linearPalette();
  return LANDCOVER_CLASSES.map(
    (_, i) => new Vector3(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2])
  );
}

/** A stand-in for the class raster until the first tile binds its own; the
 *  same format and sampling state (R8, NEAREST), so a swap is a rebind. */
function placeholderClass(): DataTexture {
  const tex = new DataTexture(
    new Uint8Array([0]),
    1,
    1,
    RedFormat,
    UnsignedByteType
  );
  tex.needsUpdate = true;
  return tex;
}

interface SplatPass {
  classNode: ReturnType<typeof texture>;
  material: NodeMaterial;
  quad: QuadMesh;
}

/** The pass per raster size, as the scene material it wraps was built. */
const passes = new Map<string, SplatPass>();

function buildPass(key: string, width: number, height: number): NodeMaterial {
  const classNode = texture(placeholderClass());
  const palette = uniformArray(paletteVectors(), "vec3" as const);
  // Texel centres, clamped to the raster's edge texels before truncating
  // to the texel index.
  const lo = vec2(0.5, 0.5);
  const hi = vec2(width - 0.5, height - 0.5);
  const classAt = (dx: number, dy: number) =>
    int(
      textureLoad(
        classNode,
        ivec2(screenCoordinate.add(vec2(dx, dy)).clamp(lo, hi))
      )
        .r.mul(255)
        .add(0.5)
    );
  const cls = classAt(0, 0);
  const rgb = palette.element(select(cls.lessThan(CLASSES), cls, int(0)));
  let water: F = float(0);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const w = ((2 - Math.abs(dx)) * (2 - Math.abs(dy))) / 16;
      water = water.add(
        select(classAt(dx, dy).equal(WATER_CLASS), float(w), float(0))
      );
    }
  }
  const material = new NodeMaterial();
  material.name = key;
  material.fragmentNode = vec4(rgb, water);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  passes.set(key, { classNode, material, quad: new QuadMesh(material) });
  return material;
}

/**
 * The paint pass for rasters of one size, built once for the scene and
 * reused by every tile (`sceneMaterial`: freed with the last app, and built
 * anew for the next): a tile streaming in only swaps the class texture,
 * never rebuilds the pass.
 */
function splatPass(width: number, height: number): SplatPass {
  const key = `landcover-splat-${width}x${height}`;
  const material = sceneMaterial(key, () => buildPass(key, width, height));
  const pass = passes.get(key);
  if (!pass || pass.material !== material) {
    throw new Error(`${key}: pass out of step with its material`);
  }
  return pass;
}

export interface LandcoverSplat {
  dispose: () => void;
  texture: Texture;
}

/**
 * Paints the colour splat for one tile. `classTexture` is the NEAREST
 * class-id raster (RedFormat); the result has the same size and orientation
 * (flipY = false, v grows southward), so it samples with the same uv.
 */
export function paintLandcoverSplat(
  renderer: WebGPURenderer,
  classTexture: Texture,
  width: number,
  height: number
): LandcoverSplat {
  const target = new RenderTarget(width, height, {
    colorSpace: SRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    magFilter: LinearFilter,
    minFilter: LinearMipmapLinearFilter,
    anisotropy: 16,
  });
  const pass = splatPass(width, height);
  pass.classNode.value = classTexture;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  pass.quad.render(renderer);
  renderer.setRenderTarget(previous);
  trackTexture(target.texture, textureBytes(width, height, 4, true));
  return {
    texture: target.texture,
    dispose: () => {
      untrackTexture(target.texture);
      target.dispose();
    },
  };
}
