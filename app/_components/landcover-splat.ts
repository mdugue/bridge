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
  type TextureNode,
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
  vec3,
  vec4,
} from "three/tsl";
import {
  LANDCOVER_CLASSES,
  linearPalette,
  WATER_CLASS,
} from "@/lib/city/landcover";
import { MOBILE_RASTER_PX } from "@/lib/city/tile";
import {
  sceneMaterial,
  textureBytes,
  trackTexture,
  untrackTexture,
} from "./three-utils";
import type { F, V3, V4 } from "./shader-chunks";

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
 * A 4096² class raster (a desktop's fine level) is painted at half its size
 * (`splatScaleFor`): each splat texel averages the palette colours of the
 * 2×2 class texels under it, and its water coverage is the (1,3,3,1)² box
 * over their 4×4 neighbourhood — the 3×3 tent of each of the four,
 * averaged. That is exactly the full-size splat's first mip, so wherever
 * the full size was minified the ground is what it was; only near the
 * camera, where its 0.5 m texels were magnified, does a boundary blend
 * over 1 m instead. 64 MiB less a fine tile (85 → 21 MiB with the mips).
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

/** How many class texels a splat texel spans along each axis. */
export type SplatScale = 1 | 2;

/**
 * The splat's scale for a class raster `width` texels wide: half its size
 * for a 4096² raster (a desktop's fine level), its own size for the 2048²
 * and 1024² ones (a phone's fine level, every coarse level).
 */
export function splatScaleFor(width: number): SplatScale {
  return width > MOBILE_RASTER_PX ? 2 : 1;
}

/** Taps along one axis: class texels from the splat texel's centre, and
 *  their weights. */
type Taps = readonly (readonly [offset: number, weight: number])[];

/** The colour: the class under the texel, or the mean of the 2×2 under it. */
const COLOUR_TAPS: Readonly<Record<SplatScale, Taps>> = {
  1: [[0, 1]],
  2: [
    [-0.5, 0.5],
    [0.5, 0.5],
  ],
};

/** The water coverage: the 3×3 tent, or its mean over the 2×2 (a 4×4 box). */
const WATER_TAPS: Readonly<Record<SplatScale, Taps>> = {
  1: [
    [-1, 0.25],
    [0, 0.5],
    [1, 0.25],
  ],
  2: [
    [-1.5, 1 / 8],
    [-0.5, 3 / 8],
    [0.5, 3 / 8],
    [1.5, 1 / 8],
  ],
};

/** A weighted sum over the taps of both axes. */
function tapSum<T extends F | V3>(
  taps: Taps,
  zero: T,
  at: (dx: number, dy: number) => T
): T {
  let sum = zero;
  for (const [dy, wy] of taps) {
    for (const [dx, wx] of taps) {
      sum = sum.add(at(dx, dy).mul(wx * wy)) as T;
    }
  }
  return sum;
}

/**
 * The pass's output: class ids read at offsets from the splat texel's
 * centre in class-raster pixels (`screenCoordinate × scale`), clamped to
 * the raster's edge texels before truncating to the texel index; each
 * offset is read once, for the colour and the water alike.
 */
function splatFragment(
  classNode: TextureNode<"vec4">,
  width: number,
  height: number,
  scale: SplatScale
): V4 {
  const palette = uniformArray(paletteVectors(), "vec3" as const);
  const lo = vec2(0.5, 0.5);
  const hi = vec2(width - 0.5, height - 0.5);
  const centre = screenCoordinate.mul(scale);
  const reads = new Map<string, ReturnType<typeof int>>();
  const classAt = (dx: number, dy: number) => {
    const key = `${dx},${dy}`;
    const known = reads.get(key);
    if (known) {
      return known;
    }
    const cls = int(
      textureLoad(classNode, ivec2(centre.add(vec2(dx, dy)).clamp(lo, hi)))
        .r.mul(255)
        .add(0.5)
    );
    reads.set(key, cls);
    return cls;
  };
  const rgb = tapSum<V3>(COLOUR_TAPS[scale], vec3(0), (dx, dy) => {
    const cls = classAt(dx, dy);
    return palette.element(select(cls.lessThan(CLASSES), cls, int(0)));
  });
  const water = tapSum<F>(WATER_TAPS[scale], float(0), (dx, dy) =>
    select(classAt(dx, dy).equal(WATER_CLASS), float(1), float(0))
  );
  return vec4(rgb, water);
}

interface SplatPass {
  classNode: ReturnType<typeof texture>;
  material: NodeMaterial;
  /** the class texture bound between paints */
  placeholder: DataTexture;
  quad: QuadMesh;
}

/** The pass per raster size and scale, as the scene material it wraps was
 *  built. */
const passes = new Map<string, SplatPass>();

function buildPass(
  key: string,
  width: number,
  height: number,
  scale: SplatScale
): NodeMaterial {
  const placeholder = placeholderClass();
  const classNode = texture(placeholder);
  const material = new NodeMaterial();
  material.name = key;
  material.fragmentNode = splatFragment(classNode, width, height, scale);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  passes.set(key, {
    classNode,
    material,
    placeholder,
    quad: new QuadMesh(material),
  });
  // Freed with the last app (sceneMaterial): the pass and its stand-in go
  // with the material, so nothing of the old renderer's lingers here.
  material.addEventListener("dispose", () => {
    if (passes.get(key)?.material === material) {
      passes.delete(key);
    }
    placeholder.dispose();
  });
  return material;
}

/**
 * The paint pass for rasters of one size and scale, built once for the
 * scene and reused by every tile (`sceneMaterial`: freed with the last app,
 * and built anew for the next): a tile streaming in only swaps the class
 * texture, never rebuilds the pass.
 */
function splatPass(
  width: number,
  height: number,
  scale: SplatScale
): SplatPass {
  const key = `landcover-splat-${width}x${height}@${scale}`;
  const material = sceneMaterial(key, () =>
    buildPass(key, width, height, scale)
  );
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
 * class-id raster (RedFormat), `width` × `height` texels; the result is
 * that size over `scale` (`splatScaleFor`), in the same orientation
 * (flipY = false, v grows southward), so it samples with the same uv.
 */
export function paintLandcoverSplat(
  renderer: WebGPURenderer,
  classTexture: Texture,
  width: number,
  height: number,
  scale: SplatScale = 1
): LandcoverSplat {
  const w = width / scale;
  const h = height / scale;
  const target = new RenderTarget(w, h, {
    colorSpace: SRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    magFilter: LinearFilter,
    minFilter: LinearMipmapLinearFilter,
    anisotropy: 16,
  });
  const pass = splatPass(width, height, scale);
  pass.classNode.value = classTexture;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  pass.quad.render(renderer);
  renderer.setRenderTarget(previous);
  // Unbind the tile's raster: the scene-wide pass would otherwise hold the
  // last tile's class texture until the next tile paints.
  pass.classNode.value = pass.placeholder;
  trackTexture(target.texture, textureBytes(w, h, 4, true));
  return {
    texture: target.texture,
    dispose: () => {
      untrackTexture(target.texture);
      target.dispose();
      // A terrain graph's binding copied at build time may still hold this
      // texture (material-slots.ts): made again, it gets a texel.
      target.texture.image = { width: 1, height: 1, depth: 1 };
    },
  };
}
