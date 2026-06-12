/**
 * Minimal ambient typing for the untyped `n8ao` package — only the surface
 * the post stack uses. https://github.com/N8python/n8ao
 */
declare module "n8ao" {
  import type { Pass } from "postprocessing";
  import type { Camera, Scene } from "three";

  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      aoSamples: number;
      color: { set: (color: number | string) => void };
      denoiseSamples: number;
      distanceFalloff: number;
      intensity: number;
    };
    setQualityMode(
      mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"
    ): void;
  }
}
