/** True when this browser can create a WebGL2 context (the one hard requirement). */
export function hasWebGl2(): boolean {
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
 * What this browser lacks for the viewer, as the sentence the HUD shows, or
 * null. WebGL2 renders; DecompressionStream inflates the pre-gzipped tile
 * content (tile-stream.ts) — without it every tile would fail with a bare
 * ReferenceError instead of this explanation.
 */
export function missingPrerequisite(): string | null {
  if (!hasWebGl2()) {
    return (
      "Dieser Viewer braucht WebGL2, das dieser Browser oder dieses Gerät " +
      "nicht bereitstellt. Bitte einen aktuellen Desktop- oder Mobil-Browser " +
      "mit aktivierter Hardwarebeschleunigung verwenden."
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
