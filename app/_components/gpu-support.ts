/**
 * True when this browser can render the viewer: WebGPU, or a WebGL2 context
 * for three's WebGPURenderer to fall back to (its WebGL2 backend). An
 * advertised `navigator.gpu` is enough here — the renderer itself falls back
 * when no adapter turns up.
 */
export function hasGpu(): boolean {
  if (typeof navigator !== "undefined" && "gpu" in navigator) {
    return true;
  }
  try {
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2");
    // Release the probe: browsers cap live WebGL contexts per page, and this
    // one would otherwise linger next to the renderer's until GC.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * The sentence for a browser that renders neither WebGPU nor WebGL2 — the
 * preflight's, and the renderer's when its `init()` fails after all: an
 * advertised `navigator.gpu` without an adapter (hardware acceleration
 * off, a blocklisted GPU) passes the preflight, and only the renderer
 * finds out that WebGL2 is missing too.
 */
export const NO_GPU_MESSAGE =
  "Dieser Viewer braucht WebGPU oder WebGL2, das dieser Browser oder " +
  "dieses Gerät nicht bereitstellt. Bitte einen aktuellen Desktop- oder " +
  "Mobil-Browser mit aktivierter Hardwarebeschleunigung verwenden.";

/**
 * What this browser lacks for the viewer, as the sentence the HUD shows, or
 * null. WebGPU (or WebGL2) renders; DecompressionStream inflates the
 * pre-gzipped tile content (tile-stream.ts) — without it every tile would
 * fail with a bare ReferenceError instead of this explanation.
 */
export function missingPrerequisite(): string | null {
  if (!hasGpu()) {
    return NO_GPU_MESSAGE;
  }
  if (typeof DecompressionStream === "undefined") {
    return (
      "Dieser Browser ist zu alt für den Viewer (es fehlt " +
      "DecompressionStream, z. B. Safari vor 16.4). Bitte den Browser " +
      "aktualisieren."
    );
  }
  return null;
}
