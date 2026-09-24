import { type BufferGeometry, Color, Mesh } from "three";
import {
  abs,
  clamp,
  color,
  float,
  fract,
  fwidth,
  min,
  mix,
  normalView,
  positionViewDirection,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { MeshStandardNodeMaterial, type Node } from "three/webgpu";
import type { SplatLayer } from "./terrain-layer";
import type { WaterLayer } from "./water-layer";

/**
 * SPIKE (plan 020): terrain and water as TSL node materials. Data-frame
 * coordinates come from world space, as in shader-chunks.ts: the `world`
 * group only rotates, so data (x, y, z) = world (x, −z, y). Ported: the
 * palette-painted splat and the contour ink; the water's coverage mask,
 * colour and a Fresnel sky tint. Not ported: meadow mottle, NDVI tint,
 * grass normals, height fog, ripples, glitter, mist.
 */

function splatUv(splat: SplatLayer): Node<"vec2"> {
  const [minX, minY, maxX, maxY] = splat.bounds;
  const ox = minX - splat.offset.cx;
  const oy = maxY - splat.offset.cy;
  const dataX = positionWorld.x;
  const dataY = positionWorld.z.negate();
  return vec2(
    dataX.sub(ox).div(maxX - minX),
    float(oy)
      .sub(dataY)
      .div(maxY - minY)
  );
}

/** 1 on a contour line of spacing `step`, fwidth-constant width. */
function contour(elevation: Node<"float">, step: number): Node<"float"> {
  const d = elevation.div(step);
  return float(1).sub(
    min(abs(fract(d.sub(0.5)).sub(0.5)).div(fwidth(d)), float(1))
  );
}

export function createNodeTerrainMaterial(
  splat?: SplatLayer
): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: 0xad_b2_9e,
    roughness: 1,
  });
  const base = splat
    ? texture(splat.colorTexture, splatUv(splat)).rgb
    : color(0xad_b2_9e);
  const elevation = positionWorld.y;
  const ink = clamp(
    contour(elevation, 2).mul(0.1).add(contour(elevation, 10).mul(0.15)),
    0,
    0.26
  );
  material.colorNode = mix(base, vec3(0.3, 0.33, 0.38), ink);
  return material;
}

export function createNodeWaterLayer(
  geometry: BufferGeometry,
  splat: SplatLayer
): WaterLayer {
  const skyTint = uniform(new Color(0x9f_b6_cc));
  const material = new MeshStandardNodeMaterial({
    color: 0x86_a8_c4,
    roughness: 0.3,
    metalness: 0,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const coverage = smoothstep(
    0.28,
    0.72,
    texture(splat.colorTexture, splatUv(splat)).a
  );
  const fresnel = float(1)
    .sub(clamp(normalView.dot(positionViewDirection), 0, 1))
    .pow(2);
  material.colorNode = mix(color(0x86_a8_c4), skyTint, fresnel.mul(0.55));
  material.opacityNode = coverage.mul(0.8);
  material.alphaTest = 0.001;
  const mesh = new Mesh(geometry, material);
  mesh.name = "water";
  mesh.renderOrder = 2;
  mesh.receiveShadow = true;
  const mistMesh = new Mesh(geometry, material);
  mistMesh.visible = false;
  return {
    mesh,
    mistMesh,
    setMist: () => undefined,
    update: (_seconds, skyColor) => {
      skyTint.value.copy(skyColor);
    },
  };
}
