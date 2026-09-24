import {
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RawShaderMaterial,
  SRGBColorSpace,
  type Texture,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import {
  clamp,
  Fn,
  float,
  int,
  ivec2,
  screenCoordinate,
  select,
  textureLoad,
  uniformArray,
  vec4,
} from "three/tsl";
import {
  NodeMaterial,
  QuadMesh,
  RenderTarget,
  type WebGPURenderer,
} from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  LANDCOVER_CLASSES,
  linearPalette,
  WATER_CLASS,
} from "@/lib/city/landcover";
import { nodeRenderer } from "./gpu-mode";
import { textureBytes, trackTexture } from "./three-utils";

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
 */
const VERT = /* glsl */ `
  in vec3 position;
  void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform highp sampler2D uClass;
  uniform vec3 uPalette[${LANDCOVER_CLASSES.length}];
  out vec4 outColor;
  int classAt( ivec2 p, ivec2 size ) {
    return int( texelFetch( uClass, clamp( p, ivec2( 0 ), size - 1 ), 0 ).r * 255.0 + 0.5 );
  }
  void main() {
    ivec2 size = textureSize( uClass, 0 );
    ivec2 p = ivec2( gl_FragCoord.xy );
    int cls = classAt( p, size );
    vec3 rgb = uPalette[ cls < ${LANDCOVER_CLASSES.length} ? cls : 0 ];
    float water = 0.0;
    for ( int dy = -1; dy <= 1; dy++ ) {
      for ( int dx = -1; dx <= 1; dx++ ) {
        float w = float( ( 2 - abs( dx ) ) * ( 2 - abs( dy ) ) ) / 16.0;
        water += w * ( classAt( p + ivec2( dx, dy ), size ) == ${WATER_CLASS} ? 1.0 : 0.0 );
      }
    }
    outColor = vec4( rgb, water );
  }
`;

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
  renderer: WebGLRenderer,
  classTexture: Texture,
  width: number,
  height: number
): LandcoverSplat {
  if (nodeRenderer()) {
    return paintNodeSplat(renderer, classTexture, width, height);
  }
  const target = new WebGLRenderTarget(width, height, {
    colorSpace: SRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    magFilter: LinearFilter,
    minFilter: LinearMipmapLinearFilter,
    anisotropy: 16,
  });
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uClass: { value: classTexture },
      uPalette: { value: linearPalette() },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(quad, new OrthographicCamera());
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  trackTexture(target.texture, textureBytes(width, height, 4, true));
  return { texture: target.texture, dispose: () => target.dispose() };
}

/**
 * SPIKE (plan 020): the same pass in TSL on WebGPURenderer — class id per
 * texel from the raster, the palette as a uniform array, the 3×3 tent over
 * the water class unrolled. Frag coords and render-target sampling follow
 * three's top-left convention on both backends, so the result samples with
 * the class raster's uv, as the GLSL pass does.
 */
function paintNodeSplat(
  renderer: WebGLRenderer,
  classTexture: Texture,
  width: number,
  height: number
): LandcoverSplat {
  const flat = linearPalette();
  const palette = uniformArray(
    LANDCOVER_CLASSES.map(
      (_, i) => new Vector3(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2])
    ),
    "vec3"
  );
  const max = ivec2(width - 1, height - 1);
  const classAt = (p: Node<"ivec2">): Node<"int"> =>
    int(
      textureLoad(
        classTexture,
        // reason: @types/three types clamp for float vectors; the WGSL/GLSL
        // clamp takes ivec2 fine.
        clamp(p as never, ivec2(0, 0) as never, max as never)
      )
        .r.mul(255)
        .add(0.5)
    );
  const fragment = Fn(() => {
    const p = ivec2(screenCoordinate.xy);
    const cls = classAt(p);
    const rgb = palette.element(
      select(cls.lessThan(LANDCOVER_CLASSES.length), cls, int(0))
    ) as unknown as Node<"vec3">; // reason: uniformArray elements are untyped
    let water: Node<"float"> = float(0);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const w = ((2 - Math.abs(dx)) * (2 - Math.abs(dy))) / 16;
        water = water.add(
          select(
            classAt(p.add(ivec2(dx, dy))).equal(WATER_CLASS),
            float(w),
            float(0)
          )
        );
      }
    }
    return vec4(rgb, water);
  });
  const target = new RenderTarget(width, height, {
    colorSpace: SRGBColorSpace,
    depthBuffer: false,
    generateMipmaps: true,
    magFilter: LinearFilter,
    minFilter: LinearMipmapLinearFilter,
    anisotropy: 16,
  });
  const material = new NodeMaterial();
  material.fragmentNode = fragment();
  material.depthTest = false;
  material.depthWrite = false;
  const quad = new QuadMesh(material);
  // reason: spike — nodeRenderer() pages hold a WebGPURenderer here.
  const node = renderer as unknown as WebGPURenderer;
  const previous = node.getRenderTarget();
  node.setRenderTarget(target);
  quad.render(node);
  node.setRenderTarget(previous);
  material.dispose();
  trackTexture(target.texture, textureBytes(width, height, 4, true));
  return { texture: target.texture, dispose: () => target.dispose() };
}
