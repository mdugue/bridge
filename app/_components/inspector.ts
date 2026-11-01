import { InspectorBase, type WebGPURenderer } from "three/webgpu";

/**
 * three's own Inspector on `?inspect=1` (three/addons/inspector): a panel
 * over the canvas with the renderer's time per pass (GPU timestamps where
 * the adapter has them: Chromium, not Safari), its memory by kind, the
 * draw calls and the node graphs — the QA knob beside `?trace=1`
 * (stream-timing.ts), which measures the stream, not the renderer. The
 * module is loaded only then, so no other page carries it. It keeps its
 * panel layout under `threejs-inspector` in local storage (storage-keys.ts,
 * the privacy page) and turns the backend's timestamps on.
 */

/** Whether the page was opened with `?inspect=1`. */
export function inspectRequested(search: string): boolean {
  return new URLSearchParams(search).get("inspect") === "1";
}

/**
 * Puts three's Inspector on the renderer; the returned teardown gives the
 * renderer back a bare inspector (which takes the panel off the page and
 * restores three's console function).
 */
export async function attachInspector(
  renderer: WebGPURenderer
): Promise<() => void> {
  const { Inspector } = await import("three/addons/inspector/Inspector.js");
  renderer.inspector = new Inspector();
  return () => {
    renderer.inspector = new InspectorBase();
  };
}
