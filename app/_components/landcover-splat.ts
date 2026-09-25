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
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import {
  LANDCOVER_CLASSES,
  linearPalette,
  WATER_CLASS,
} from "@/lib/city/landcover";
import { textureBytes, trackTexture, untrackTexture } from "./three-utils";

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
  return {
    texture: target.texture,
    dispose: () => {
      untrackTexture(target.texture);
      target.dispose();
    },
  };
}
