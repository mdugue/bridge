/**
 * The sentence for a browser without WebGPU, the only backend the viewer
 * draws with (ADR 0027) — the preflight's, and the scene's when no
 * adapter turns up after all (hardware acceleration off, a blocklisted
 * GPU): an advertised `navigator.gpu` passes the preflight.
 */
export const NO_GPU_MESSAGE =
  "Dieser Viewer braucht WebGPU, das dieser Browser oder dieses Gerät " +
  "nicht bereitstellt. Bitte einen aktuellen Browser (Chrome, Edge, " +
  "Safari ab iOS/macOS 26) mit aktivierter Hardwarebeschleunigung " +
  "verwenden.";

/**
 * What this browser lacks for the viewer, as the sentence the HUD shows, or
 * null. WebGPU renders, from a worker on an OffscreenCanvas;
 * DecompressionStream inflates the pre-gzipped tile content
 * (tile-stream.ts) — without it every tile would fail with a bare
 * ReferenceError instead of this explanation.
 */
export function missingPrerequisite(): string | null {
  if (!("gpu" in navigator)) {
    return NO_GPU_MESSAGE;
  }
  if (
    typeof Worker === "undefined" ||
    !("transferControlToOffscreen" in HTMLCanvasElement.prototype)
  ) {
    // the scene draws from a worker (ADR 0061)
    return (
      "Dieser Browser ist zu alt für den Viewer (er kann nicht aus einem " +
      "Worker zeichnen, z. B. Safari vor 16.4). Bitte den Browser " +
      "aktualisieren."
    );
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
