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
