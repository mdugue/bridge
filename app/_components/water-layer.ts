import { type BufferGeometry, Mesh, MeshStandardMaterial } from "three";
import type { SplatLayer } from "./terrain-layer";

/** Animated water surface, masked to the land-cover "water" class (id 8). */
export interface WaterLayer {
  mesh: Mesh;
  /** advance the ripple animation (call per frame with elapsed seconds) */
  setTime: (seconds: number) => void;
}

/**
 * A translucent water sheet that re-uses the terrain geometry (so it drapes on
 * the same heightfield) but discards every fragment whose land-cover class is
 * not water. Built on MeshStandardMaterial so the scene's sun, shadows and fog
 * apply for free; a cheap sine-wave normal wobble gives stylized movement.
 *
 * Geometry is SHARED with the terrain mesh — do not dispose it here.
 */
export function createWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer
): WaterLayer {
  const uTime = { value: 0 };
  const [minX, minY, maxX, maxY] = splat.bounds;
  const origin = [minX - splat.offset.cx, maxY - splat.offset.cy];
  const size = [maxX - minX, maxY - minY];

  const material = new MeshStandardMaterial({
    color: 0x86_a8_c4,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    opacity: 0.8,
    // Pull slightly towards camera so it never z-fights the shared terrain.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const splatWidth =
    (splat.texture.image as { width?: number } | undefined)?.width ?? 2048;
  const texel = 1 / splatWidth;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSplat = { value: splat.texture };
    shader.uniforms.uTime = uTime;
    shader.uniforms.uOrigin = { value: origin };
    shader.uniforms.uSize = { value: size };
    shader.uniforms.uTexel = { value: texel };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vSplatUv;
         varying vec2 vWorldXY;
         uniform vec2 uOrigin;
         uniform vec2 uSize;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vSplatUv = vec2( ( position.x - uOrigin.x ) / uSize.x, ( uOrigin.y - position.y ) / uSize.y );
         vWorldXY = position.xy;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vSplatUv;
         varying vec2 vWorldXY;
         uniform sampler2D uSplat;
         uniform float uTime;
         uniform float uTexel;`
      )
      // Mask to water (class 8). The class raster is NEAREST, so a single tap
      // stair-steps at the shoreline; a 5-tap coverage straightens (anti-
      // aliases) the edge into the fragment alpha without blurring it.
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
         float wcov = step( 7.5, texture2D( uSplat, vSplatUv ).r * 255.0 );
         wcov += step( 7.5, texture2D( uSplat, vSplatUv + vec2( uTexel, 0.0 ) ).r * 255.0 );
         wcov += step( 7.5, texture2D( uSplat, vSplatUv - vec2( uTexel, 0.0 ) ).r * 255.0 );
         wcov += step( 7.5, texture2D( uSplat, vSplatUv + vec2( 0.0, uTexel ) ).r * 255.0 );
         wcov += step( 7.5, texture2D( uSplat, vSplatUv - vec2( 0.0, uTexel ) ).r * 255.0 );
         wcov *= 0.2;
         if ( wcov <= 0.0 ) discard;
         diffuseColor.a *= wcov;`
      )
      // Stylized ripples: perturb the shading normal with crossing sine waves.
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
         float wv = sin( vWorldXY.x * 0.35 + uTime * 0.8 )
                  + sin( vWorldXY.y * 0.27 - uTime * 0.6 );
         float wu = sin( ( vWorldXY.x + vWorldXY.y ) * 0.20 + uTime * 0.5 );
         normal = normalize( normal + vec3( wv, wu, 0.0 ) * 0.06 );`
      );
  };

  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2; // after the opaque terrain fill
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  return {
    mesh,
    setTime: (seconds) => {
      uTime.value = seconds;
    },
  };
}
