import {
  DataTexture,
  LinearFilter,
  RepeatWrapping,
  RGFormat,
  UnsignedByteType,
} from "three/webgpu";
import { float, floor, fract, texture, vec2 } from "three/tsl";
import { NOISE_SLICE, noiseTextureBytes } from "@/lib/city/noise-texture";
import type { F, V3 } from "./shader-chunks";

/**
 * The crowns' noise: a 3D value noise answered by ONE bilinear tap of a
 * 256² RG byte texture (lib/city/noise-texture.ts), in place of
 * `mx_noise_float`. The crown's rim cut and fray sampled MaterialX's Perlin
 * twice a fragment and twice a vertex, in the scene and the shadow pass,
 * and that took the crowns' frame time to ~1.6× main's. Value noise is a
 * little wider than Perlin, so it is scaled to Perlin's spread (NOISE_GAIN).
 * Scene-wide and never freed, like the crown materials that read it.
 */
const NOISE_SIZE = 256;
const NOISE_GAIN = 0.85;

let lattice: DataTexture | null = null;

function noiseLattice(): DataTexture {
  if (!lattice) {
    lattice = new DataTexture(
      noiseTextureBytes(NOISE_SIZE),
      NOISE_SIZE,
      NOISE_SIZE,
      RGFormat,
      UnsignedByteType
    );
    lattice.minFilter = LinearFilter;
    lattice.magFilter = LinearFilter;
    lattice.wrapS = RepeatWrapping;
    lattice.wrapT = RepeatWrapping;
    lattice.generateMipmaps = false;
    lattice.unpackAlignment = 2;
    lattice.needsUpdate = true;
  }
  return lattice;
}

/** Value noise (about −1…1, Perlin's spread) at `p` in noise units; one
 *  tap at level 0, so it reads the same in a vertex and a fragment. */
export function crownNoise(p: V3): F {
  const i = floor(p);
  const f = fract(p);
  const s = f.mul(f).mul(float(3).sub(f.mul(2)));
  const uv = i.xy.add(vec2(NOISE_SLICE[0], NOISE_SLICE[1]).mul(i.z)).add(s.xy);
  const rg = texture(noiseLattice(), uv.add(0.5).div(NOISE_SIZE)).level(
    float(0)
  );
  return rg.x.mix(rg.y, s.z).mul(2).sub(1).mul(NOISE_GAIN);
}
