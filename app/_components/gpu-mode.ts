/**
 * SPIKE (plan 020, phase 0): which renderer this page runs.
 *
 *   (no param)     WebGLRenderer + GLSL patches + postprocessing — today's path
 *   ?gpu=webgpu    WebGPURenderer on its WebGPU backend, TSL materials, node post
 *   ?gpu=webgl2    WebGPURenderer forced onto its WebGL2 backend (what a
 *                  browser without WebGPU would get)
 *
 * Read once per page; every layer asks `nodeRenderer()` so the two paths can
 * be compared on one build.
 */
export type GpuMode = "webgl" | "webgpu" | "webgl2";

export function gpuModeFromSearch(search: string): GpuMode {
  const v = new URLSearchParams(search).get("gpu");
  return v === "webgpu" || v === "webgl2" ? v : "webgl";
}

let mode: GpuMode | null = null;

export function gpuMode(): GpuMode {
  mode ??=
    typeof window === "undefined"
      ? "webgl"
      : gpuModeFromSearch(window.location.search);
  return mode;
}

/** true when the page renders through WebGPURenderer (either backend). */
export function nodeRenderer(): boolean {
  return gpuMode() !== "webgl";
}
